// Pure state transitions. Everything here works on a State object in memory;
// persistence and locking live in store.ts.
import {
  StateSchema,
  type Action,
  type Delta,
  type Directive,
  type PlanArgs,
  type State,
  type Step,
  type StepIn,
  type StepStatus,
} from './schema.js';
import {
  FINISHED,
  childrenOf,
  descendants,
  findPhase,
  findStep,
  hasChildren,
  leaves,
  nextStep,
  num,
  phaseComplete,
  phaseNum,
  phasesSorted,
  runLine,
  unmetDeps,
} from './tree.js';

export * from './tree.js';

const LOG_CAP = 200;
const INBOX_CAP = 100;

export const now = () => new Date().toISOString();

export function emptyState(name: string, goal?: string): State {
  return StateSchema.parse({ project: { name, goal, since: now() } });
}

// ---------- bookkeeping ----------

export function log(s: State, m: string, k?: string) {
  s.log.push({ at: now(), m, k });
  if (s.log.length > LOG_CAP) s.log.splice(0, s.log.length - LOG_CAP);
}

export function directive(s: State, k: Directive['k'], target?: string, x?: string) {
  s.seq += 1;
  s.inbox.push({ id: `m${s.seq}`, k, s: target, x, at: now(), ack: false });
  if (s.inbox.length > INBOX_CAP) {
    // drop oldest acknowledged first, then oldest overall
    const i = s.inbox.findIndex((d) => d.ack);
    s.inbox.splice(i >= 0 ? i : 0, 1);
  }
}

export function unread(s: State): Directive[] {
  return s.inbox.filter((d) => !d.ack);
}

/** Marks unread directives as delivered and returns them. */
export function takeUnread(s: State): Directive[] {
  const list = unread(s);
  for (const d of list) d.ack = true;
  return list;
}

const q = (x: string, max = 60) => JSON.stringify(x.length > max ? x.slice(0, max - 1) + '…' : x);

export function fmtDirective(d: Directive): string {
  const t = d.s ?? '';
  switch (d.k) {
    case 'ok':
      return d.x ? `ok ${d.x} in order` : `ok ${t}`;
    case 'no':
      return `skip ${t}`;
    case 'split':
      return `split ${t}`;
    case 'note':
      // a general note is the user writing to Claude from the board, so it travels whole
      return t ? `${t} note:${q(d.x ?? '', 120)}` : `note:${q(d.x ?? '', 500)}`;
    case 'prio':
      return `${t} prio ${d.x}`;
    case 'edit':
      return `${t} renamed ${q(d.x ?? '')}`;
    case 'add':
      return `+${t} ${q(d.x ?? '')} (user)`;
    case 'retry':
      return `retry ${t}`;
    case 'guard':
      return `guard ${d.x}`;
    case 'ask':
      return `ask ${t}`;
    case 'arch':
      return `archived ${d.x} (drop)`;
    case 'unarch':
      return `restored ${d.x}`;
  }
}

export const fmtDirectives = (ds: Directive[]) => ds.map(fmtDirective).join('; ');

/**
 * Clicks that need Claude now, so the watcher wakes an idle session for them.
 * The rest (rename, reorder, guard, archive, a note on a step that hasn't
 * started) can wait for Claude's next turn.
 */
export function wakes(s: State, d: Directive): boolean {
  const st = d.s ? findStep(s, d.s) : undefined;
  switch (d.k) {
    case 'ok':
    case 'ask':
    case 'split':
    case 'retry':
      return true;
    case 'note':
      return !d.s || st?.s === 'run';
    case 'add':
      return st?.s === 'ok'; // a task the user approved as they added it
    default:
      return false;
  }
}

// ---------- ids ----------

// ids count archived items too, so a restored phase or step never collides with a new one
function nextPhaseId(s: State) {
  return 'P' + (Math.max(0, ...[...s.phases, ...s.archive.phases].map((p) => num(p.id))) + 1);
}

function nextStepId(s: State, phaseId: string, parentId: string | null) {
  const prefix = parentId ? `${parentId}.` : `S${phaseNum(s, phaseId)}.`;
  const used = [...s.steps, ...s.archive.steps]
    .filter((x) => x.id.startsWith(prefix) && !x.id.slice(prefix.length).includes('.'))
    .map((x) => Number(x.id.slice(prefix.length)) || 0);
  return prefix + (Math.max(0, ...used) + 1);
}

// ---------- status roll-up for container steps ----------

function deriveContainer(kids: StepStatus[]): StepStatus {
  if (kids.every((k) => k === 'skip')) return 'skip';
  if (kids.every((k) => FINISHED.includes(k))) return 'done';
  if (kids.includes('run')) return 'run';
  if (kids.includes('fail')) return 'fail';
  if (kids.includes('block')) return 'block';
  if (kids.some((k) => k !== 'todo')) return 'ok';
  return 'todo';
}

/** Re-derives container statuses bottom-up; logs newly completed phases. */
export function rollup(s: State, before?: Map<string, boolean>) {
  const byDepth = [...s.steps].sort((a, b) => b.id.split('.').length - a.id.split('.').length);
  for (const st of byDepth) {
    const kids = s.steps.filter((x) => x.parent === st.id);
    if (kids.length) st.s = deriveContainer(kids.map((k) => k.s));
  }
  if (before) {
    for (const p of s.phases) {
      if (!before.get(p.id) && phaseComplete(s, p.id)) log(s, `${p.id} complete`, 'phase');
    }
  }
}

export const phaseSnapshot = (s: State) =>
  new Map(s.phases.map((p) => [p.id, phaseComplete(s, p.id)]));

// ---------- the run line ----------

const leavesUnder = (s: State, st: Step) => (hasChildren(s, st.id) ? descendants(s, st.id).filter((x) => !hasChildren(s, x.id)) : [st]);

/**
 * Puts approved steps in the user's run line. "Start" joins the end, in the
 * order the user pressed it; "Start in order" goes to the front, because the
 * user just said what comes next. Steps already in line keep their place
 * unless they are moved to the front.
 */
export function enqueue(s: State, list: Step[], where: 'front' | 'end') {
  const fresh = list.filter((x) => x.s === 'ok' && !hasChildren(s, x.id) && (where === 'front' || x.q === undefined));
  const rest = runLine(s).filter((x) => !fresh.includes(x));
  const line = where === 'front' ? [...fresh, ...rest] : [...rest, ...fresh];
  line.forEach((x, i) => (x.q = i + 1));
}

// ---------- Claude: plan ----------

function addSteps(
  s: State,
  phaseId: string,
  parentId: string | null,
  list: StepIn[],
  status: StepStatus,
  by: 'claude' | 'user',
): string[] {
  const siblings = parentId ? childrenOf(s, parentId) : childrenOf(s, null, phaseId);
  let o = siblings.length ? Math.max(...siblings.map((x) => x.o)) + 1 : 0;
  const ids: string[] = [];
  for (const item of list) {
    const spec = typeof item === 'string' ? { t: item } : item;
    const id = nextStepId(s, phaseId, parentId);
    const deps = (spec.deps ?? [])
      .map((d) => (/^#\d+$/.test(d) ? ids[Number(d.slice(1)) - 1] : d))
      .filter((d): d is string => !!d && d !== id);
    s.steps.push({
      id,
      p: phaseId,
      parent: parentId,
      t: spec.t.trim(),
      s: status,
      o: o++,
      deps,
      d: spec.d,
      e: spec.e,
      a: spec.a?.trim() || undefined, // the "?" explanation, ready without asking Claude
      by,
      at: {},
    });
    ids.push(id);
  }
  return ids;
}

const span = (ids: string[]) =>
  ids.length === 0 ? '' : ids.length <= 2 ? ids.join(',') : `${ids[0]}..${ids[ids.length - 1]}`;

export function applyPlan(s: State, a: PlanArgs): string {
  const before = phaseSnapshot(s);
  if (a.name) s.project.name = a.name;
  if (a.goal) s.project.goal = a.goal;
  const out: string[] = [];
  const initial: StepStatus = s.cfg.autoApprove ? 'ok' : 'todo';

  for (const ph of a.phases ?? []) {
    const id = nextPhaseId(s);
    s.phases.push({ id, t: ph.t.trim(), o: s.phases.length });
    const ids = addSteps(s, id, null, ph.steps ?? [], initial, 'claude');
    out.push(`${id} ${span(ids)}`.trim());
  }

  if (a.steps?.length) {
    if (a.parent) {
      const parent = findStep(s, a.parent);
      if (!parent) throw new Error(`${a.parent} ?`);
      // refining an approved step keeps its approval, and its substeps take its place in line
      const st: StepStatus = ['ok', 'run'].includes(parent.s) ? 'ok' : initial;
      const line = runLine(s); // read before the parent stops being a leaf
      const ids = addSteps(s, parent.p, parent.id, a.steps, st, 'claude');
      const kids = ids.map((id) => findStep(s, id)!);
      const at = line.indexOf(parent);
      if (at >= 0) {
        line.splice(at, 1, ...kids);
        line.forEach((x, i) => (x.q = i + 1));
      } else if (parent.s === 'run') enqueue(s, kids, 'front'); // it was being worked on
      parent.q = undefined;
      out.push(`${parent.id}> ${span(ids)}`);
    } else {
      const phaseId = a.phase ?? phasesSorted(s).at(-1)?.id;
      if (!phaseId || !findPhase(s, phaseId)) throw new Error(`phase ${a.phase ?? ''}?`);
      const ids = addSteps(s, phaseId, null, a.steps, initial, 'claude');
      out.push(`${phaseId} ${span(ids)}`);
    }
  }

  rollup(s, before);
  if (out.length) log(s, `plan ${out.join('; ')}`, 'plan');
  const pending = leaves(s).filter((x) => x.s === 'todo').length;
  return out.join('; ') + (pending ? ` | ${pending} await approval` : '');
}

// ---------- Claude: deltas ----------

export interface GitCtx {
  tree?: string;
  stat?: (base: string, head: string) => { files: string[]; ins: number; del: number } | undefined;
}

export function applyDeltas(s: State, ops: Delta[], git: GitCtx = {}) {
  const before = phaseSnapshot(s);
  const errors: string[] = [];
  const applied: string[] = [];

  for (const op of ops) {
    const st = findStep(s, op.id);
    if (!st) {
      errors.push(`${op.id} ?`);
      continue;
    }
    if (op.s) {
      const err = transition(s, st, op.s, git);
      if (err) {
        errors.push(err);
        continue;
      }
    }
    if (op.n !== undefined) st.n = op.n;
    if (op.t) st.r = { ...st.r, t: op.t };
    if (op.e) st.e = op.e;
    if (op.a) {
      st.a = op.a;
      st.ask = undefined;
    }
    applied.push(op.id);
    const kind = op.s ?? (op.a ? 'answer' : 'note');
    log(s, `${st.id} ${kind}${op.n ? ` · ${op.n}` : ''}`, kind);
  }

  rollup(s, before);
  return { errors, applied };
}

function transition(s: State, st: Step, to: StepStatus, git: GitCtx): string | undefined {
  const container = hasChildren(s, st.id);
  if (container && to !== 'block') return `${st.id} has substeps`;
  if (st.s === 'todo') return `${st.id} needs approval`;
  if (st.s === 'skip') return `${st.id} rejected`;

  if (to === 'run') {
    const waiting = unmetDeps(s, st);
    if (waiting.length) return `${st.id} blocked by ${waiting.join(',')}`;
    if (st.s !== 'run') {
      // one step at a time, in the order the user set on the board
      const busy = leaves(s).find((x) => x.s === 'run');
      if (busy) return `${st.id} waits: ${busy.id} is still running; report it done or fail first`;
      const next = st.s === 'ok' ? nextStep(s) : undefined;
      if (next && next.id !== st.id && next.q !== undefined) return `${st.id} is not next: the user's order runs ${next.id} first`;
    }
    if (st.s !== 'run') {
      if (st.s === 'ok' || !st.base) st.base = git.tree;
      st.at = { run: now() };
    }
    st.q = undefined;
  }

  if (to === 'done' || to === 'fail') {
    if (st.s === 'done' && to === 'done') return undefined;
    st.head = git.tree;
    st.at = { ...st.at, end: now() };
    if (st.base && st.head && git.stat) {
      const stat = git.stat(st.base, st.head);
      if (stat) st.r = { ...st.r, f: stat.files.length, files: stat.files.slice(0, 50), ins: stat.ins, del: stat.del };
    }
  }

  st.s = to;
  return undefined;
}

// ---------- user: board actions ----------

export function applyAction(s: State, a: Action): string {
  const before = phaseSnapshot(s);
  const msg = action(s, a);
  rollup(s, before);
  log(s, msg, 'user');
  return msg;
}

function need(s: State, id: string): Step {
  const st = findStep(s, id);
  if (!st) throw new Error(`${id} not found`);
  return st;
}

function action(s: State, a: Action): string {
  switch (a.type) {
    case 'approve': {
      if (findPhase(s, a.id)) return action(s, { type: 'approvePhase', id: a.id });
      const st = need(s, a.id);
      for (const x of [st, ...descendants(s, st.id)]) if (x.s === 'todo' || x.s === 'block') x.s = 'ok';
      enqueue(s, leavesUnder(s, st), 'end');
      directive(s, 'ok', st.id);
      return `approved ${st.id}`;
    }
    case 'approvePhase': {
      if (!findPhase(s, a.id)) throw new Error(`${a.id} not found`);
      const approved = leaves(s).filter((x) => x.p === a.id && x.s === 'todo');
      for (const x of s.steps) if (x.p === a.id && x.s === 'todo') x.s = 'ok';
      enqueue(s, approved, 'end');
      directive(s, 'ok', a.id);
      return `approved ${a.id}`;
    }
    case 'approveMany': {
      // Start several steps in the order the user picked them, before anything
      // else in line, and Claude hears one directive.
      const picked = [...new Set(a.ids)].map((id) => need(s, id)).filter((x) => !FINISHED.includes(x.s) && x.s !== 'run');
      if (!picked.length) throw new Error('nothing to start');
      for (const st of picked) for (const x of [st, ...descendants(s, st.id)]) if (x.s === 'todo' || x.s === 'block') x.s = 'ok';
      enqueue(s, picked.flatMap((st) => leavesUnder(s, st)), 'front');
      const ids = picked.map((x) => x.id);
      directive(s, 'ok', ids[0], ids.length > 1 ? ids.join(',') : undefined);
      return `approved ${ids.join(' > ')}`;
    }
    case 'hold': {
      // take back an approval that hasn't started: out of line, waiting again
      const st = need(s, a.id);
      const back = [st, ...descendants(s, st.id)].filter((x) => x.s === 'ok');
      if (!back.length) throw new Error(`${st.id} is not waiting to start`);
      for (const x of back) {
        x.s = 'todo';
        x.q = undefined;
      }
      enqueue(s, [], 'end'); // close the gap in the line
      return `on hold ${st.id}`;
    }
    case 'ask': {
      const st = need(s, a.id);
      st.ask = true;
      directive(s, 'ask', st.id);
      return `ask ${st.id}`;
    }
    case 'archive': {
      const at = now();
      const phaseIds = new Set(a.ids.filter((id) => findPhase(s, id)));
      const stepIds = new Set<string>();
      for (const id of a.ids) {
        const group = phaseIds.has(id) ? s.steps.filter((x) => x.p === id) : [need(s, id), ...descendants(s, id)];
        for (const x of group) stepIds.add(x.id);
      }
      const steps = s.steps.filter((x) => stepIds.has(x.id));
      if (steps.some((x) => x.s === 'run')) throw new Error('a running step cannot be archived');
      // unfinished work Claude might still plan to do: tell it to drop those
      const open = steps.filter((x) => !hasChildren(s, x.id) && ['todo', 'ok', 'block'].includes(x.s)).map((x) => x.id);
      s.steps = s.steps.filter((x) => !stepIds.has(x.id));
      s.archive.steps.push(...steps.map((x) => ({ ...x, q: undefined, arc: at })));
      s.archive.phases.push(...s.phases.filter((p) => phaseIds.has(p.id)).map((p) => ({ ...p, arc: at })));
      s.phases = s.phases.filter((p) => !phaseIds.has(p.id));
      if (open.length) directive(s, 'arch', undefined, open.join(','));
      return `archived ${a.ids.join(',')}`;
    }
    case 'unarchive': {
      const arch = s.archive;
      const restorePhase = (id: string) => {
        const i = arch.phases.findIndex((p) => p.id === id);
        if (i >= 0) s.phases.push({ ...arch.phases.splice(i, 1)[0], arc: undefined });
      };
      const restoreSteps = (pick: (x: Step) => boolean) => {
        const moved = arch.steps.filter(pick);
        arch.steps = arch.steps.filter((x) => !pick(x));
        s.steps.push(...moved.map((x) => ({ ...x, arc: undefined })));
        return moved;
      };
      const back: Step[] = [];
      for (const id of a.ids) {
        if (arch.phases.some((p) => p.id === id)) {
          restorePhase(id);
          back.push(...restoreSteps((x) => x.p === id));
          continue;
        }
        const archived = (sid: string | null) => (sid ? arch.steps.find((x) => x.id === sid) : undefined);
        let top = archived(id);
        if (!top) continue; // already restored with its phase or parent
        // bring back the top-most archived ancestor so the subtree stays whole
        for (let up = archived(top.parent); up; up = archived(up.parent)) top = up;
        if (!findPhase(s, top.p)) restorePhase(top.p);
        if (!findPhase(s, top.p)) throw new Error(`${top.p} not found`);
        if (top.parent && !findStep(s, top.parent)) top.parent = null;
        const ids = new Set([top.id]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const x of arch.steps) {
            if (x.parent && ids.has(x.parent) && !ids.has(x.id)) {
              ids.add(x.id);
              grew = true;
            }
          }
        }
        back.push(...restoreSteps((x) => ids.has(x.id)));
      }
      if (!back.length && !a.ids.some((id) => findPhase(s, id))) throw new Error('nothing to restore');
      const open = back.filter((x) => !hasChildren(s, x.id) && ['todo', 'ok', 'block'].includes(x.s)).map((x) => x.id);
      if (open.length) directive(s, 'unarch', undefined, open.join(','));
      return `restored ${a.ids.join(',')}`;
    }
    case 'reject': {
      const st = need(s, a.id);
      for (const x of [st, ...descendants(s, st.id)]) {
        if (x.s !== 'done') x.s = 'skip';
        x.q = undefined;
      }
      enqueue(s, [], 'end');
      directive(s, 'no', st.id);
      return `rejected ${st.id}`;
    }
    case 'retry': {
      const st = need(s, a.id);
      for (const x of [st, ...descendants(s, st.id)]) {
        x.s = 'ok';
        x.n = undefined;
        x.r = undefined;
        x.base = undefined;
        x.head = undefined;
        x.at = {};
        x.q = undefined;
      }
      enqueue(s, leavesUnder(s, st), 'end');
      directive(s, 'retry', st.id);
      return `retry ${st.id}`;
    }
    case 'split': {
      const st = need(s, a.id);
      directive(s, 'split', st.id);
      return `split requested ${st.id}`;
    }
    case 'addStep': {
      const parent = a.parent ? need(s, a.parent) : undefined;
      const phaseId = parent?.p ?? a.phase ?? phasesSorted(s).at(-1)?.id;
      if (!phaseId || !findPhase(s, phaseId)) throw new Error('phase not found');
      const [id] = addSteps(s, phaseId, parent?.id ?? null, [{ t: a.t, d: a.d?.trim() || undefined }], a.ok === false ? 'todo' : 'ok', 'user');
      enqueue(s, [findStep(s, id)!], 'end');
      directive(s, 'add', id, a.t);
      if (a.d?.trim()) directive(s, 'note', id, a.d.trim());
      return `added ${id}`;
    }
    case 'addPhase': {
      const id = nextPhaseId(s);
      s.phases.push({ id, t: a.t.trim(), o: s.phases.length });
      directive(s, 'add', id, a.t);
      return `added ${id}`;
    }
    case 'note': {
      if (a.id) need(s, a.id).un = a.x;
      directive(s, 'note', a.id, a.x);
      return `note ${a.id ?? ''}`.trim();
    }
    case 'reorder': {
      const st = need(s, a.id);
      const sibs = st.parent ? childrenOf(s, st.parent) : childrenOf(s, null, st.p);
      const rest = sibs.filter((x) => x.id !== st.id);
      const to = Math.min(a.to, rest.length);
      rest.splice(to, 0, st);
      rest.forEach((x, i) => (x.o = i));
      directive(s, 'prio', st.id, String(to + 1));
      return `${st.id} → #${to + 1}`;
    }
    case 'edit': {
      const st = need(s, a.id);
      st.t = a.t.trim();
      directive(s, 'edit', st.id, st.t);
      return `renamed ${st.id}`;
    }
    case 'setGuard': {
      s.cfg.guard = a.mode;
      directive(s, 'guard', undefined, a.mode);
      return `guard ${a.mode}`;
    }
    case 'setCfg': {
      if (a.budget !== undefined) s.cfg.budget = a.budget;
      if (a.autoApprove !== undefined) s.cfg.autoApprove = a.autoApprove;
      return 'settings';
    }
  }
}

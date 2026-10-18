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

const LOG_CAP = 200;
const INBOX_CAP = 100;

export const now = () => new Date().toISOString();

export function emptyState(name: string, goal?: string): State {
  return StateSchema.parse({ project: { name, goal } });
}

// ---------- lookups & ordering ----------

export const findStep = (s: State, id: string) => s.steps.find((x) => x.id === id);
export const findPhase = (s: State, id: string) => s.phases.find((x) => x.id === id);

const num = (id: string) => {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};

export function phaseNum(s: State, phaseId: string): number {
  const m = /^P(\d+)$/.exec(phaseId);
  if (m) return Number(m[1]);
  return s.phases.findIndex((p) => p.id === phaseId) + 1;
}

export function phasesSorted(s: State) {
  return [...s.phases].sort((a, b) => a.o - b.o);
}

export function childrenOf(s: State, parent: string | null, phase?: string): Step[] {
  return s.steps
    .filter((x) => x.parent === parent && (parent !== null || x.p === phase))
    .sort((a, b) => a.o - b.o);
}

export const hasChildren = (s: State, id: string) => s.steps.some((x) => x.parent === id);

export function descendants(s: State, id: string): Step[] {
  const out: Step[] = [];
  const walk = (pid: string) => {
    for (const c of s.steps.filter((x) => x.parent === pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** Steps in work order: phase order, then sibling order, depth-first. */
export function ordered(s: State): Step[] {
  const out: Step[] = [];
  const walk = (list: Step[]) => {
    for (const st of list) {
      out.push(st);
      walk(childrenOf(s, st.id));
    }
  };
  for (const p of phasesSorted(s)) walk(childrenOf(s, null, p.id));
  return out;
}

export const leaves = (s: State) => ordered(s).filter((x) => !hasChildren(s, x.id));

const FINISHED: StepStatus[] = ['done', 'skip'];

export function depsMet(s: State, st: Step): boolean {
  return st.deps.every((d) => {
    const dep = findStep(s, d);
    return !dep || FINISHED.includes(dep.s);
  });
}

export function unmetDeps(s: State, st: Step): string[] {
  return st.deps.filter((d) => {
    const dep = findStep(s, d);
    return dep && !FINISHED.includes(dep.s);
  });
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
      return `ok ${t}`;
    case 'no':
      return `skip ${t}`;
    case 'split':
      return `split ${t}`;
    case 'note':
      return t ? `${t} note:${q(d.x ?? '', 120)}` : `note:${q(d.x ?? '', 120)}`;
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
  }
}

export const fmtDirectives = (ds: Directive[]) => ds.map(fmtDirective).join('; ');

// ---------- ids ----------

function nextPhaseId(s: State) {
  return 'P' + (Math.max(0, ...s.phases.map((p) => num(p.id))) + 1);
}

function nextStepId(s: State, phaseId: string, parentId: string | null) {
  const prefix = parentId ? `${parentId}.` : `S${phaseNum(s, phaseId)}.`;
  const used = s.steps
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

export function phaseComplete(s: State, phaseId: string) {
  const ls = s.steps.filter((x) => x.p === phaseId && !hasChildren(s, x.id));
  return ls.length > 0 && ls.every((x) => FINISHED.includes(x.s));
}

export const phaseSnapshot = (s: State) =>
  new Map(s.phases.map((p) => [p.id, phaseComplete(s, p.id)]));

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
      // refining an approved step keeps its approval
      const st: StepStatus = ['ok', 'run'].includes(parent.s) ? 'ok' : initial;
      const ids = addSteps(s, parent.p, parent.id, a.steps, st, 'claude');
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
    applied.push(op.id);
    log(s, `${st.id} ${op.s ?? 'note'}${op.n ? ` · ${op.n}` : ''}`, op.s ?? 'note');
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
      if (st.s === 'ok' || !st.base) st.base = git.tree;
      st.at = { run: now() };
    }
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
      directive(s, 'ok', st.id);
      return `approved ${st.id}`;
    }
    case 'approvePhase': {
      if (!findPhase(s, a.id)) throw new Error(`${a.id} not found`);
      for (const x of s.steps) if (x.p === a.id && x.s === 'todo') x.s = 'ok';
      directive(s, 'ok', a.id);
      return `approved ${a.id}`;
    }
    case 'reject': {
      const st = need(s, a.id);
      for (const x of [st, ...descendants(s, st.id)]) if (x.s !== 'done') x.s = 'skip';
      directive(s, 'no', st.id);
      return `rejected ${st.id}`;
    }
    case 'retry': {
      const st = need(s, a.id);
      for (const x of [st, ...descendants(s, st.id)]) {
        x.s = 'ok';
        x.r = undefined;
        x.base = undefined;
        x.head = undefined;
        x.at = {};
      }
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
      const [id] = addSteps(s, phaseId, parent?.id ?? null, [a.t], 'ok', 'user');
      directive(s, 'add', id, a.t);
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

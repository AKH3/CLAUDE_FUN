// The resume line Claude reads instead of chat history. Budget: < 100 tokens.
import { depsMet, fmtDirectives, hasChildren, leaves, phasesSorted } from './ops.js';
import type { Directive, State, Step, Usage } from './schema.js';

const title = (st: Step, max = 36) => JSON.stringify(st.t.length > max ? st.t.slice(0, max - 1) + '…' : st.t);

export const kfmt = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export const usedTokens = (u?: Usage) => (u ? u.total.in + u.total.cw + u.total.out : 0);

/** Next approved step whose deps are met: queued (batch-started) steps first, in queue order. */
export function nextStep(s: State): Step | undefined {
  const ready = leaves(s).filter((x) => x.s === 'ok' && depsMet(s, x));
  const queued = ready.filter((x) => x.q !== undefined).sort((x, y) => x.q! - y.q!);
  return queued[0] ?? ready[0];
}

/**
 * Steps still "run" when a session starts were left by an earlier session that
 * ended before reporting them (the board only knows what Claude reports).
 */
function staleLines(running: Step[]): string[] {
  const lines = [`stale ${running.length} step(s) still "run" from an earlier session: verify each (diff, tests), then update done or fail`];
  for (const st of running.slice(0, 4)) lines.push(` ${st.id} ${title(st)}${st.n ? ` n:${JSON.stringify(st.n)}` : ''}`);
  if (running.length > 4) lines.push(` +${running.length - 4} more`);
  return lines;
}

export function summary(
  s: State,
  opts: { usage?: Usage; msgs?: Directive[]; url?: string; stale?: boolean } = {},
): string {
  const ls = leaves(s).filter((x) => x.s !== 'skip');
  if (!s.phases.length) {
    const lines = [`${s.project.name} r${s.rev} | empty board -> call plan`];
    if (opts.msgs?.length) lines.push(`msg ${fmtDirectives(opts.msgs)}`);
    if (opts.url) lines.push(`board ${opts.url}`);
    return lines.join('\n');
  }

  const done = ls.filter((x) => x.s === 'done').length;
  const phase =
    phasesSorted(s).find((p) => ls.some((x) => x.p === p.id && x.s !== 'done')) ?? phasesSorted(s).at(-1)!;
  const pl = ls.filter((x) => x.p === phase.id);
  const pDone = pl.filter((x) => x.s === 'done').length;

  let head = `${s.project.name} r${s.rev} | ${phase.id} ${JSON.stringify(phase.t)} ${pDone}/${pl.length} | all ${done}/${ls.length}`;
  if (opts.usage) head += ` | tok ${kfmt(usedTokens(opts.usage))}/${kfmt(s.cfg.budget)}`;
  if (s.cfg.guard !== 'strict') head += ` | guard ${s.cfg.guard}`;
  const lines = [head];

  const running = ls.filter((x) => x.s === 'run');
  if (opts.stale && running.length) lines.push(...staleLines(running));
  else for (const st of running.slice(0, 2)) lines.push(`now ${st.id} ${title(st)}`);

  const next = nextStep(s);
  if (next && !running.length) lines.push(`next ${next.id} ${title(next)}`);

  const waiting = ls.filter((x) => x.s === 'todo');
  if (waiting.length) {
    const more = waiting.length > 1 ? ` +${waiting.length - 1}` : '';
    lines.push(`wait ${waiting[0].id} ${title(waiting[0], 28)}${more} need approval`);
  }

  const failed = ls.filter((x) => x.s === 'fail' || x.s === 'block');
  if (failed.length) lines.push(`${failed[0].s} ${failed.map((x) => x.id).slice(0, 4).join(',')}`);

  if (!running.length && !next && !waiting.length && done === ls.length) lines.push('all done');
  else if (!running.length && !next && waiting.length) lines.push('-> await');

  // questions Claude was told about but hasn't answered yet (e.g. the session ended)
  const fresh = new Set(opts.msgs?.filter((d) => d.k === 'ask').map((d) => d.s));
  const asks = s.steps.filter((x) => x.ask && !fresh.has(x.id));
  if (asks.length) lines.push(`ask ${asks.map((x) => x.id).slice(0, 4).join(',')}`);

  if (opts.msgs?.length) lines.push(`msg ${fmtDirectives(opts.msgs)}`);
  if (opts.url) lines.push(`board ${opts.url}`);
  return lines.join('\n');
}

/** What to tell Claude right after an update. */
export function afterUpdate(s: State, ids: string[]): string {
  const touched = ids.map((id) => s.steps.find((x) => x.id === id)).filter(Boolean) as Step[];
  const running = leaves(s).some((x) => x.s === 'run');
  if (running) return '';
  if (touched.some((x) => x.s === 'done' || x.s === 'fail' || hasChildren(s, x.id))) {
    const next = nextStep(s);
    if (next) return `next ${next.id} ${title(next)}`;
    const waiting = leaves(s).filter((x) => x.s === 'todo');
    if (waiting.length) return `wait ${waiting[0].id} need approval -> await`;
    if (leaves(s).every((x) => x.s === 'done' || x.s === 'skip')) return 'all done';
  }
  return '';
}

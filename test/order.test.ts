// The run line: the order the user sets on the board is the order Claude
// works in, one step at a time, and the engine refuses anything else.
import { describe, expect, it } from 'vitest';
import { applyAction, applyDeltas, applyPlan, emptyState, findStep, fmtDirectives, runLine, takeUnread } from '../src/core/ops.js';
import { nextStep, summary } from '../src/core/summary.js';

/** Six independent steps, like phase 3 of the LawyerBag board. */
function board() {
  const s = emptyState('Order');
  applyPlan(s, { phases: [{ t: 'Memo', steps: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] }, { t: 'Client', steps: ['A', 'B', 'C'] }] });
  return s;
}
const ids = (s: ReturnType<typeof board>) => runLine(s).map((x) => x.id);
const run = (s: ReturnType<typeof board>, id: string) => applyDeltas(s, [{ id, s: 'run' }]).errors;
const finish = (s: ReturnType<typeof board>, id: string) => applyDeltas(s, [{ id, s: 'done' }]).errors;

describe('the run line', () => {
  it('refuses a step out of the picked order, and a second step while one runs', () => {
    const s = board();
    applyAction(s, { type: 'approveMany', ids: ['S1.1', 'S1.3', 'S1.4', 'S1.5', 'S1.6'] });
    expect(run(s, 'S1.1')).toEqual([]);
    finish(s, 'S1.1');
    expect(run(s, 'S1.5')).toEqual(["S1.5 is not next: the user's order runs S1.3 first"]);
    expect(run(s, 'S1.3')).toEqual([]);
    // what happened on the real board: two steps started together
    expect(run(s, 'S1.4')).toEqual(['S1.4 waits: S1.3 is still running; report it done or fail first']);
    finish(s, 'S1.3');
    // skipping S1.4 is refused too; Claude has to block it with a reason instead
    expect(run(s, 'S1.5')).toEqual(["S1.5 is not next: the user's order runs S1.4 first"]);
    applyDeltas(s, [{ id: 'S1.4', s: 'block', n: 'needs a decision' }]);
    expect(run(s, 'S1.5')).toEqual([]);
  });

  it('lines single starts up in the order they were pressed', () => {
    const s = board();
    applyAction(s, { type: 'approve', id: 'S1.4' });
    applyAction(s, { type: 'approve', id: 'S1.2' });
    applyAction(s, { type: 'approve', id: 'S1.4' }); // pressing again keeps its place
    applyAction(s, { type: 'approvePhase', id: 'P2' });
    expect(ids(s)).toEqual(['S1.4', 'S1.2', 'S2.1', 'S2.2', 'S2.3']);
    expect(nextStep(s)!.id).toBe('S1.4');
    expect(run(s, 'S1.2')).toEqual(["S1.2 is not next: the user's order runs S1.4 first"]);
  });

  it('puts a new "start in order" ahead of an old leftover', () => {
    const s = board();
    // yesterday: S1.4 was picked but never run
    applyAction(s, { type: 'approveMany', ids: ['S1.1', 'S1.4'] });
    run(s, 'S1.1');
    finish(s, 'S1.1');
    // today: the user picks phase 2 in order
    applyAction(s, { type: 'approveMany', ids: ['S2.1', 'S2.2', 'S2.3'] });
    expect(ids(s)).toEqual(['S2.1', 'S2.2', 'S2.3', 'S1.4']);
    expect(nextStep(s)!.id).toBe('S2.1');
    expect(fmtDirectives(takeUnread(s))).toContain('ok S2.1,S2.2,S2.3 in order');
    const text = summary(s);
    expect(text).toContain('next S2.1 "A"');
    expect(text).toContain('then S2.2>S2.3>S1.4');
  });

  it('a step the user takes back leaves the line and waits again', () => {
    const s = board();
    applyAction(s, { type: 'approveMany', ids: ['S1.4', 'S2.1'] });
    applyAction(s, { type: 'hold', id: 'S1.4' });
    expect(findStep(s, 'S1.4')!.s).toBe('todo');
    expect(ids(s)).toEqual(['S2.1']);
    expect(findStep(s, 'S2.1')!.q).toBe(1);
    expect(run(s, 'S1.4')).toEqual(['S1.4 needs approval']);
    expect(() => applyAction(s, { type: 'hold', id: 'S1.4' })).toThrow('not waiting to start');
  });

  it('rejecting and retrying move steps out of and back into line', () => {
    const s = board();
    applyAction(s, { type: 'approveMany', ids: ['S1.1', 'S1.2', 'S1.3'] });
    applyAction(s, { type: 'reject', id: 'S1.2' });
    expect(ids(s)).toEqual(['S1.1', 'S1.3']);
    run(s, 'S1.1');
    applyDeltas(s, [{ id: 'S1.1', s: 'fail' }]);
    applyAction(s, { type: 'retry', id: 'S1.1' });
    expect(ids(s)).toEqual(['S1.3', 'S1.1']);
  });

  it('a split step hands its place in line to its substeps', () => {
    const s = board();
    applyAction(s, { type: 'approveMany', ids: ['S1.2', 'S1.5', 'S1.6'] });
    applyPlan(s, { parent: 'S1.5', steps: ['5a', '5b'] });
    expect(ids(s)).toEqual(['S1.2', 'S1.5.1', 'S1.5.2', 'S1.6']);
    expect(findStep(s, 'S1.5')!.q).toBeUndefined();
  });

  it('without a line, any ready approved step may start', () => {
    const s = board();
    s.cfg.autoApprove = true;
    applyPlan(s, { phases: [{ t: 'Auto', steps: ['x', 'y'] }] });
    expect(ids(s)).toEqual([]);
    expect(run(s, 'S3.2')).toEqual([]);
  });

  it('a step whose deps are not done is passed over, not waited on', () => {
    const s = emptyState('Deps');
    applyPlan(s, { phases: [{ t: 'P', steps: ['base', { t: 'top', deps: ['#1'] }, 'side'] }] });
    applyAction(s, { type: 'approveMany', ids: ['S1.2', 'S1.3'] });
    expect(nextStep(s)!.id).toBe('S1.3');
    expect(run(s, 'S1.3')).toEqual([]);
  });
});

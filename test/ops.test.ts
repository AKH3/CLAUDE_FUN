import { describe, expect, it } from 'vitest';
import { applyAction, applyDeltas, applyPlan, emptyState, findStep, ordered, runLine, takeUnread, fmtDirectives } from '../src/core/ops.js';
import { afterUpdate, nextStep, summary } from '../src/core/summary.js';

function planned() {
  const s = emptyState('Demo');
  applyPlan(s, {
    phases: [
      { t: 'Setup', steps: ['Init repo', { t: 'Add tsup', deps: ['#1'] }] },
      { t: 'API', steps: ['Hono server', 'SSE', 'Zod'] },
    ],
  });
  return s;
}

describe('plan', () => {
  it('assigns hierarchical ids and resolves #n deps', () => {
    const s = planned();
    expect(s.phases.map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(ordered(s).map((x) => x.id)).toEqual(['S1.1', 'S1.2', 'S2.1', 'S2.2', 'S2.3']);
    expect(findStep(s, 'S1.2')!.deps).toEqual(['S1.1']);
    expect(s.steps.every((x) => x.s === 'todo')).toBe(true);
  });

  it('splits a step and keeps approval on refinement', () => {
    const s = planned();
    applyAction(s, { type: 'approve', id: 'S2.1' });
    const out = applyPlan(s, { parent: 'S2.1', steps: ['routes', 'static'] });
    expect(out).toContain('S2.1> S2.1.1,S2.1.2');
    expect(findStep(s, 'S2.1.1')!.s).toBe('ok');
    expect(findStep(s, 'S2.1')!.s).toBe('ok');
  });
});

describe('approval gate', () => {
  it('refuses run on an unapproved step', () => {
    const s = planned();
    const { errors } = applyDeltas(s, [{ id: 'S1.1', s: 'run' }]);
    expect(errors).toEqual(['S1.1 needs approval']);
    expect(findStep(s, 'S1.1')!.s).toBe('todo');
  });

  it('refuses run while deps are unfinished', () => {
    const s = planned();
    applyAction(s, { type: 'approvePhase', id: 'P1' });
    expect(applyDeltas(s, [{ id: 'S1.2', s: 'run' }]).errors).toEqual(['S1.2 blocked by S1.1']);
    expect(applyDeltas(s, [{ id: 'S1.1', s: 'run' }]).errors).toEqual([]);
    applyDeltas(s, [{ id: 'S1.1', s: 'done', n: 'ok', t: 'pass' }]);
    expect(applyDeltas(s, [{ id: 'S1.2', s: 'run' }]).errors).toEqual([]);
  });

  it('records git trees and result capsule', () => {
    const s = planned();
    applyAction(s, { type: 'approve', id: 'S2.2' });
    applyDeltas(s, [{ id: 'S2.2', s: 'run' }], { tree: 'aaa' });
    applyDeltas(s, [{ id: 'S2.2', s: 'done', t: 'pass' }], {
      tree: 'bbb',
      stat: (b, h) => (b === 'aaa' && h === 'bbb' ? { files: ['a.ts', 'b.ts'], ins: 10, del: 2 } : undefined),
    });
    const st = findStep(s, 'S2.2')!;
    expect(st.r).toMatchObject({ f: 2, ins: 10, del: 2, t: 'pass' });
    expect(st.base).toBe('aaa');
    expect(st.head).toBe('bbb');
  });

  it('rolls container status up and logs phase completion', () => {
    const s = planned();
    applyAction(s, { type: 'approvePhase', id: 'P1' });
    applyPlan(s, { parent: 'S1.1', steps: ['a', 'b'] });
    applyDeltas(s, [{ id: 'S1.1.1', s: 'run' }]);
    expect(findStep(s, 'S1.1')!.s).toBe('run');
    expect(applyDeltas(s, [{ id: 'S1.1', s: 'done' }]).errors).toEqual(['S1.1 has substeps']);
    applyDeltas(s, [
      { id: 'S1.1.1', s: 'done' },
      { id: 'S1.1.2', s: 'done' },
      { id: 'S1.2', s: 'done' },
    ]);
    expect(findStep(s, 'S1.1')!.s).toBe('done');
    expect(s.log.some((l) => l.k === 'phase' && l.m === 'P1 complete')).toBe(true);
  });
});

describe('user actions become silent directives', () => {
  it('reorders, notes and delivers each directive once', () => {
    const s = planned();
    applyAction(s, { type: 'reorder', id: 'S2.3', to: 0 });
    applyAction(s, { type: 'note', id: 'S2.3', x: 'use zod v4' });
    applyAction(s, { type: 'split', id: 'S2.1' });
    expect(ordered(s).filter((x) => x.p === 'P2').map((x) => x.id)).toEqual(['S2.3', 'S2.1', 'S2.2']);
    const msgs = takeUnread(s);
    expect(fmtDirectives(msgs)).toBe('S2.3 prio 1; S2.3 note:"use zod v4"; split S2.1');
    expect(takeUnread(s)).toEqual([]);
  });
});

describe('summary', () => {
  it('stays tiny for a 20-step plan', () => {
    const s = emptyState('MyApp');
    applyPlan(s, {
      phases: Array.from({ length: 4 }, (_, i) => ({
        t: `Phase number ${i + 1}`,
        steps: Array.from({ length: 5 }, (_, j) => `Implement feature ${i + 1}.${j + 1} with some detail`),
      })),
    });
    applyAction(s, { type: 'approvePhase', id: 'P1' });
    applyDeltas(s, [{ id: 'S1.1', s: 'run' }]);
    applyDeltas(s, [{ id: 'S1.1', s: 'done' }]);
    applyAction(s, { type: 'note', id: 'S1.2', x: 'prefer small files' });
    const text = summary(s, {
      usage: { total: { in: 1000, out: 20000, cw: 30000, cr: 900000 }, steps: {}, phases: {} },
      msgs: takeUnread(s),
      url: 'http://localhost:3000',
    });
    expect(text.length).toBeLessThan(400);
    expect(text).toContain('next S1.2');
    expect(text).toContain('tok 51k/250k');
    expect(text).toContain('msg ok P1; S1.2 note:"prefer small files"');
  });

  it('flags steps an earlier session left running when a session starts', () => {
    const s = planned();
    applyAction(s, { type: 'approveMany', ids: ['S1.1', 'S2.1'] });
    applyDeltas(s, [{ id: 'S1.1', s: 'run', n: 'tested, awaiting suite' }]);
    // the engine runs one step at a time now, but boards from older versions can hold two
    findStep(s, 'S2.1')!.s = 'run';

    const start = summary(s, { stale: true });
    expect(start).toContain('stale 2 step(s) still "run" from an earlier session');
    expect(start).toContain(' S1.1 "Init repo" n:"tested, awaiting suite"');
    expect(start).toContain(' S2.1 "Hono server"');
    expect(start).not.toContain('now ');

    // mid-session the same steps are just the current work
    const mid = summary(s);
    expect(mid).toContain('now S1.1');
    expect(mid).not.toContain('stale');

    applyDeltas(s, [{ id: 'S1.1', s: 'done' }, { id: 'S2.1', s: 'done' }]);
    expect(summary(s, { stale: true })).not.toContain('stale');
  });
});

describe('effort', () => {
  it('keeps the effort Claude gives in plan and update', () => {
    const s = emptyState('E');
    applyPlan(s, { phases: [{ t: 'A', steps: [{ t: 'small', e: 1 }, 'no estimate'] }] });
    expect(findStep(s, 'S1.1')!.e).toBe(1);
    expect(findStep(s, 'S1.2')!.e).toBeUndefined();
    applyDeltas(s, [{ id: 'S1.2', e: 3 }]);
    expect(findStep(s, 'S1.2')!.e).toBe(3);
  });
});

describe('ask', () => {
  it('sends one short directive and stores the answer', () => {
    const s = planned();
    applyAction(s, { type: 'ask', id: 'S2.2' });
    expect(findStep(s, 'S2.2')!.ask).toBe(true);
    expect(fmtDirectives(takeUnread(s))).toBe('ask S2.2');
    // the question is still listed on resume until Claude answers it
    expect(summary(s)).toContain('ask S2.2');
    // answering works on a step that is not approved yet, and changes nothing else
    const { errors } = applyDeltas(s, [{ id: 'S2.2', a: 'Adds SSE so the board updates live.' }]);
    expect(errors).toEqual([]);
    const st = findStep(s, 'S2.2')!;
    expect(st.a).toBe('Adds SSE so the board updates live.');
    expect(st.ask).toBeUndefined();
    expect(st.s).toBe('todo');
    expect(summary(s)).not.toContain('ask S2.2');
  });
});

describe('batch start', () => {
  it('approves several steps and runs them in the picked order', () => {
    const s = planned();
    applyAction(s, { type: 'approveMany', ids: ['S2.3', 'S1.1', 'S2.1'] });
    expect(['S2.3', 'S1.1', 'S2.1'].map((id) => findStep(s, id)!.s)).toEqual(['ok', 'ok', 'ok']);
    expect(findStep(s, 'S2.2')!.s).toBe('todo');
    expect(fmtDirectives(takeUnread(s))).toBe('ok S2.3,S1.1,S2.1 in order');

    expect(nextStep(s)!.id).toBe('S2.3');
    applyDeltas(s, [{ id: 'S2.3', s: 'run' }]);
    expect(findStep(s, 'S2.3')!.q).toBeUndefined();
    applyDeltas(s, [{ id: 'S2.3', s: 'done' }]);
    expect(afterUpdate(s, ['S2.3'])).toBe('next S1.1 "Init repo"');
    applyDeltas(s, [{ id: 'S1.1', s: 'run' }]);
    applyDeltas(s, [{ id: 'S1.1', s: 'done' }]);
    expect(nextStep(s)!.id).toBe('S2.1');
  });

  it('puts a later batch in front of an earlier one and skips steps it cannot start', () => {
    const s = planned();
    applyAction(s, { type: 'approveMany', ids: ['S2.2'] });
    applyAction(s, { type: 'approveMany', ids: ['S2.1', 'S1.1'] });
    expect(runLine(s).map((x) => x.id)).toEqual(['S2.1', 'S1.1', 'S2.2']);
    expect(fmtDirectives(takeUnread(s))).toBe('ok S2.2; ok S2.1,S1.1 in order');
    applyAction(s, { type: 'reject', id: 'S2.3' });
    expect(() => applyAction(s, { type: 'approveMany', ids: ['S2.3'] })).toThrow('nothing to start');
  });
});

describe('add with details', () => {
  it('stores details, tells Claude, and can wait for approval', () => {
    const s = planned();
    applyAction(s, { type: 'addStep', phase: 'P2', t: 'Rate limit', d: 'per IP, 100/min', ok: false });
    const st = findStep(s, 'S2.4')!;
    expect([st.s, st.d, st.by]).toEqual(['todo', 'per IP, 100/min', 'user']);
    expect(fmtDirectives(takeUnread(s))).toBe('+S2.4 "Rate limit" (user); S2.4 note:"per IP, 100/min"');
    applyAction(s, { type: 'addStep', phase: 'P2', t: 'Quick one' });
    expect(findStep(s, 'S2.5')!.s).toBe('ok');
  });
});

describe('archive', () => {
  it('moves finished phases off the board and out of the summary', () => {
    const s = planned();
    applyAction(s, { type: 'approvePhase', id: 'P1' });
    for (const id of ['S1.1', 'S1.2']) applyDeltas(s, [{ id, s: 'run' }, { id, s: 'done' }]);
    takeUnread(s);
    applyAction(s, { type: 'archive', ids: ['P1'] });
    expect(s.phases.map((p) => p.id)).toEqual(['P2']);
    expect(s.archive.phases.map((p) => p.id)).toEqual(['P1']);
    expect(s.archive.steps.map((x) => x.id)).toEqual(['S1.1', 'S1.2']);
    expect(s.archive.steps[0].arc).toBeTruthy();
    expect(takeUnread(s)).toEqual([]); // nothing unfinished, so Claude hears nothing
    expect(summary(s)).not.toContain('S1.');
    // new ids never reuse archived ones
    applyAction(s, { type: 'addPhase', t: 'Later' });
    expect(s.phases.at(-1)!.id).toBe('P3');
  });

  it('archives a subtree, tells Claude to drop unfinished work, and restores it whole', () => {
    const s = planned();
    applyPlan(s, { parent: 'S2.1', steps: ['routes', 'static'] });
    applyAction(s, { type: 'archive', ids: ['S2.1.2', 'S2.1'] });
    expect(s.steps.map((x) => x.id)).toEqual(['S1.1', 'S1.2', 'S2.2', 'S2.3']);
    expect(fmtDirectives(takeUnread(s))).toBe('archived S2.1.1,S2.1.2 (drop)');

    applyAction(s, { type: 'addStep', phase: 'P2', t: 'next' });
    expect(findStep(s, 'S2.4')).toBeTruthy(); // S2.1 stays reserved

    applyAction(s, { type: 'unarchive', ids: ['S2.1.2'] }); // a child brings its parent back
    expect(['S2.1', 'S2.1.1', 'S2.1.2'].every((id) => findStep(s, id) && !findStep(s, id)!.arc)).toBe(true);
    expect(s.archive.steps).toEqual([]);
    expect(fmtDirectives(takeUnread(s))).toContain('restored S2.1.1,S2.1.2');
  });

  it('restores a step together with its archived phase, and refuses running steps', () => {
    const s = planned();
    applyAction(s, { type: 'archive', ids: ['P1'] });
    applyAction(s, { type: 'unarchive', ids: ['S1.2'] });
    expect(s.phases.map((p) => p.id).sort()).toEqual(['P1', 'P2']);
    expect(findStep(s, 'S1.2')).toBeTruthy();
    expect(s.archive.steps.map((x) => x.id)).toEqual(['S1.1']);

    applyAction(s, { type: 'approve', id: 'S2.2' });
    applyDeltas(s, [{ id: 'S2.2', s: 'run' }]);
    expect(() => applyAction(s, { type: 'archive', ids: ['P2'] })).toThrow('running');
    expect(() => applyAction(s, { type: 'unarchive', ids: ['S9.9'] })).toThrow('nothing to restore');
  });
});

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, applyPlan } from '../src/core/ops.js';
import { Store } from '../src/core/store.js';
import { tempDir, TSX } from './helpers.js';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('Store', () => {
  it('initialises and bumps rev on every mutation', () => {
    const t = tempDir();
    cleanup = t.done;
    const store = new Store(t.dir);
    expect(store.init('X')).toBe(true);
    expect(store.init('X')).toBe(false);
    store.mutate((s) => applyPlan(s, { phases: [{ t: 'A', steps: ['one'] }] }));
    expect(store.read().rev).toBe(1);
    expect(store.rev()).toBe(1);
  });

  it('does not lose updates across concurrent processes', async () => {
    const t = tempDir();
    cleanup = t.done;
    const store = new Store(t.dir);
    store.init('X');
    store.mutate((s) => applyPlan(s, { phases: [{ t: 'A' }] }));

    const script = join(t.dir, 'writer.mjs');
    const storeUrl = new URL('../src/core/store.ts', import.meta.url).href;
    const opsUrl = new URL('../src/core/ops.ts', import.meta.url).href;
    writeFileSync(
      script,
      `import { Store } from ${JSON.stringify(storeUrl)};
       import { applyAction } from ${JSON.stringify(opsUrl)};
       const s = new Store(process.argv[2]);
       for (let i = 0; i < 25; i++) s.mutate((st) => applyAction(st, { type: 'addStep', phase: 'P1', t: process.argv[3] + i }));`,
    );
    const run = (tag: string) =>
      new Promise<number>((res) => {
        const p = spawn(process.execPath, ['--import', TSX, script, t.dir, tag], { stdio: 'inherit' });
        p.on('exit', (c) => res(c ?? 1));
      });
    const codes = await Promise.all([run('a'), run('b'), run('c')]);
    expect(codes).toEqual([0, 0, 0]);
    const s = store.read();
    expect(s.steps).toHaveLength(75);
    expect(new Set(s.steps.map((x) => x.id)).size).toBe(75);
    expect(s.rev).toBe(76);
  }, 60_000);

  it('approve on a phase id approves the whole phase', () => {
    const t = tempDir();
    cleanup = t.done;
    const store = new Store(t.dir);
    store.init();
    store.mutate((s) => applyPlan(s, { phases: [{ t: 'A', steps: ['1', '2'] }] }));
    store.mutate((s) => applyAction(s, { type: 'approve', id: 'P1' }));
    expect(store.read().steps.map((x) => x.s)).toEqual(['ok', 'ok']);
  });
});

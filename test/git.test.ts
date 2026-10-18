import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diff, numstat, snapshot } from '../src/core/git.js';
import { gitInit, tempDir } from './helpers.js';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('git snapshots', () => {
  it('captures untracked changes without commits and ignores the board dir', () => {
    const t = tempDir();
    cleanup = t.done;
    gitInit(t.dir);
    writeFileSync(join(t.dir, 'a.txt'), 'one\ntwo\n');
    const base = snapshot(t.dir)!;
    expect(base).toMatch(/^[0-9a-f]{40,64}$/);

    writeFileSync(join(t.dir, 'a.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(t.dir, 'b.txt'), 'new\n');
    mkdirSync(join(t.dir, '.claude-board'), { recursive: true });
    writeFileSync(join(t.dir, '.claude-board', 'state.json'), '{}');
    const head = snapshot(t.dir)!;

    const stat = numstat(t.dir, base, head)!;
    expect(stat.files.sort()).toEqual(['a.txt', 'b.txt']);
    expect(stat.ins).toBe(3);
    expect(stat.del).toBe(1);
    expect(diff(t.dir, base, head, 'a.txt')).toContain('+TWO');
  });

  it('returns undefined outside a repo', () => {
    const t = tempDir();
    cleanup = t.done;
    expect(snapshot(t.dir)).toBeUndefined();
  });
});

// The board wakes an idle Claude: a background hook (asyncRewake) waits for a
// click that needs Claude, takes it from the inbox and exits 2 with the text.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeStatus } from '../src/core/listen.js';
import { applyAction, applyPlan, emptyState, findStep, takeUnread, unread, wakes } from '../src/core/ops.js';
import { Store } from '../src/core/store.js';
import { watchBoard } from '../src/hooks/index.js';
import { tempDir, TSX } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function board() {
  const t = tempDir('cfun-wake-');
  cleanup = t.done;
  const store = new Store(t.dir);
  store.init('W');
  store.mutate((s) => applyPlan(s, { phases: [{ t: 'Core', steps: [{ t: 'One', a: 'Builds one. Helps two.' }, 'Two', 'Three'] }] }));
  return { dir: t.dir, store };
}

const fast = { tick: 20, parent: process.pid };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A pid that surely belongs to no running process. */
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid!;

describe('plan-time explanations', () => {
  it('keeps the "?" answer Claude writes with the plan', () => {
    const s = emptyState('P');
    applyPlan(s, { phases: [{ t: 'Core', steps: [{ t: 'Login', a: '  Adds sign-in, so only members see orders.  ' }, 'Bare'] }] });
    expect(findStep(s, 'S1.1')!.a).toBe('Adds sign-in, so only members see orders.');
    expect(findStep(s, 'S1.2')!.a).toBeUndefined();
  });
});

describe('which clicks wake Claude', () => {
  it('wakes for work and questions, not for housekeeping', () => {
    const s = emptyState('P');
    applyPlan(s, { phases: [{ t: 'Core', steps: ['A', 'B', 'C'] }] });
    applyAction(s, { type: 'approve', id: 'S1.1' });
    applyAction(s, { type: 'ask', id: 'S1.2' });
    applyAction(s, { type: 'note', x: 'plan: a login page' });
    applyAction(s, { type: 'note', id: 'S1.3', x: 'later' });
    applyAction(s, { type: 'reorder', id: 'S1.3', to: 0 });
    applyAction(s, { type: 'setGuard', mode: 'off' });
    applyAction(s, { type: 'edit', id: 'S1.2', t: 'B2' });
    applyAction(s, { type: 'addStep', phase: 'P1', t: 'mine, start now', ok: true });
    applyAction(s, { type: 'addStep', phase: 'P1', t: 'mine, wait', ok: false });
    const kinds = unread(s).map((d) => `${d.k}${d.s ? ' ' + d.s : ''}:${wakes(s, d)}`);
    expect(kinds).toEqual([
      'ok S1.1:true',
      'ask S1.2:true',
      'note:true',
      'note S1.3:false',
      'prio S1.3:false',
      'guard:false',
      'edit S1.2:false',
      'add S1.4:true',
      'add S1.5:false',
    ]);
  });
});

describe('watchBoard', () => {
  it('wakes an idle Claude on a click and hands it the directive', async () => {
    const { store } = board();
    const watching = watchBoard(store, 'Stop', fast);
    await sleep(60);
    expect(store.readJson<any>(store.p.listen)).toMatchObject({ mode: 'idle', pid: process.pid });
    store.mutate((s) => applyAction(s, { type: 'approve', id: 'S1.2' }));
    const text = await watching;
    expect(text).toContain('the user clicked on the board.');
    expect(text).toContain('msg ok S1.2');
    expect(text).toContain('next S1.2');
    expect(unread(store.read())).toEqual([]); // delivered once
    expect(store.readJson<any>(store.p.listen).mode).toBe('busy');
  });

  it('keeps waiting through housekeeping clicks', async () => {
    const { store } = board();
    let woke: string | undefined;
    const watching = watchBoard(store, 'Stop', fast).then((x) => (woke = x));
    store.mutate((s) => applyAction(s, { type: 'reorder', id: 'S1.3', to: 0 }));
    store.mutate((s) => applyAction(s, { type: 'setGuard', mode: 'sensitive' }));
    await sleep(150);
    expect(woke).toBeUndefined();
    store.mutate((s) => applyAction(s, { type: 'ask', id: 'S1.2' }));
    await watching;
    // the waiting housekeeping rides along with the question
    expect(woke).toContain('msg S1.3 prio 1; guard sensitive; ask S1.2');
  });

  it('wakes at once for clicks left over from the turn that just ended', async () => {
    const { store } = board();
    store.mutate((s) => applyAction(s, { type: 'note', x: 'also add a footer' }));
    expect(await watchBoard(store, 'Stop', fast)).toContain('msg note:"also add a footer"');
  });

  it('leaves quietly when a newer watcher takes over', async () => {
    const { store } = board();
    const first = watchBoard(store, 'Stop', fast);
    await sleep(60);
    const second = watchBoard(store, 'UserPromptSubmit', { ...fast, grace: 10_000 });
    expect(await first).toBeUndefined();
    store.mutate((s) => applyAction(s, { type: 'approve', id: 'S1.1' }));
    // mid-turn Claude's own board calls pick the click up within the grace period
    await sleep(100);
    store.mutate((s) => takeUnread(s));
    const third = watchBoard(store, 'Stop', fast); // the turn ends; stop the second one
    expect(await second).toBeUndefined();
    store.mutate((s) => applyAction(s, { type: 'split', id: 'S1.3' }));
    expect(await third).toContain('msg split S1.3');
  });

  it('mid-turn, steps in once the grace period passes', async () => {
    const { store } = board();
    const watching = watchBoard(store, 'UserPromptSubmit', { ...fast, grace: 150 });
    store.mutate((s) => applyAction(s, { type: 'ask', id: 'S1.3' }));
    const start = Date.now();
    expect(await watching).toContain('msg ask S1.3');
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });

  it('at session start leaves earlier clicks to the session-start hook', async () => {
    const { store } = board();
    store.mutate((s) => applyAction(s, { type: 'approve', id: 'S1.1' }));
    let woke: string | undefined;
    const watching = watchBoard(store, 'SessionStart', fast).then((x) => (woke = x));
    await sleep(150);
    expect(woke).toBeUndefined();
    store.mutate((s) => takeUnread(s)); // what the session-start hook does
    store.mutate((s) => applyAction(s, { type: 'ask', id: 'S1.2' }));
    await watching;
    expect(woke).toContain('msg ask S1.2');
    expect(woke).not.toContain('ok S1.1');
  });

  it('stops when the session that started it is gone', async () => {
    const { store } = board();
    // a parent that dies while the watcher runs
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
    const watching = watchBoard(store, 'Stop', { tick: 20, parent: child.pid });
    expect(await watching).toBeUndefined();
    expect(unread(store.read())).toEqual([]);
  });
});

describe('claudeStatus', () => {
  it('tells the board whether a click reaches Claude now', () => {
    const { store } = board();
    const dead = deadPid();
    expect(claudeStatus(store)).toBe('away');
    store.writeJson(store.p.live, { pid: process.pid });
    expect(claudeStatus(store)).toBe('idle'); // session open, nothing to wake it
    store.writeJson(store.p.listen, { pid: process.pid, mode: 'idle', at: '' });
    expect(claudeStatus(store)).toBe('ready');
    store.writeJson(store.p.listen, { pid: dead, mode: 'busy', at: '' });
    expect(claudeStatus(store)).toBe('working'); // the watcher left to wake Claude
    store.writeJson(store.p.live, { pid: dead });
    expect(claudeStatus(store)).toBe('away'); // ...and then the session closed
  });
});

describe('the watch hook process', () => {
  it('exits 2 with the directive on stderr, as asyncRewake expects', async () => {
    const { dir, store } = board();
    const proc = spawn(process.execPath, ['--import', TSX, CLI, 'hook', 'watch'], { cwd: dir });
    proc.stdin.end(JSON.stringify({ cwd: dir, hook_event_name: 'Stop', session_id: 's1' }));
    let err = '';
    let out = '';
    proc.stderr.on('data', (d) => (err += d));
    proc.stdout.on('data', (d) => (out += d));
    const exit = new Promise<number | null>((r) => proc.on('exit', r));
    for (let i = 0; i < 100 && store.readJson<any>(store.p.listen)?.mode !== 'idle'; i++) await sleep(100);
    store.mutate((s) => applyAction(s, { type: 'ask', id: 'S1.3' }));
    expect(await exit).toBe(2);
    expect(err).toContain('msg ask S1.3');
    expect(out).toBe('');
  }, 30_000);

  it('older boards get the new runtime files in their .gitignore', () => {
    const t = tempDir();
    cleanup = t.done;
    const store = new Store(t.dir);
    store.init();
    writeFileSync(join(store.p.dir, '.gitignore'), '.runtime.json\nmine.txt');
    store.init();
    const lines = readFileSync(join(store.p.dir, '.gitignore'), 'utf8').split('\n');
    expect(lines).toContain('mine.txt');
    expect(lines).toContain('.listen.json');
    expect(lines.filter((x) => x === '.runtime.json')).toHaveLength(1);
  });
});

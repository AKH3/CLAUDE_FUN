import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/core/store.js';
import { startBoard, type BoardServer } from '../src/server/http.js';
import { tempDir } from './helpers.js';

let boards: BoardServer[] = [];
let cleanup: (() => void) | undefined;
afterEach(async () => {
  for (const b of boards.reverse()) await b.close();
  boards = [];
  cleanup?.();
});

describe('startBoard', () => {
  it('finds the running board on its recorded port instead of starting another', async () => {
    const t = tempDir();
    cleanup = t.done;
    const a = await startBoard(t.dir, { port: 3914, usage: false });
    boards.push(a);
    expect(a.hosted).toBe(true);

    const b = await startBoard(t.dir, { usage: false });
    boards.push(b);
    expect(b.hosted).toBe(false);
    expect(b.port).toBe(a.port);
    expect(b.url).toBe(a.url);
    expect(new Store(t.dir).readRuntime()?.port).toBe(a.port);
  });

  it('ignores a stale runtime file and starts a board', async () => {
    const t = tempDir();
    cleanup = t.done;
    const store = new Store(t.dir);
    store.init();
    store.writeJson(store.p.runtime, { port: 3934, pid: 1, url: 'http://localhost:3934', root: t.dir });

    const b = await startBoard(t.dir, { port: 3924, usage: false });
    boards.push(b);
    expect(b.hosted).toBe(true);
    expect(b.port).not.toBe(3934);
    expect(store.readRuntime()?.port).toBe(b.port);
  });
});

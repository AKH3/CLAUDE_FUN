// File-backed state with a cross-process lock. The MCP server, the board server
// and the hooks can all run as separate processes, so every write goes through
// lock -> read -> mutate -> atomic replace.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { boardPaths, type BoardPaths } from '../paths.js';
import { emptyState } from './ops.js';
import { StateSchema, type State, type Usage } from './schema.js';

const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 8_000;

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
export const sleepSync = (ms: number) => Atomics.wait(sleepBuf, 0, 0, ms);

const BOARD_GITIGNORE = ['.runtime.json', '.session.json', 'usage.json', 'tmp-index', '.lock', '*.tmp', ''].join('\n');

export interface Runtime {
  port: number;
  pid: number;
  url: string;
  root: string;
}

export class Store {
  readonly p: BoardPaths;

  constructor(readonly root: string) {
    this.p = boardPaths(root);
  }

  exists() {
    return existsSync(this.p.state);
  }

  /** Creates .claude-board/ with an empty state if needed. Returns true when created. */
  init(name = basename(this.root), goal?: string): boolean {
    mkdirSync(this.p.dir, { recursive: true });
    const gi = `${this.p.dir}/.gitignore`;
    if (!existsSync(gi)) writeFileSync(gi, BOARD_GITIGNORE);
    if (this.exists()) return false;
    this.write(emptyState(name, goal));
    return true;
  }

  read(): State {
    if (!this.exists()) return emptyState(basename(this.root));
    const raw = readFileSync(this.p.state, 'utf8');
    return StateSchema.parse(JSON.parse(raw));
  }

  /** Cheap revision probe used by long-polling. */
  rev(): number {
    try {
      const m = /"rev"\s*:\s*(\d+)/.exec(readFileSync(this.p.state, 'utf8').slice(0, 200));
      return m ? Number(m[1]) : -1;
    } catch {
      return -1;
    }
  }

  mutate<T>(fn: (s: State) => T): { state: State; result: T } {
    mkdirSync(this.p.dir, { recursive: true });
    this.lock();
    try {
      const state = this.read();
      const result = fn(state);
      state.rev += 1;
      this.write(state);
      return { state, result };
    } finally {
      this.unlock();
    }
  }

  private write(state: State) {
    const tmp = `${this.p.state}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, this.p.state);
        return;
      } catch (e: any) {
        // Windows: a reader/watcher may briefly hold the target open.
        if (i < 40 && ['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) {
          sleepSync(15);
          continue;
        }
        writeFileSync(this.p.state, readFileSync(tmp));
        rmSync(tmp, { force: true });
        return;
      }
    }
  }

  private lock() {
    const start = Date.now();
    for (;;) {
      try {
        mkdirSync(this.p.lock);
        return;
      } catch (e: any) {
        if (e?.code !== 'EEXIST') throw e;
        try {
          if (Date.now() - statSync(this.p.lock).mtimeMs > LOCK_STALE_MS) {
            rmSync(this.p.lock, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error('board state is locked');
        sleepSync(5 + Math.random() * 15);
      }
    }
  }

  private unlock() {
    rmSync(this.p.lock, { recursive: true, force: true });
  }

  // ---- side files (not part of the shared state; single writer each) ----

  readJson<T>(file: string): T | undefined {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  writeJson(file: string, data: unknown) {
    mkdirSync(this.p.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    try {
      renameSync(tmp, file);
    } catch {
      writeFileSync(file, JSON.stringify(data));
      rmSync(tmp, { force: true });
    }
  }

  readUsage = () => this.readJson<Usage>(this.p.usage);
  readRuntime = () => this.readJson<Runtime>(this.p.runtime);
}

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const BOARD_DIR = '.claude-board';

export interface BoardPaths {
  root: string;
  dir: string;
  state: string;
  usage: string;
  runtime: string;
  session: string;
  lock: string;
  tmpIndex: string;
}

export function boardPaths(root: string): BoardPaths {
  const dir = join(root, BOARD_DIR);
  return {
    root,
    dir,
    state: join(dir, 'state.json'),
    usage: join(dir, 'usage.json'),
    runtime: join(dir, '.runtime.json'),
    session: join(dir, '.session.json'),
    lock: join(dir, '.lock'),
    tmpIndex: join(dir, 'tmp-index'),
  };
}

/** Project root: nearest ancestor with .claude-board, else nearest with .git, else the start dir. */
export function findRoot(start?: string): string {
  const from = resolve(start ?? process.env.CLAUDE_BOARD_ROOT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  let gitRoot: string | undefined;
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, BOARD_DIR, 'state.json'))) return dir;
    if (!gitRoot && existsSync(join(dir, '.git'))) gitRoot = dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return gitRoot ?? from;
}

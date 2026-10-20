import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';

export const BOARD_DIR = '.claude-board';

export interface BoardPaths {
  root: string;
  dir: string;
  state: string;
  usage: string;
  runtime: string;
  session: string;
  /** Written by the hooks: is Claude in a turn, and which watcher can wake it. */
  listen: string;
  /** Written by the MCP server: pid of the Claude Code session's server. */
  live: string;
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
    listen: join(dir, '.listen.json'),
    live: join(dir, '.live.json'),
    lock: join(dir, '.lock'),
    tmpIndex: join(dir, 'tmp-index'),
  };
}

// Real, case-folded path: on Windows this also expands 8.3 short names (C:\Users\ABDULK~1).
function canonical(p: string): string {
  let out = resolve(p);
  try {
    out = realpathSync.native(out);
  } catch {}
  return out.toLowerCase();
}

/**
 * The home folder and drive roots are never projects: in the home folder,
 * .claude/settings.json is the user's global Claude Code config, and a
 * CLAUDE.md there is read by every project below it.
 */
export function isUnsafeRoot(dir: string): boolean {
  const c = canonical(dir);
  return c === canonical(homedir()) || c === parse(resolve(dir)).root.toLowerCase() || c === parse(c).root;
}

/**
 * Project root: nearest ancestor with .claude-board, else nearest with .git,
 * else the start dir. The search stops at the home folder or a drive root, so
 * a stray board there can never capture the projects below it.
 */
export function findRoot(start?: string): string {
  if (!start && process.env.CLAUDE_BOARD_ROOT) return resolve(process.env.CLAUDE_BOARD_ROOT);
  const from = resolve(start ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  let gitRoot: string | undefined;
  for (let dir = from; !isUnsafeRoot(dir); ) {
    if (existsSync(join(dir, BOARD_DIR, 'state.json'))) return dir;
    if (!gitRoot && existsSync(join(dir, '.git'))) gitRoot = dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return gitRoot ?? from;
}

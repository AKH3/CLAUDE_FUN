// Zero-token result capsules: snapshot the working tree into a throwaway index,
// so per-step diffs work without commits and without touching the user's index.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { BOARD_DIR, boardPaths } from '../paths.js';
import type { GitCtx } from './ops.js';

const MAX_DIFF = 400_000;

function git(root: string, args: string[], env?: Record<string, string>): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch {
    return undefined;
  }
}

export function isRepo(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

/** Tree sha of the current working tree (tracked + untracked, honoring .gitignore). */
export function snapshot(root: string): string | undefined {
  if (!isRepo(root)) return undefined;
  const p = boardPaths(root);
  mkdirSync(p.dir, { recursive: true });
  const env = { GIT_INDEX_FILE: p.tmpIndex };
  const added = git(root, ['add', '-A', '--', '.', `:(exclude)${BOARD_DIR}`], env);
  if (added === undefined) return undefined;
  return git(root, ['write-tree'], env)?.trim() || undefined;
}

export function numstat(root: string, base: string, head: string) {
  const out = git(root, ['diff', '--numstat', '--no-renames', base, head]);
  if (out === undefined) return undefined;
  const files: string[] = [];
  let ins = 0;
  let del = 0;
  for (const line of out.split('\n')) {
    const [a, d, file] = line.split('\t');
    if (!file) continue;
    files.push(file);
    ins += Number(a) || 0;
    del += Number(d) || 0;
  }
  return { files, ins, del };
}

export function diff(root: string, base: string, head: string, file?: string): string {
  const args = ['diff', '--no-color', '--no-renames', base, head];
  if (file) args.push('--', file);
  const out = git(root, args) ?? '';
  return out.length > MAX_DIFF ? out.slice(0, MAX_DIFF) + '\n… (diff truncated)\n' : out;
}

export function gitCtx(root: string, needTree: boolean): GitCtx {
  return {
    tree: needTree ? snapshot(root) : undefined,
    stat: (base, head) => numstat(root, base, head),
  };
}

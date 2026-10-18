import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(prefix = 'cfun-'): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

export function gitInit(dir: string) {
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'test');
  run('config', 'core.autocrlf', 'false');
}

/** Absolute tsx loader URL, so child processes can run .ts from any cwd. */
export const TSX = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href;

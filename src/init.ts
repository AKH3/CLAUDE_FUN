// Zero-config drop-in: wires an existing repo to the board without touching
// its code. Every file is merged, never overwritten, and re-running is safe.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuardMode } from './core/schema.js';
import { Store } from './core/store.js';
import { BOARD_DIR, isUnsafeRoot } from './paths.js';

const SNIPPET_START = '<!-- claude-board:start -->';
const SNIPPET_END = '<!-- claude-board:end -->';
const SNIPPET = `${SNIPPET_START}
## Claude Board
This repo is driven from a live visual board (MCP server \`board\`, state in \`.claude-board/\`).
- Start with \`resume\`. Plan with \`plan\`, report with \`update\` deltas. Don't narrate progress in chat.
- Only approved steps can run. With nothing approved, end your turn: the board wakes you when the user clicks.
- Keep chat replies to 1-2 lines, because the board shows the details.
- If the user asks to open the board, run \`claude-fun\` here (\`claude-fun.cmd\` on Windows): it opens the running board in their browser.
${SNIPPET_END}
`;

const HOOK_MARK = /claude-fun|claude-board|cli\.(m?js|ts)/;
const BOARD_TOOLS = 'mcp__board';
const GUARD_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash';
// not "compact": that one fires mid-turn, while Claude is already working
const WATCH_START_MATCHER = 'startup|resume|clear';
// Runs in the background; exit code 2 wakes Claude (see watchBoard).
const WATCH_HOOK = {
  asyncRewake: true,
  rewakeMessage: 'Claude Board:',
  rewakeSummary: 'Claude Board: a click on the board',
};
const OUR_HOOKS = /( hook (session-start|prompt|guard|watch))$/;
const MCP_TIMEOUT_MS = '600000';

export interface InitOptions {
  name?: string;
  goal?: string;
  guard?: GuardMode;
  hooks?: boolean;
  claudeMd?: boolean;
}

/** How Claude Code should launch us: node + absolute path of this very CLI. */
export function launcher(): { command: string; args: string[]; shell: string } {
  const self = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  const cli = self.endsWith('.ts') ? self.replace(/src\/init\.ts$/, 'dist/cli.js') : join(dirname(self), 'cli.js').replace(/\\/g, '/');
  return { command: 'node', args: [cli], shell: `node "${cli}"` };
}

function readJson(file: string): any {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON; fix it and re-run init`);
  }
}

function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const UNSAFE_ROOT_MSG = (root: string) =>
  `${root} is your home folder (or a drive root), not a project: .claude/settings.json there is your global Claude Code config and CLAUDE.md there is read by every project. cd into a project folder and run init again.`;

export function init(root: string, opts: InitOptions = {}): string[] {
  if (isUnsafeRoot(root)) throw new Error(UNSAFE_ROOT_MSG(root));
  const report: string[] = [];
  const store = new Store(root);
  const created = store.init(opts.name ?? basename(root), opts.goal);
  report.push(created ? '+ .claude-board/state.json' : '= .claude-board/state.json (kept)');
  if (opts.guard) {
    store.mutate((s) => {
      s.cfg.guard = opts.guard!;
    });
    report.push(`  guard: ${opts.guard}`);
  }

  const run = launcher();
  if (run.args[0].includes('/_npx/')) {
    report.push('! running from a temporary npx cache; install globally (npm i -g https://github.com/AKH3/CLAUDE_FUN/archive/refs/heads/main.tar.gz) so the paths below stay valid');
  }

  // .mcp.json
  const mcpFile = join(root, '.mcp.json');
  const mcp = readJson(mcpFile);
  mcp.mcpServers ??= {};
  mcp.mcpServers.board = { command: run.command, args: [...run.args, 'mcp'] };
  writeJson(mcpFile, mcp);
  report.push('+ .mcp.json → server "board"');

  // .claude/settings.json: approve our own server/tools + hooks
  const settingsFile = join(root, '.claude', 'settings.json');
  const settings = readJson(settingsFile);
  settings.enabledMcpjsonServers = [...new Set([...(settings.enabledMcpjsonServers ?? []), 'board'])];
  settings.permissions ??= {};
  settings.permissions.allow = [...new Set([...(settings.permissions.allow ?? []), BOARD_TOOLS])];
  // `await` long-polls while you review on the board; give MCP calls 10 minutes unless already set
  settings.env ??= {};
  if (!settings.env.MCP_TOOL_TIMEOUT) {
    settings.env.MCP_TOOL_TIMEOUT = MCP_TIMEOUT_MS;
    report.push(`+ .claude/settings.json → env MCP_TOOL_TIMEOUT=${MCP_TIMEOUT_MS}`);
  }

  if (opts.hooks !== false) {
    settings.hooks ??= {};
    const put = (event: string, hook: string, matcher?: string, extra: Record<string, unknown> = { timeout: 10 }) => {
      const list: any[] = (settings.hooks[event] ?? []).filter(
        (g: any) => !(g.hooks ?? []).some((h: any) => HOOK_MARK.test(h.command ?? '') && (h.command ?? '').endsWith(` hook ${hook}`)),
      );
      list.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `${run.shell} hook ${hook}`, ...extra }] });
      settings.hooks[event] = list;
    };
    put('SessionStart', 'session-start');
    put('UserPromptSubmit', 'prompt');
    put('PreToolUse', 'guard', GUARD_MATCHER);
    // the watcher restarts at each of these, so one is always waiting for a click
    put('SessionStart', 'watch', WATCH_START_MATCHER, WATCH_HOOK);
    put('UserPromptSubmit', 'watch', undefined, WATCH_HOOK);
    put('Stop', 'watch', undefined, WATCH_HOOK);
    report.push('+ .claude/settings.json → hooks (session-start, prompt, guard, watch) + allow mcp__board');
  } else {
    report.push('+ .claude/settings.json → allow mcp__board');
  }
  writeJson(settingsFile, settings);

  // CLAUDE.md pointer
  if (opts.claudeMd !== false) {
    const md = join(root, 'CLAUDE.md');
    const cur = existsSync(md) ? readFileSync(md, 'utf8') : '';
    if (cur.includes(SNIPPET_START)) {
      const next = cur.replace(new RegExp(`${SNIPPET_START}[\\s\\S]*?${SNIPPET_END}\\n?`), SNIPPET);
      if (next !== cur) writeFileSync(md, next);
      report.push('= CLAUDE.md (snippet refreshed)');
    } else {
      writeFileSync(md, cur + (cur && !cur.endsWith('\n\n') ? (cur.endsWith('\n') ? '\n' : '\n\n') : '') + SNIPPET);
      report.push('+ CLAUDE.md snippet');
    }
  }
  return report;
}

const isEmpty = (o: unknown) => !!o && typeof o === 'object' && Object.keys(o as object).length === 0;

/**
 * Undoes init: drops only what init added (board server, our hooks, our allow
 * rule, our default timeout, the CLAUDE.md snippet). Every touched file is
 * copied to a backup folder first. The board state is kept unless `purge`.
 */
export function remove(root: string, opts: { purge?: boolean; backupDir?: string } = {}): { report: string[]; backup: string } {
  const report: string[] = [];
  if (opts.backupDir) mkdirSync(opts.backupDir, { recursive: true });
  const backup = mkdtempSync(join(opts.backupDir ?? tmpdir(), 'claude-board-backup-'));
  const save = (file: string, name: string) => existsSync(file) && copyFileSync(file, join(backup, name));

  const mcpFile = join(root, '.mcp.json');
  if (existsSync(mcpFile)) {
    const mcp = readJson(mcpFile);
    if (mcp.mcpServers?.board) {
      save(mcpFile, 'mcp.json');
      delete mcp.mcpServers.board;
      if (isEmpty(mcp.mcpServers)) delete mcp.mcpServers;
      if (isEmpty(mcp)) rmSync(mcpFile);
      else writeJson(mcpFile, mcp);
      report.push('- .mcp.json: server "board"');
    }
  }

  const settingsFile = join(root, '.claude', 'settings.json');
  if (existsSync(settingsFile)) {
    save(settingsFile, 'settings.json');
    const s = readJson(settingsFile);
    let touched = false;
    for (const [event, groups] of Object.entries<any[]>(s.hooks ?? {})) {
      const kept = groups.filter((g) => !(g.hooks ?? []).some((h: any) => HOOK_MARK.test(h.command ?? '') && OUR_HOOKS.test(h.command ?? '')));
      if (kept.length !== groups.length) touched = true;
      if (kept.length) s.hooks[event] = kept;
      else delete s.hooks[event];
    }
    if (isEmpty(s.hooks)) delete s.hooks;
    const drop = (list: unknown, value: string) => (Array.isArray(list) ? list.filter((x) => x !== value) : list);
    if (s.enabledMcpjsonServers?.includes('board')) {
      s.enabledMcpjsonServers = drop(s.enabledMcpjsonServers, 'board');
      if (!s.enabledMcpjsonServers.length) delete s.enabledMcpjsonServers;
      touched = true;
    }
    if (s.permissions?.allow?.includes(BOARD_TOOLS)) {
      s.permissions.allow = drop(s.permissions.allow, BOARD_TOOLS);
      if (!s.permissions.allow.length) delete s.permissions.allow;
      if (isEmpty(s.permissions)) delete s.permissions;
      touched = true;
    }
    if (s.env?.MCP_TOOL_TIMEOUT === MCP_TIMEOUT_MS) {
      delete s.env.MCP_TOOL_TIMEOUT;
      if (isEmpty(s.env)) delete s.env;
      touched = true;
    }
    if (touched) {
      if (isEmpty(s)) rmSync(settingsFile);
      else writeJson(settingsFile, s);
      report.push('- .claude/settings.json: board hooks, allow rule, default timeout');
    }
  }

  const md = join(root, 'CLAUDE.md');
  if (existsSync(md)) {
    const cur = readFileSync(md, 'utf8');
    if (cur.includes(SNIPPET_START)) {
      save(md, 'CLAUDE.md');
      const next = cur.replace(new RegExp(`\\n*${SNIPPET_START}[\\s\\S]*?${SNIPPET_END}\\n?`), '\n').replace(/^\n+/, '');
      if (next.trim()) writeFileSync(md, next.replace(/\n*$/, '\n'));
      else rmSync(md);
      report.push('- CLAUDE.md: board snippet');
    }
  }

  const boardDir = join(root, BOARD_DIR);
  if (opts.purge && existsSync(boardDir)) {
    rmSync(boardDir, { recursive: true, force: true });
    report.push(`- ${BOARD_DIR}/ (purged)`);
  } else if (existsSync(boardDir)) {
    report.push(`= ${BOARD_DIR}/ kept (use --purge to delete the board too)`);
  }
  return { report, backup };
}

// Zero-config drop-in: wires an existing repo to the board without touching
// its code. Every file is merged, never overwritten, and re-running is safe.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuardMode } from './core/schema.js';
import { Store } from './core/store.js';

const SNIPPET_START = '<!-- claude-board:start -->';
const SNIPPET_END = '<!-- claude-board:end -->';
const SNIPPET = `${SNIPPET_START}
## Claude Board
This repo is driven from a live visual board (MCP server \`board\`, state in \`.claude-board/\`).
- Start with \`resume\`. Plan with \`plan\`, report with \`update\` deltas, and wait with \`await\`. Don't narrate progress in chat.
- Only approved steps can run. Keep chat replies to 1-2 lines, because the board shows the details.
${SNIPPET_END}
`;

const HOOK_MARK = /claude-fun|claude-board|cli\.(m?js|ts)/;
const BOARD_TOOLS = 'mcp__board';
const GUARD_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash';
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

export function init(root: string, opts: InitOptions = {}): string[] {
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
    report.push('! running from a temporary npx cache; install globally (npm i -g github:AKH3/CLAUDE_FUN) so the paths below stay valid');
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
    const put = (event: string, hook: string, matcher?: string) => {
      const list: any[] = (settings.hooks[event] ?? []).filter(
        (g: any) => !(g.hooks ?? []).some((h: any) => HOOK_MARK.test(h.command ?? '') && (h.command ?? '').includes(` hook ${hook}`)),
      );
      list.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `${run.shell} hook ${hook}`, timeout: 10 }] });
      settings.hooks[event] = list;
    };
    put('SessionStart', 'session-start');
    put('UserPromptSubmit', 'prompt');
    put('PreToolUse', 'guard', GUARD_MATCHER);
    report.push('+ .claude/settings.json → hooks (session-start, prompt, guard) + allow mcp__board');
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

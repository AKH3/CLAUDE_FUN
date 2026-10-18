// Claude Code hooks. They run as short-lived processes on every event, so this
// module only touches the core (no server, no MCP SDK).
import { isAbsolute, relative, resolve } from 'node:path';
import { fmtDirectives, leaves, takeUnread, unread } from '../core/ops.js';
import type { State } from '../core/schema.js';
import { Store } from '../core/store.js';
import { summary } from '../core/summary.js';
import { BOARD_DIR, findRoot, isUnsafeRoot } from '../paths.js';

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string; path?: string; command?: string };
}

async function readStdin(): Promise<HookInput> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const emit = (event: string, extra: Record<string, unknown>) =>
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...extra } }) + '\n');

function rememberSession(store: Store, input: HookInput) {
  if (!input.transcript_path) return;
  const prev = store.readJson<{ transcript?: string }>(store.p.session);
  if (prev?.transcript === input.transcript_path) return;
  store.writeJson(store.p.session, { session: input.session_id, transcript: input.transcript_path });
}

/** Minimal glob: ** spans dirs, * stays within a segment, ? one char. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

// Shell commands that change files. A heuristic, not a sandbox: it catches the
// usual ways (redirects, sed -i, rm/mv/cp, git that rewrites the tree, package
// installs, PowerShell file cmdlets) so Claude can't sidestep Edit/Write.
const SHELL_WRITES: RegExp[] = [
  /(^|[^0-9&<>=-])>>?\s*(?!&|\/dev\/null\b|nul\b|\$null\b)[^\s|&;]/i,
  /\btee\b/,
  /\b(sed|perl)\b[^|;&]*\s-i/,
  /(^|[\s;&|(])(rm|rmdir|mv|cp|touch|mkdir|truncate|dd|ln|chmod|chown|unlink|install)\s/,
  /\bgit\s+(apply|checkout|switch|restore|reset|clean|commit|merge|rebase|stash|mv|rm|am|cherry-pick|revert|pull)\b/,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|rm|uninstall|update|up|ci|link)\b/,
  /\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content)\b/i,
  /(^|[\s;&|(])(del|erase|copy|move|ren|rename|md)\s/i,
];

export const shellWrites = (cmd: string) => SHELL_WRITES.some((re) => re.test(cmd));

function toRel(root: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  return relative(root, abs).replace(/\\/g, '/');
}

// relative() returns an absolute path when the file is on another drive
const outside = (rel: string) => rel === '..' || rel.startsWith('../') || isAbsolute(rel) || /^[a-z]:/i.test(rel);
const inBoard = (rel: string) => rel === BOARD_DIR || rel.startsWith(`${BOARD_DIR}/`);

const DENY_TAIL = 'Get a step approved on the board, then update {id,s:"run"} first.';

export function guardDecision(state: State, root: string, input: Pick<HookInput, 'tool_name' | 'tool_input'>): string | undefined {
  const mode = state.cfg.guard;
  if (mode === 'off' || !state.phases.length) return undefined; // no plan yet: nothing to gate
  if (leaves(state).some((x) => x.s === 'run')) return undefined;
  const protectedPath = (rel: string) => state.cfg.protect.some((g) => globToRegExp(g).test(rel));

  if (input.tool_name === 'Bash') {
    const cmd = input.tool_input?.command ?? '';
    if (!cmd || !shellWrites(cmd)) return undefined;
    if (mode === 'sensitive') {
      const tokens = cmd.split(/[\s;&|<>()]+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter(Boolean);
      const hit = tokens.map((t) => toRel(root, t)).find((rel) => !outside(rel) && !inBoard(rel) && protectedPath(rel));
      return hit ? `Claude Board: this command touches protected ${hit}. ${DENY_TAIL}` : undefined;
    }
    return `Claude Board: no step is running and this command changes files. ${DENY_TAIL}`;
  }

  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? input.tool_input?.path;
  if (!file) return undefined;
  const rel = toRel(root, file);
  if (inBoard(rel) || outside(rel)) return undefined; // board files, or outside the project
  if (mode === 'sensitive' && !protectedPath(rel)) return undefined;
  const why = mode === 'sensitive' ? `${rel} is protected` : 'no step is running';
  return `Claude Board: ${why}. ${DENY_TAIL}`;
}

export async function runHook(name: string) {
  const input = await readStdin();
  const root = findRoot(input.cwd || undefined);
  if (isUnsafeRoot(root)) return; // never act on a board in the home folder or a drive root
  const store = new Store(root);
  if (!store.exists()) return;

  switch (name) {
    case 'session-start': {
      rememberSession(store, input);
      const pending = unread(store.read()).length > 0;
      const { state, result: msgs } = pending ? store.mutate((s) => takeUnread(s)) : { state: store.read(), result: [] };
      emit('SessionStart', {
        additionalContext: `Claude Board (mcp "board") is active.\n${summary(state, { usage: store.readUsage(), msgs, url: store.readRuntime()?.url })}`,
      });
      return;
    }
    case 'prompt': {
      rememberSession(store, input);
      if (!unread(store.read()).length) return;
      const { result: msgs } = store.mutate((s) => takeUnread(s));
      if (msgs.length) emit('UserPromptSubmit', { additionalContext: `board msg: ${fmtDirectives(msgs)}` });
      return;
    }
    case 'guard': {
      const reason = guardDecision(store.read(), root, input);
      if (reason) emit('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: reason });
      return;
    }
    default:
      throw new Error(`unknown hook ${name}`);
  }
}

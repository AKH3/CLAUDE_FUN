// Claude Code hooks. They run as short-lived processes on every event, so this
// module only touches the core (no server, no MCP SDK).
import { isAbsolute, relative, resolve } from 'node:path';
import { fmtDirectives, leaves, takeUnread, unread } from '../core/ops.js';
import type { State } from '../core/schema.js';
import { Store } from '../core/store.js';
import { summary } from '../core/summary.js';
import { BOARD_DIR, findRoot } from '../paths.js';

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string; path?: string };
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

export function guardDecision(state: State, root: string, file: string | undefined): string | undefined {
  const mode = state.cfg.guard;
  if (mode === 'off' || !file) return undefined;
  const abs = isAbsolute(file) ? file : resolve(root, file);
  const rel = relative(root, abs).replace(/\\/g, '/');
  if (rel === BOARD_DIR || rel.startsWith(`${BOARD_DIR}/`)) return undefined;
  if (rel.startsWith('../')) return undefined; // outside the project: not ours to police
  if (!state.phases.length) return undefined; // no plan yet: nothing to gate
  const running = leaves(state).filter((x) => x.s === 'run');
  if (running.length) return undefined;
  if (mode === 'sensitive' && !state.cfg.protect.some((g) => globToRegExp(g).test(rel))) return undefined;
  const why = mode === 'sensitive' ? `${rel} is protected` : 'no step is running';
  return `Claude Board: ${why}. Get a step approved on the board, then update {id,s:"run"} before editing.`;
}

export async function runHook(name: string) {
  const input = await readStdin();
  const root = findRoot(input.cwd || undefined);
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
      const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? input.tool_input?.path;
      const reason = guardDecision(store.read(), root, file);
      if (reason) emit('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: reason });
      return;
    }
    default:
      throw new Error(`unknown hook ${name}`);
  }
}

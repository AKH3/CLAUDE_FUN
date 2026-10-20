// Can a board click reach Claude right now? Claude Code is turn based, so the
// board can't talk to it directly. Two side files answer the question:
// - .listen.json, written by the hooks: "busy" while a turn runs, "idle" once it
//   ends, plus the pid of the background watcher that wakes Claude on a click.
// - .live.json, written by the MCP server: its pid, alive while the session is open.
import type { ClaudeStatus } from './schema.js';
import type { Store } from './store.js';

export interface Listen {
  pid: number;
  /** Which watcher wrote it; a newer one replaces it and the older one leaves. */
  id?: string;
  mode: 'busy' | 'idle';
  at: string;
}

export type { ClaudeStatus };

export function alive(pid: number | undefined): boolean {
  if (!pid || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM'; // exists, owned by someone else
  }
}

export function claudeStatus(store: Store): ClaudeStatus {
  const listen = store.readJson<Listen>(store.p.listen);
  const live = store.readJson<{ pid: number }>(store.p.live);
  const open = alive(live?.pid);
  if (listen?.mode === 'idle' && alive(listen.pid)) return 'ready';
  if (listen?.mode === 'busy' && (alive(listen.pid) || open)) return 'working';
  return open ? 'idle' : 'away';
}

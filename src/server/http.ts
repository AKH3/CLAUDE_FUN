// Local engine: serves the built board UI, pushes live state over SSE,
// and turns board clicks into state changes + silent directives for Claude.
import { serve, type ServerType } from '@hono/node-server';
import { watch } from 'chokidar';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diff, isRepo, snapshot } from '../core/git.js';
import { claudeStatus, type ClaudeStatus } from '../core/listen.js';
import { applyAction, findStep } from '../core/ops.js';
import { ActionSchema, type State, type Usage } from '../core/schema.js';
import { Store } from '../core/store.js';
import { UsageTracker } from '../core/usage.js';

export interface BoardServer {
  url: string;
  port: number;
  hosted: boolean;
  /** Re-reads state.json and pushes it to open boards (hosted boards only). */
  refresh?: () => void;
  close(): Promise<void>;
}

export interface BoardOptions {
  port?: number;
  log?: (m: string) => void;
  usage?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function findUiDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, 'ui'), join(here, '..', 'dist', 'ui'), join(here, '..', '..', 'dist', 'ui')].find((d) =>
    existsSync(join(d, 'index.html')),
  );
}

type Client = (event: string, data: string) => void;

export function createApp(root: string, opts: BoardOptions = {}) {
  const store = new Store(root);
  store.init();
  const uiDir = findUiDir();
  const clients = new Set<Client>();
  const tracker = new UsageTracker(store);
  const repo = isRepo(root);
  let usage: Usage | undefined = store.readUsage();
  let state: State = store.read();
  let claude: ClaudeStatus = claudeStatus(store);

  const broadcast = (event: string, data: unknown) => {
    const payload = JSON.stringify(data);
    for (const c of clients) c(event, payload);
  };

  const refreshState = () => {
    try {
      const next = store.read();
      if (next.rev === state.rev) return;
      state = next;
      broadcast('state', state);
      refreshUsage(true);
    } catch (e: any) {
      broadcast('problem', { message: `state.json: ${e?.message ?? e}` });
    }
  };

  const refreshUsage = (force = false) => {
    if (opts.usage === false) return;
    try {
      const u = tracker.tick(state, force);
      if (!u) return;
      usage = u;
      store.writeJson(store.p.usage, u);
      broadcast('usage', u);
    } catch {}
  };

  // whether a click can reach Claude right now (see core/listen.ts)
  const refreshClaude = () => {
    const next = claudeStatus(store);
    if (next === claude) return;
    claude = next;
    broadcast('claude', { status: claude });
  };

  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(store.p.dir, { ignoreInitial: true, depth: 0 });
  watcher.on('all', (_ev, file) => {
    if (file.endsWith('.listen.json') || file.endsWith('.live.json')) return refreshClaude();
    if (opts.usage === false && file.endsWith('usage.json')) {
      // usage written by someone else (demo / external tool): just relay it
      const u = store.readUsage();
      if (u) broadcast('usage', (usage = u));
      return;
    }
    if (!file.endsWith('state.json')) return;
    clearTimeout(timer);
    timer = setTimeout(refreshState, 30);
  });
  const usageTimer = setInterval(() => refreshUsage(), 3000);
  // safety net in case a file event is missed (network drives, editors that rewrite oddly);
  // also notices a session that closed, which writes no file
  const pollTimer = setInterval(() => {
    if (store.rev() !== state.rev) refreshState();
    refreshClaude();
  }, 1000);

  const app = new Hono();

  // Only local pages may talk to the engine (blocks DNS rebinding and cross-site POSTs).
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').split(':')[0];
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return c.text('forbidden host', 403);
    if (c.req.method !== 'GET') {
      const origin = c.req.header('origin');
      if (c.req.header('x-board') !== '1') return c.text('missing x-board header', 403);
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return c.text('forbidden origin', 403);
    }
    await next();
  });

  app.get('/api/ping', (c) => c.json({ app: 'claude-board', root, pid: process.pid }));

  app.get('/api/state', (c) => c.json({ state, usage, git: repo, root, claude }));

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const client: Client = (event, data) => void stream.writeSSE({ event, data }).catch(() => {});
      clients.add(client);
      await stream.writeSSE({ event: 'state', data: JSON.stringify(state) });
      await stream.writeSSE({ event: 'claude', data: JSON.stringify({ status: claude }) });
      if (usage) await stream.writeSSE({ event: 'usage', data: JSON.stringify(usage) });
      const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}), 20_000);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(ping);
      clients.delete(client);
    }),
  );

  app.post('/api/action', async (c) => {
    const parsed = ActionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'bad action' }, 400);
    try {
      const { state: next, result } = store.mutate((s) => applyAction(s, parsed.data));
      state = next;
      broadcast('state', state);
      return c.json({ ok: true, msg: result, rev: next.rev });
    } catch (e: any) {
      return c.json({ ok: false, error: e?.message ?? String(e) }, 400);
    }
  });

  app.get('/api/diff/:id', (c) => {
    const st = findStep(state, c.req.param('id'));
    if (!st?.base) return c.text('', 404);
    const head = st.head ?? (st.s === 'run' ? snapshot(root) : undefined);
    if (!head) return c.text('', 404);
    return c.text(diff(root, st.base, head, c.req.query('file') || undefined));
  });

  app.get('*', (c) => {
    if (!uiDir) return c.html('<h1>Claude Board</h1><p>UI not built. Run <code>npm run build</code>.</p>');
    const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^([/\\])+/, '');
    let file = join(uiDir, rel);
    if (!file.startsWith(uiDir + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(uiDir, 'index.html');
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    return c.body(readFileSync(file), 200, { 'content-type': type, 'cache-control': cache });
  });

  const close = async () => {
    clearInterval(usageTimer);
    clearInterval(pollTimer);
    clearTimeout(timer);
    await watcher.close();
  };

  return { app, store, close, refresh: refreshState };
}

function listen(fetch: Hono['fetch'], port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port, hostname: '127.0.0.1' }, () => resolve(server));
    server.once('error', reject);
  });
}

async function pingRoot(port: number): Promise<string | undefined> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(800) });
    const j = (await r.json()) as { app?: string; root?: string };
    return j.app === 'claude-board' ? j.root : undefined;
  } catch {
    return undefined;
  }
}

const sameRoot = (a: string, b: string) => normalize(a).toLowerCase() === normalize(b).toLowerCase();

/** Is this project's board answering on that port? */
export async function boardUp(root: string, port: number): Promise<boolean> {
  const other = await pingRoot(port);
  return !!other && sameRoot(other, root);
}

const existing = (port: number): BoardServer => ({ url: `http://localhost:${port}`, port, hosted: false, close: async () => {} });

/** Starts (or finds an existing) board server for this project. */
export async function startBoard(root: string, opts: BoardOptions = {}): Promise<BoardServer> {
  // The live board may sit on any port (e.g. `mcp --port 3014`), so try the one
  // it recorded first. Only a ping proves it: a hard kill leaves a stale file.
  const live = new Store(root).readRuntime()?.port;
  if (live && (await boardUp(root, live))) return existing(live);

  const first = opts.port ?? 3000;
  const { app, store, close, refresh } = createApp(root, opts);
  for (let port = first; port < first + 25; port++) {
    try {
      const server = await listen(app.fetch, port);
      const url = `http://localhost:${port}`;
      store.writeJson(store.p.runtime, { port, pid: process.pid, url, root });
      opts.log?.(`board ${url}`);
      return {
        url,
        port,
        hosted: true,
        refresh,
        close: async () => {
          await close();
          await new Promise<void>((r) => server.close(() => r()));
          if (store.readRuntime()?.pid === process.pid) rmSync(store.p.runtime, { force: true });
        },
      };
    } catch (e: any) {
      if (e?.code !== 'EADDRINUSE') throw e;
      if (await boardUp(root, port)) {
        await close();
        return existing(port);
      }
    }
  }
  await close();
  throw new Error(`no free port in ${first}-${first + 24}`);
}

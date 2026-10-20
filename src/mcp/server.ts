// The Claude-facing side: four terse tools. Every description and schema byte
// here is paid for in context, so they stay short on purpose.
import { rmSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { gitCtx } from '../core/git.js';
import { applyDeltas, applyPlan, findStep, fmtDirectives, takeUnread, unread } from '../core/ops.js';
import { AwaitInput, PlanInput, UpdateInput, type State } from '../core/schema.js';
import { Store } from '../core/store.js';
import { afterUpdate, nextStep, summary } from '../core/summary.js';
import { boardUp, startBoard, type BoardServer } from '../server/http.js';
import { VERSION } from '../version.js';

export const INSTRUCTIONS = `Claude Board: the user follows progress on a live visual board, so keep chat to 1-2 lines and put status in deltas.
1. Call resume first.
2. New work: plan phases/steps as {t,e,a}: t=short title; e=effort 1 small|2 medium|3 large; a=what it does + why it helps, <=20 words in the user's language (shown when they click "?"). Then end your turn: the board wakes you when the user approves.
3. Before a step: update {id,s:"run"}. After it: {id,s:"done"|"fail",n:"<=8 words",t:"pass"|"fail"|"none"}.
4. Only approved steps can run, one at a time, in the user's order ("next", then "then"); the engine refuses others. If you can't do the next one, update it {s:"block",n:"why"}. When none is left, end your turn.
5. "msg" lines are the user's clicks on the board: ok=approved ("ok A,B in order"=run them back to back), note=follow it (no step id = the user writing to you), prio=reorder, split=call plan with parent, ask=answer with update {id,a:"<=25 words: what the step does + expected benefit, in the user's language"} then carry on.`;

const TAKEOVER_MS = 5000;

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMcp(root: string, opts: { ui?: boolean; port?: number } = {}) {
  const store = new Store(root);
  store.init();
  const log = (m: string) => process.stderr.write(`[claude-board] ${m}\n`);
  // tells the board a Claude Code session is open on this project
  store.writeJson(store.p.live, { pid: process.pid, at: new Date().toISOString() });

  let board: BoardServer | undefined;
  const host = async () => {
    try {
      // same port as before when we can, so an open board tab reconnects by itself
      board = await startBoard(root, { port: board?.port ?? opts.port, log });
    } catch (e: any) {
      log(`board not started: ${e?.message ?? e}`);
    }
  };
  let takeover: NodeJS.Timeout | undefined;
  if (opts.ui !== false) {
    await host();
    // The board may be hosted by another session's server. When that session
    // closes, its board goes with it, so this one steps in.
    let checking = false;
    takeover = setInterval(async () => {
      if (checking || board?.hosted) return;
      checking = true;
      if (!board || !(await boardUp(root, board.port))) await host();
      checking = false;
    }, TAKEOVER_MS);
    takeover.unref();
  }
  const boardUrl = () => board?.url ?? store.readRuntime()?.url;
  // show Claude's own changes at once instead of waiting for the file watcher
  const mutate = <T>(fn: (s: State) => T) => {
    const out = store.mutate(fn);
    board?.refresh?.();
    return out;
  };

  const server = new McpServer({ name: 'claude-board', version: VERSION }, { instructions: INSTRUCTIONS });
  // Claude Code starts one server per session, so the first resume opens a session:
  // any step still "run" then was left by an earlier one.
  let firstResume = true;

  server.registerTool(
    'resume',
    { description: 'Board status + pending user directives. Call first.', inputSchema: {} },
    async () => {
      const pending = unread(store.read()).length > 0;
      const { state, result: msgs } = pending
        ? mutate((s) => takeUnread(s))
        : { state: store.read(), result: [] };
      const stale = firstResume;
      firstResume = false;
      return text(summary(state, { usage: store.readUsage(), msgs, url: boardUrl(), stale }));
    },
  );

  server.registerTool(
    'plan',
    {
      description: 'Add phases/steps, or substeps via parent (split). New steps await user approval.',
      inputSchema: PlanInput,
    },
    async (args) => {
      try {
        const { state, result } = mutate((s) => applyPlan(s, args));
        return text(`${result} r${state.rev}`);
      } catch (e: any) {
        return text(e?.message ?? String(e), true);
      }
    },
  );

  server.registerTool(
    'update',
    { description: 'Status deltas: s:run before work, done/fail after. n<=8 words.', inputSchema: UpdateInput },
    async ({ ops }) => {
      const needTree = ops.some((o) => o.s && o.s !== 'block');
      const git = gitCtx(root, needTree);
      const { state, result } = mutate((s) => {
        const r = applyDeltas(s, ops, git);
        return { ...r, msgs: takeUnread(s) };
      });
      const lines = [result.errors.length ? `err ${result.errors.join('; ')}` : `ok r${state.rev}`];
      const hint = afterUpdate(state, result.applied);
      if (hint) lines.push(hint);
      if (result.msgs.length) lines.push(`msg ${fmtDirectives(result.msgs)}`);
      return text(lines.join('\n'), result.applied.length === 0);
    },
  );

  server.registerTool(
    'await',
    {
      description: 'Block until the user acts on the board. Rarely needed: once your turn ends, a board click wakes you.',
      inputSchema: AwaitInput,
    },
    async ({ id, sec }, extra) => {
      const limit = (sec ?? 300) * 1000;
      const start = Date.now();
      const token = extra._meta?.progressToken;
      let lastRev = -2;
      let lastPing = start;
      while (!extra.signal.aborted) {
        const rev = store.rev();
        if (rev !== lastRev) {
          lastRev = rev;
          const s = store.read();
          const target = id ? findStep(s, id) : undefined;
          const ready = id ? !!target && target.s !== 'todo' : !!nextStep(s);
          if (ready || unread(s).length) {
            const { state, result: msgs } = mutate((st) => takeUnread(st));
            return text(summary(state, { usage: store.readUsage(), msgs }));
          }
        }
        if (Date.now() - start >= limit) {
          return text(`timeout ${Math.round(limit / 1000)}s: still waiting for approval on the board${boardUrl() ? ` ${boardUrl()}` : ''}`);
        }
        if (token !== undefined && Date.now() - lastPing > 15_000) {
          lastPing = Date.now();
          await extra
            .sendNotification({
              method: 'notifications/progress',
              params: { progressToken: token, progress: Math.round((lastPing - start) / 1000), total: limit / 1000, message: 'waiting for board' },
            })
            .catch(() => {});
        }
        await sleep(500);
      }
      return text('cancelled');
    },
  );

  const transport = new StdioServerTransport();
  const shutdown = async () => {
    clearInterval(takeover);
    if (store.readJson<{ pid?: number }>(store.p.live)?.pid === process.pid) rmSync(store.p.live, { force: true });
    await board?.close().catch(() => {});
    process.exit(0);
  };
  transport.onclose = shutdown;
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await server.connect(transport);
  log(`mcp ready (${root})`);
}

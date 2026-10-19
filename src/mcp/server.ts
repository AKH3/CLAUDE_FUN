// The Claude-facing side: four terse tools. Every description and schema byte
// here is paid for in context, so they stay short on purpose.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { gitCtx } from '../core/git.js';
import { applyDeltas, applyPlan, findStep, fmtDirectives, takeUnread, unread } from '../core/ops.js';
import { AwaitInput, PlanInput, UpdateInput } from '../core/schema.js';
import { Store } from '../core/store.js';
import { afterUpdate, nextStep, summary } from '../core/summary.js';
import { startBoard, type BoardServer } from '../server/http.js';
import { VERSION } from '../version.js';

export const INSTRUCTIONS = `Claude Board: the user follows progress on a live visual board, so keep chat to 1-2 lines and put status in deltas.
1. Call resume first.
2. New work: plan phases/steps as {t,e} (short title; e=effort 1 small|2 medium|3 large), then await approval.
3. Before a step: update {id,s:"run"}. After it: {id,s:"done"|"fail",n:"<=8 words",t:"pass"|"fail"|"none"}.
4. Only approved steps can run; the engine refuses others. Run steps in the order "next" gives.
5. "msg" lines are user directives: ok=approved ("ok A,B in order"=run them back to back), note=follow it, prio=reorder, split=call plan with parent, ask=answer with update {id,a:"<=25 words: what the step does + expected benefit, in the user's language"} then carry on.`;

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMcp(root: string, opts: { ui?: boolean; port?: number } = {}) {
  const store = new Store(root);
  store.init();
  const log = (m: string) => process.stderr.write(`[claude-board] ${m}\n`);

  let board: BoardServer | undefined;
  if (opts.ui !== false) {
    try {
      board = await startBoard(root, { port: opts.port, log });
    } catch (e: any) {
      log(`board not started: ${e?.message ?? e}`);
    }
  }
  const boardUrl = () => board?.url ?? store.readRuntime()?.url;

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
        ? store.mutate((s) => takeUnread(s))
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
        const { state, result } = store.mutate((s) => applyPlan(s, args));
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
      const { state, result } = store.mutate((s) => {
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
    { description: 'Wait until the user approves or sends directives on the board.', inputSchema: AwaitInput },
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
            const { state, result: msgs } = store.mutate((st) => takeUnread(st));
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

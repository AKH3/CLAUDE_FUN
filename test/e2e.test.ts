// End-to-end: a real MCP client drives the server while the test plays the
// user on the HTTP side (approve / note) and listens to the SSE stream.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../src/core/store.js';
import { gitInit, tempDir, TSX } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const PORT = 4610;
const t = tempDir('cfun-e2e-');
let client: Client;
let base = '';

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c: any) => c.text).join('\n') as string, isError: !!r.isError };
};
const act = (body: unknown, headers: Record<string, string> = { 'x-board': '1' }) =>
  fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function hook(name: string, input: unknown) {
  const r = spawnSync(process.execPath, ['--import', TSX, CLI, 'hook', name], { input: JSON.stringify(input), encoding: 'utf8' });
  return r.stdout.trim() ? JSON.parse(r.stdout) : undefined;
}

beforeAll(async () => {
  gitInit(t.dir);
  writeFileSync(join(t.dir, 'app.ts'), 'export const a = 1;\n');
  client = new Client({ name: 'e2e', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', TSX, CLI, 'mcp', '--port', String(PORT)],
      cwd: t.dir,
      env: { ...(process.env as Record<string, string>), CLAUDE_BOARD_ROOT: t.dir },
      stderr: 'ignore',
    }),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
  await new Promise((r) => setTimeout(r, 300));
  t.done();
});

describe('claude <-> board loop', () => {
  it('exposes four small tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual(['await', 'plan', 'resume', 'update']);
    const size = JSON.stringify(tools).length;
    console.log(`tool definitions: ${size} chars`);
    expect(size).toBeLessThan(4000);
  });

  it('runs plan -> gate -> approve -> run -> done with a real diff', async () => {
    const r0 = await call('resume');
    expect(r0.text).toContain('empty board');
    base = /board (http:\/\/\S+)/.exec(r0.text)![1];
    expect(base).toBe(`http://localhost:${PORT}`);
    // the session is open, but no watcher hook is running in this test to wake Claude
    expect(((await (await fetch(`${base}/api/state`)).json()) as { claude: string }).claude).toBe('idle');

    const p = await call('plan', { name: 'E2E', phases: [{ t: 'Core', steps: ['Edit app', 'Second'] }] });
    expect(p.text).toMatch(/^P1 S1\.1,S1\.2 \| 2 await approval r\d+$/);

    const denied = await call('update', { ops: [{ id: 'S1.1', s: 'run' }] });
    expect(denied).toEqual({ text: 'err S1.1 needs approval', isError: true });

    // the guard hook blocks edits while nothing runs
    const g1 = hook('guard', { cwd: t.dir, tool_name: 'Edit', tool_input: { file_path: join(t.dir, 'app.ts') } });
    expect(g1.hookSpecificOutput.permissionDecision).toBe('deny');

    // Claude blocks on await; the user approves on the board
    const waiting = call('await', { id: 'S1.1', sec: 20 });
    await new Promise((r) => setTimeout(r, 400));
    expect((await act({ type: 'approve', id: 'S1.1' })).status).toBe(200);
    const w = await waiting;
    expect(w.text).toContain('next S1.1');
    expect(w.text).toContain('msg ok S1.1');

    expect((await call('update', { ops: [{ id: 'S1.1', s: 'run' }] })).text).toMatch(/^ok r\d+$/);
    // mid-session resume shows the running step as current work...
    const mid = await call('resume');
    expect(mid.text).toContain('now S1.1');
    expect(mid.text).not.toContain('stale');
    // ...while a new session sees it as left over from the last one
    const fresh = hook('session-start', { cwd: t.dir });
    expect(fresh.hookSpecificOutput.additionalContext).toContain('stale 1 step(s) still "run"');
    expect(fresh.hookSpecificOutput.additionalContext).toContain(' S1.1 "Edit app"');
    expect(hook('guard', { cwd: t.dir, tool_name: 'Edit', tool_input: { file_path: join(t.dir, 'app.ts') } })).toBeUndefined();

    writeFileSync(join(t.dir, 'app.ts'), 'export const a = 2;\nexport const b = 3;\n');
    await act({ type: 'note', id: 'S1.2', x: 'keep it tiny' });
    const done = await call('update', { ops: [{ id: 'S1.1', s: 'done', n: 'app edited', t: 'pass' }] });
    expect(done.text).toContain('wait S1.2 need approval -> end turn');
    expect(done.text).toContain('msg S1.2 note:"keep it tiny"');

    const st = new Store(t.dir).read().steps.find((x) => x.id === 'S1.1')!;
    expect(st.r).toMatchObject({ f: 1, files: ['app.ts'], ins: 2, del: 1, t: 'pass' });
    const diff = await (await fetch(`${base}/api/diff/S1.1`)).text();
    expect(diff).toContain('+export const b = 3;');
  }, 60_000);

  it('streams state over SSE and rejects cross-site writes', async () => {
    const res = await fetch(`${base}/api/events`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const nextEvent = async (name: string) => {
      for (;;) {
        const m = new RegExp(`event: ${name}\\ndata: (.*)\\n`).exec(buf);
        if (m) {
          buf = buf.slice(m.index + m[0].length);
          return JSON.parse(m[1]);
        }
        const { value } = await reader.read();
        buf += dec.decode(value, { stream: true });
      }
    };
    const first = await nextEvent('state');
    expect(first.project.name).toBe('E2E');
    await call('update', { ops: [{ id: 'S1.1', n: 'via sse' }] });
    const second = await nextEvent('state');
    expect(second.steps.find((x: any) => x.id === 'S1.1').n).toBe('via sse');
    await reader.cancel();

    expect((await act({ type: 'approve', id: 'S1.2' }, {})).status).toBe(403);
    expect((await act({ type: 'approve', id: 'S1.2' }, { 'x-board': '1', origin: 'https://evil.example' })).status).toBe(403);
  }, 30_000);

  it('hooks inject resume context and silent directives', async () => {
    await act({ type: 'reorder', id: 'S1.2', to: 0 });
    const ctx = hook('prompt', { cwd: t.dir, transcript_path: join(t.dir, 'x.jsonl'), session_id: 'abc' });
    expect(ctx.hookSpecificOutput.additionalContext).toBe('board msg: S1.2 prio 1');
    expect(hook('prompt', { cwd: t.dir })).toBeUndefined();
    const start = hook('session-start', { cwd: t.dir });
    expect(start.hookSpecificOutput.additionalContext).toContain('E2E r');
    expect(start.hookSpecificOutput.additionalContext).toContain(`board ${base}`);
  }, 30_000);
});

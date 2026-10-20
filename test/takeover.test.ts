// Two Claude Code sessions on one project: the first hosts the board. When it
// closes, the second must host it on the same port so the open tab reconnects.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir, TSX } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const PORT = 4650;
const t = tempDir('cfun-takeover-');
const clients: Client[] = [];

async function session() {
  const client = new Client({ name: 'takeover', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', TSX, CLI, 'mcp', '--port', String(PORT)],
      cwd: t.dir,
      env: { ...(process.env as Record<string, string>), CLAUDE_BOARD_ROOT: t.dir },
      stderr: 'ignore',
    }),
  );
  clients.push(client);
  return client;
}

const ping = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(500) });
    return ((await r.json()) as { pid: number }).pid;
  } catch {
    return undefined;
  }
};

afterAll(async () => {
  for (const c of clients) await c.close().catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  t.done();
});

describe('board takeover', () => {
  it('a second session hosts the board on the same port when the first closes', async () => {
    const a = await session();
    const first = await ping();
    expect(first).toBeDefined();
    await session(); // finds the running board and doesn't start another
    expect(await ping()).toBe(first);

    await a.close();
    let next: number | undefined;
    for (let i = 0; i < 40 && (!next || next === first); i++) {
      await new Promise((r) => setTimeout(r, 250));
      next = await ping();
    }
    expect(next).toBeDefined();
    expect(next).not.toBe(first);
  }, 30_000);
});

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { init } from '../src/init.js';
import { tempDir } from './helpers.js';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));

describe('init', () => {
  it('merges into existing config, quotes paths, and is idempotent', () => {
    const t = tempDir('cfun init (x86) ');
    cleanup = t.done;
    const root = join(t.dir, 'my project');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        env: { FOO: '1' },
        permissions: { allow: ['Bash(npm test)'] },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-check' }] }] },
      }),
    );
    writeFileSync(join(root, 'CLAUDE.md'), '# My rules\n');

    init(root, { name: 'P' });
    init(root, { name: 'P' });

    const mcp = json(join(root, '.mcp.json'));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(['board', 'other']);
    expect(mcp.mcpServers.board.command).toBe('node');
    expect(mcp.mcpServers.board.args.at(-1)).toBe('mcp');

    const st = json(join(root, '.claude', 'settings.json'));
    expect(st.env).toEqual({ FOO: '1', MCP_TOOL_TIMEOUT: '600000' });
    expect(st.permissions.allow).toEqual(['Bash(npm test)', 'mcp__board']);
    expect(st.enabledMcpjsonServers).toEqual(['board']);
    expect(st.hooks.SessionStart).toHaveLength(1);
    expect(st.hooks.UserPromptSubmit).toHaveLength(1);
    expect(st.hooks.PreToolUse).toHaveLength(2); // the user's own hook survives
    const guard = st.hooks.PreToolUse.find((g: any) => g.hooks[0].command.endsWith('hook guard'));
    expect(guard.matcher).toBe('Edit|Write|MultiEdit|NotebookEdit|Bash');
    // path is quoted with forward slashes, so spaces and backslashes are safe in bash and cmd
    expect(guard.hooks[0].command).toMatch(/^node "[^"\\]+\/cli\.js" hook guard$/);

    const md = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    expect(md.startsWith('# My rules\n\n<!-- claude-board:start -->')).toBe(true);
    expect(md.match(/claude-board:start/g)).toHaveLength(1);
  });

  it('keeps a user-defined MCP_TOOL_TIMEOUT', () => {
    const t = tempDir();
    cleanup = t.done;
    mkdirSync(join(t.dir, '.claude'));
    writeFileSync(join(t.dir, '.claude', 'settings.json'), JSON.stringify({ env: { MCP_TOOL_TIMEOUT: '1800000' } }));
    init(t.dir, { hooks: false, claudeMd: false });
    expect(json(join(t.dir, '.claude', 'settings.json')).env.MCP_TOOL_TIMEOUT).toBe('1800000');
  });
});

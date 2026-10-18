import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { init, remove } from '../src/init.js';
import { findRoot } from '../src/paths.js';
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

describe('home folder protection and remove', () => {
  const withHome = <T>(home: string, fn: () => T): T => {
    const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      return fn();
    } finally {
      process.env.USERPROFILE = saved.USERPROFILE;
      process.env.HOME = saved.HOME;
    }
  };

  it('init refuses the home folder and writes nothing', () => {
    const t = tempDir('cfun-home-');
    cleanup = t.done;
    withHome(t.dir, () => expect(() => init(t.dir)).toThrow(/home folder/));
    expect(readdirSync(t.dir)).toEqual([]);
  });

  it('findRoot ignores a stray board in the home folder', () => {
    const t = tempDir('cfun-home-');
    cleanup = t.done;
    mkdirSync(join(t.dir, '.claude-board'));
    writeFileSync(join(t.dir, '.claude-board', 'state.json'), '{}');
    const proj = join(t.dir, 'code', 'app');
    mkdirSync(proj, { recursive: true });
    withHome(t.dir, () => expect(findRoot(proj)).toBe(proj));
  });

  it('remove restores pre-existing files exactly and deletes files init created', () => {
    const t = tempDir();
    cleanup = t.done;
    const root = t.dir;
    mkdirSync(join(root, '.claude'));
    const settings = { permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { x: true }, env: { FOO: '1' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } };
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(settings));
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    writeFileSync(join(root, 'CLAUDE.md'), '# Rules\n\nbe nice\n');

    init(root);
    const { report, backup } = remove(root);
    expect(report.length).toBeGreaterThanOrEqual(3);
    expect(json(join(root, '.claude', 'settings.json'))).toEqual(settings);
    expect(json(join(root, '.mcp.json'))).toEqual({ mcpServers: { other: { command: 'x' } } });
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('# Rules\n\nbe nice\n');
    expect(readdirSync(backup).sort()).toEqual(['CLAUDE.md', 'mcp.json', 'settings.json']);
    expect(existsSync(join(root, '.claude-board', 'state.json'))).toBe(true);

    const t2 = tempDir();
    const fresh = t2.dir;
    init(fresh);
    remove(fresh, { purge: true });
    expect(readdirSync(fresh).filter((f) => f !== '.claude')).toEqual([]);
    expect(existsSync(join(fresh, '.claude', 'settings.json'))).toBe(false);
    t2.done();
  });
});

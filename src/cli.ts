#!/usr/bin/env node
// Entry point. Subcommands load their modules lazily so hooks stay fast.
import { Command, Option } from 'commander';
import { findRoot, isUnsafeRoot } from './paths.js';
import { VERSION } from './version.js';

const program = new Command('claude-fun')
  .description('Visual skill-tree board for Claude Code: tiny JSON deltas in, live canvas out.')
  .version(VERSION);

const portOpt = () => new Option('-p, --port <n>', 'first port to try').argParser(Number);

program
  .command('serve', { isDefault: true })
  .description('start the board for this project and open it')
  .addOption(portOpt())
  .option('--no-open', 'do not open the browser')
  .action(async (o: { port?: number; open: boolean }) => {
    const root = findRoot();
    if (isUnsafeRoot(root)) throw new Error(`${root} is not a project folder; cd into a project first.`);
    const { startBoard } = await import('./server/http.js');
    const board = await startBoard(root, { port: o.port, log: console.log });
    if (!board.hosted) console.log(`board already running at ${board.url}`);
    if (o.open) (await import('open')).default(board.url).catch(() => {});
    if (!board.hosted) process.exit(0);
    console.log(`project ${root}\nctrl+c to stop`);
    process.on('SIGINT', async () => {
      await board.close();
      process.exit(0);
    });
  });

program
  .command('init')
  .description('wire this repo to the board (.claude-board/, .mcp.json, hooks, CLAUDE.md)')
  .option('-n, --name <name>', 'project name')
  .option('-g, --goal <goal>', 'one-line goal')
  .addOption(new Option('--guard <mode>', 'file-edit guard').choices(['strict', 'sensitive', 'off']))
  .option('--no-hooks', 'skip Claude Code hooks')
  .option('--no-claude-md', 'do not touch CLAUDE.md')
  .action(async (o) => {
    const { init } = await import('./init.js');
    const root = findRoot();
    const report = init(root, { name: o.name, goal: o.goal, guard: o.guard, hooks: o.hooks, claudeMd: o.claudeMd });
    console.log(`Claude Board ready in ${root}\n${report.join('\n')}\n\nnext: run \`claude\` here (the board starts with it), or \`claude-fun\` to open the board now.`);
  });

program
  .command('remove')
  .description('undo init in this repo (board server, hooks, CLAUDE.md snippet); backs files up first')
  .option('--purge', 'also delete .claude-board/ (the plan and its history)')
  .option('--backup <dir>', 'where to put the backup (default: system temp)')
  .action(async (o: { purge?: boolean; backup?: string }) => {
    const { remove } = await import('./init.js');
    const root = findRoot();
    const { report, backup } = remove(root, { purge: o.purge, backupDir: o.backup });
    console.log(report.length ? `Claude Board removed from ${root}\n${report.join('\n')}\nbackup: ${backup}` : `nothing to remove in ${root}`);
  });

program
  .command('mcp')
  .description('stdio MCP server for Claude Code (also hosts the board UI)')
  .addOption(portOpt())
  .option('--no-ui', 'do not host the board UI')
  .action(async (o: { port?: number; ui: boolean }) => {
    const root = findRoot();
    if (isUnsafeRoot(root)) {
      process.stderr.write(`[claude-board] ${root} is not a project folder; open Claude Code inside a project.\n`);
      process.exit(1);
    }
    const { runMcp } = await import('./mcp/server.js');
    await runMcp(root, { ui: o.ui, port: o.port });
  });

program
  .command('status')
  .description('print the compact resume summary')
  .action(async () => {
    const { Store } = await import('./core/store.js');
    const { summary } = await import('./core/summary.js');
    const { unread } = await import('./core/ops.js');
    const store = new Store(findRoot());
    if (!store.exists()) return console.log('no board here; run `claude-fun init`');
    const s = store.read();
    console.log(summary(s, { usage: store.readUsage(), msgs: unread(s), url: store.readRuntime()?.url }));
  });

program
  .command('hook <name>')
  .description('Claude Code hook handler: session-start | prompt | guard')
  .action(async (name: string) => {
    const { runHook } = await import('./hooks/index.js');
    await runHook(name);
  });

program
  .command('demo')
  .description('open a sample board in a temp folder; --simulate plays Claude')
  .addOption(portOpt())
  .option('--no-open', 'do not open the browser')
  .option('--simulate', 'advance approved steps automatically')
  .action(async (o: { port?: number; open: boolean; simulate?: boolean }) => {
    const { runDemo } = await import('./demo.js');
    await runDemo({ port: o.port ?? 3900, open: o.open, simulate: !!o.simulate });
  });

program.parseAsync().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

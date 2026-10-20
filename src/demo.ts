// `claude-fun demo`: a sample board in a throwaway git repo. With --simulate a
// tiny fake "Claude" works through approved steps so the board moves on its own.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitCtx } from './core/git.js';
import { applyDeltas, applyPlan, leaves, now, takeUnread } from './core/ops.js';
import type { Usage } from './core/schema.js';
import { Store } from './core/store.js';
import { nextStep } from './core/summary.js';
import { startBoard } from './server/http.js';

function demoStatePath() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const f = join(dir, 'examples', 'demo-state.json');
    if (existsSync(f)) return f;
    dir = dirname(dir);
  }
  throw new Error('examples/demo-state.json not found');
}

const NOTES = ['تم بنجاح', 'endpoints ready', 'أضيفت الاختبارات', 'refactor + types', 'تم الربط'];

export async function runDemo(opts: { port: number; open: boolean; simulate: boolean }) {
  const root = join(tmpdir(), `claude-board-demo-${Date.now().toString(36)}`);
  mkdirSync(join(root, '.claude-board'), { recursive: true });
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  } catch {}
  writeFileSync(join(root, 'README.md'), '# demo shop api\n');
  const state = JSON.parse(readFileSync(demoStatePath(), 'utf8'));
  state.project.since = now();
  writeFileSync(join(root, '.claude-board', 'state.json'), JSON.stringify(state, null, 2));

  const store = new Store(root);
  store.init();
  const usage: Usage = {
    total: { in: 1200, out: 18_400, cw: 22_000, cr: 410_000 },
    steps: { 'S1.1': 9100, 'S1.2': 4200, 'S1.3': 3100, 'S2.1': 14_800, 'S2.2': 10_400 },
    phases: { P1: 16_400, P2: 25_200 },
    updated: now(),
  };
  store.writeJson(store.p.usage, usage);

  const board = await startBoard(root, { port: opts.port, log: console.log, usage: false });
  console.log(`demo project ${root}${opts.simulate ? '\nsimulating Claude: approve steps on the board and watch them run' : ''}`);
  if (opts.open) (await import('open')).default(board.url).catch(() => {});

  if (opts.simulate) {
    let tick = 0;
    // the fake Claude is always listening, like a real session with the watcher hook
    let was = '';
    const listen = (mode: 'busy' | 'idle') => {
      if (mode !== was) store.writeJson(store.p.listen, { pid: process.pid, id: 'demo', mode, at: now() });
      was = mode;
    };
    listen('idle');
    setInterval(() => {
      tick++;
      const s = store.read();
      const busy = s.inbox.some((d) => !d.ack) || leaves(s).some((x) => x.s === 'run' || x.s === 'ok');
      listen(busy ? 'busy' : 'idle');
      const msgs = s.inbox.some((d) => !d.ack) ? store.mutate((st) => takeUnread(st)).result : [];
      for (const m of msgs) {
        if (m.k === 'split' && m.s) store.mutate((st) => applyPlan(st, { parent: m.s, steps: ['تحليل', 'تنفيذ', 'مراجعة'] }));
        if (m.k === 'ask' && m.s) store.mutate((st) => applyDeltas(st, [{ id: m.s!, a: 'خطوة تجريبية: تبني جزءاً صغيراً من المشروع، وفائدتها أن ما بعدها يعتمد عليها فتقل الأخطاء لاحقاً.' }]));
      }
      const running = leaves(store.read()).find((x) => x.s === 'run');
      if (running) {
        const file = join(root, 'src', `${running.id.replace(/\./g, '_')}.ts`);
        mkdirSync(dirname(file), { recursive: true });
        const lines = Array.from({ length: 6 + (tick % 9) }, (_, i) => `export const v${i} = ${i * tick};`);
        writeFileSync(file, `// ${running.t}\n${lines.join('\n')}\n`);
        const fail = Math.random() < 0.12;
        store.mutate((st) =>
          applyDeltas(st, [{ id: running.id, s: fail ? 'fail' : 'done', n: fail ? 'test failed' : NOTES[tick % NOTES.length], t: fail ? 'fail' : 'pass' }], gitCtx(root, true)),
        );
        const spent = 3000 + Math.round(Math.random() * 9000);
        usage.total.out += Math.round(spent * 0.4);
        usage.total.cw += Math.round(spent * 0.6);
        usage.steps[running.id] = spent;
        usage.phases[running.p] = (usage.phases[running.p] ?? 0) + spent;
        usage.updated = now();
        store.writeJson(store.p.usage, usage);
        return;
      }
      const next = nextStep(store.read());
      if (next) store.mutate((st) => applyDeltas(st, [{ id: next.id, s: 'run' }], gitCtx(root, true)));
    }, 3500);
  }

  process.on('SIGINT', async () => {
    await board.close();
    process.exit(0);
  });
}

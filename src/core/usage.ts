// Token Efficiency Meter: real numbers from Claude Code's own session logs,
// attributed to whichever step was running at the time. Costs Claude nothing.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { leaves } from './ops.js';
import type { State, Usage } from './schema.js';
import type { Store } from './store.js';

interface Msg {
  ts: number;
  in: number;
  out: number;
  cw: number;
  cr: number;
}

interface Tail {
  offset: number;
  rest: string;
}

export const projectSlug = (root: string) => root.replace(/[^a-zA-Z0-9]/g, '-');

export class UsageTracker {
  private tails = new Map<string, Tail>();
  private msgs = new Map<string, Msg>();
  private sessionId?: string;

  constructor(private store: Store) {}

  private projectDir(): string | undefined {
    const sess = this.store.readJson<{ transcript?: string; session?: string }>(this.store.p.session);
    if (sess?.session) this.sessionId = sess.session;
    if (sess?.transcript && existsSync(sess.transcript)) return dirname(sess.transcript);
    const guess = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', projectSlug(this.store.root));
    return existsSync(guess) ? guess : undefined;
  }

  private files(since: number): string[] {
    const dir = this.projectDir();
    if (!dir) return [];
    const out: string[] = [];
    const consider = (f: string) => {
      try {
        if (statSync(f).mtimeMs >= since) out.push(f);
      } catch {}
    };
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl')) consider(join(dir, e.name));
      else if (e.isDirectory()) {
        const sub = join(dir, e.name, 'subagents');
        if (existsSync(sub)) for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) consider(join(sub, f));
      }
    }
    return out;
  }

  private read(file: string) {
    const tail = this.tails.get(file) ?? { offset: 0, rest: '' };
    const size = statSync(file).size;
    if (size < tail.offset) Object.assign(tail, { offset: 0, rest: '' });
    if (size === tail.offset) return false;
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - tail.offset);
      readSync(fd, buf, 0, buf.length, tail.offset);
      tail.offset = size;
      const text = tail.rest + buf.toString('utf8');
      const lines = text.split('\n');
      tail.rest = lines.pop() ?? '';
      for (const line of lines) this.ingest(line);
    } finally {
      closeSync(fd);
      this.tails.set(file, tail);
    }
    return true;
  }

  private ingest(line: string) {
    if (!line.includes('"usage"')) return;
    try {
      const j = JSON.parse(line);
      const u = j?.message?.usage;
      const id = j?.message?.id;
      if (j?.type !== 'assistant' || !u || !id) return;
      // streamed messages repeat; keep the last record per message id
      this.msgs.set(id, {
        ts: Date.parse(j.timestamp) || 0,
        in: u.input_tokens ?? 0,
        out: u.output_tokens ?? 0,
        cw: u.cache_creation_input_tokens ?? 0,
        cr: u.cache_read_input_tokens ?? 0,
      });
    } catch {}
  }

  /** Reads new log bytes; returns fresh totals when anything changed. */
  tick(state: State, force = false): Usage | undefined {
    const since = Date.parse(state.project.since ?? '') || 0;
    let changed = force;
    for (const f of this.files(since)) {
      try {
        if (this.read(f)) changed = true;
      } catch {}
    }
    return changed ? this.compute(state) : undefined;
  }

  compute(state: State): Usage {
    const since = Date.parse(state.project.since ?? '') || 0;
    const spans = leaves(state)
      .filter((x) => x.at.run)
      .map((x) => ({ id: x.id, p: x.p, a: Date.parse(x.at.run!), b: x.at.end ? Date.parse(x.at.end) : Infinity }))
      .sort((x, y) => y.a - x.a);
    const u: Usage = { session: this.sessionId, total: { in: 0, out: 0, cw: 0, cr: 0 }, steps: {}, phases: {}, updated: new Date().toISOString() };
    for (const m of this.msgs.values()) {
      if (m.ts < since) continue;
      u.total.in += m.in;
      u.total.out += m.out;
      u.total.cw += m.cw;
      u.total.cr += m.cr;
      const span = spans.find((sp) => m.ts >= sp.a && m.ts <= sp.b);
      if (span) {
        const fresh = m.in + m.cw + m.out;
        u.steps[span.id] = (u.steps[span.id] ?? 0) + fresh;
        u.phases[span.p] = (u.phases[span.p] ?? 0) + fresh;
      }
    }
    return u;
  }
}

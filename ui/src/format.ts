import type { StepStatus } from '../../src/core/schema';
import type { IconName } from './components/Icon';

export const kfmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export function duration(a?: string, b?: string): string | undefined {
  if (!a) return undefined;
  const ms = (b ? Date.parse(b) : Date.now()) - Date.parse(a);
  if (!(ms >= 0)) return undefined;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const STATUS_COLOR: Record<StepStatus | 'locked', string> = {
  todo: 'var(--todo)',
  ok: 'var(--ok)',
  run: 'var(--run)',
  done: 'var(--done)',
  fail: 'var(--fail)',
  block: 'var(--block)',
  skip: 'var(--skip)',
  locked: 'var(--skip)',
};

export const STATUS_ICON: Record<StepStatus | 'locked', IconName> = {
  todo: 'pause',
  ok: 'check',
  run: 'play',
  done: 'check',
  fail: 'alert',
  block: 'alert',
  skip: 'x',
  locked: 'lock',
};

export const PHASE_PALETTE = ['#8b6cff', '#4aa8ff', '#34d399', '#f7c948', '#fb7185', '#22d3ee', '#f97316', '#a3e635'];

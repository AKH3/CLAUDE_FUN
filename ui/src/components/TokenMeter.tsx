import { useEffect, useRef, useState } from 'react';
import { phasesSorted } from '../../../src/core/tree';
import { kfmt, PHASE_PALETTE } from '../format';
import { useBoard, useT } from '../store';
import { Icon } from './Icon';

export function TokenMeter() {
  const t = useT();
  const state = useBoard((s) => s.state)!;
  const usage = useBoard((s) => s.usage);
  const act = useBoard((s) => s.act);
  const [open, setOpen] = useState(false);
  const [budget, setBudget] = useState(String(state.cfg.budget));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setBudget(String(state.cfg.budget)), [state.cfg.budget]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);

  const total = usage?.total ?? { in: 0, out: 0, cw: 0, cr: 0 };
  const used = total.in + total.cw + total.out;
  const cap = Math.max(state.cfg.budget, 1);
  const pct = Math.min(100, (used / cap) * 100);
  const over = used > cap;
  const phases = phasesSorted(state);
  const attributed = phases.reduce((a, p) => a + (usage?.phases[p.id] ?? 0), 0);
  const doneSteps = Object.keys(usage?.steps ?? {}).length;
  const perStep = doneSteps ? Math.round(attributed / doneSteps) : 0;
  const tone = over ? 'var(--fail)' : pct > 80 ? 'var(--todo)' : 'var(--done)';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 hover:bg-panel2"
        title={t('meter.title')}
      >
        <Icon name="bolt" size={14} className="shrink-0" />
        <div className="flex w-28 flex-col gap-1 sm:w-36" dir="ltr">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-bg">
            {phases.map((p, i) => {
              const v = usage?.phases[p.id] ?? 0;
              return v ? <div key={p.id} style={{ width: `${(v / cap) * 100}%`, background: PHASE_PALETTE[i % PHASE_PALETTE.length] }} /> : null;
            })}
            {used > attributed && <div style={{ width: `${((used - attributed) / cap) * 100}%`, background: 'var(--muted)', opacity: 0.6 }} />}
          </div>
          <div className="flex justify-between font-mono text-[10.5px] leading-none">
            <span style={{ color: tone }}>{kfmt(used)}</span>
            <span className="text-muted">{kfmt(cap)}</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute end-0 top-full z-40 mt-2 w-72 rounded-xl border border-line bg-panel p-3 text-[12.5px] shadow-[var(--shadow)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{t('meter.title')}</span>
            <span className="font-mono" style={{ color: tone }} dir="ltr">
              {pct.toFixed(0)}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono" dir="ltr">
            <span className="text-muted">{t('meter.in')}</span>
            <span className="text-end">{kfmt(total.in)}</span>
            <span className="text-muted">{t('meter.cw')}</span>
            <span className="text-end">{kfmt(total.cw)}</span>
            <span className="text-muted">{t('meter.out')}</span>
            <span className="text-end">{kfmt(total.out)}</span>
            <span className="text-muted opacity-70">{t('meter.cr')}</span>
            <span className="text-end opacity-70">{kfmt(total.cr)}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('meter.note')}</p>
          <div className="my-2 border-t border-line" />
          <ul className="space-y-1">
            {phases.map((p, i) => {
              const v = usage?.phases[p.id] ?? 0;
              const b = p.budget;
              return (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: PHASE_PALETTE[i % PHASE_PALETTE.length] }} />
                  <span dir="auto" className="flex-1 truncate">
                    {p.t}
                  </span>
                  <span className="font-mono text-muted" dir="ltr">
                    {kfmt(v)}
                    {b ? ` / ${kfmt(b)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          {perStep > 0 && (
            <div className="mt-2 text-[11.5px] text-muted">
              ≈ <span className="font-mono" dir="ltr">{kfmt(perStep)}</span> {t('meter.perStep')}
            </div>
          )}
          <label className="mt-3 flex items-center gap-2">
            <span className="text-muted">{t('meter.budget')}</span>
            <input
              type="number"
              min={1000}
              step={10000}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              onBlur={() => {
                const n = Number(budget);
                if (n >= 1000 && n !== state.cfg.budget) act({ type: 'setCfg', budget: Math.round(n) });
              }}
              className="w-full rounded-md border border-line bg-bg px-2 py-1 font-mono outline-none focus:border-ok"
              dir="ltr"
            />
          </label>
        </div>
      )}
    </div>
  );
}

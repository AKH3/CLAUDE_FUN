import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GuardMode } from '../../../src/core/schema';
import { hasChildren } from '../../../src/core/tree';
import type { Panel } from '../App';
import { useBoard, useT } from '../store';
import { Icon } from './Icon';
import { TokenMeter } from './TokenMeter';

function Ring({ value, total }: { value: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <div className="relative grid size-10 place-items-center" title={`${value}/${total}`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--line)" strokeWidth="3.5" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={pct >= 1 ? 'var(--gold)' : 'var(--done)'}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: 'stroke-dasharray .7s ease' }}
        />
      </svg>
      <span className="font-mono text-[10.5px] font-bold" dir="ltr">
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

/** One plain sentence on whether a click reaches Claude now; replaces the old outbox + live dot. */
function ClaudePill() {
  const t = useT();
  const connected = useBoard((s) => s.connected);
  const claude = useBoard((s) => s.claude);
  const pending = useBoard((s) => s.state?.inbox.filter((d) => !d.ack).length ?? 0);
  const key = connected ? claude : 'offline';
  const tone = {
    working: 'bg-run/15 text-run',
    ready: 'bg-done/15 text-done',
    idle: 'bg-todo/15 text-todo',
    away: 'bg-panel2 text-muted',
    offline: 'bg-fail/15 text-fail',
  }[key];
  const dot = { working: 'bg-run animate-pulse', ready: 'bg-done', idle: 'bg-todo', away: 'bg-muted', offline: 'bg-fail' }[key];
  return (
    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-medium ${tone}`} title={t(`claude.hint.${key}` as const)} role="status">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      {t(`claude.${key}` as const)}
      {pending > 0 && (
        <span className="rounded-full bg-[var(--bg)]/40 px-1.5 font-mono text-[11px]" title={t('claude.pending')}>
          {pending}
        </span>
      )}
    </span>
  );
}

const GUARDS: GuardMode[] = ['strict', 'sensitive', 'off'];

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-bg p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          title={o.title}
          onClick={() => value !== o.v && onChange(o.v)}
          className={`flex-1 rounded-md px-2 py-1 text-[12.5px] transition ${value === o.v ? 'bg-ok/15 font-semibold text-ok' : 'text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      {children}
      {hint && <p className="text-[11.5px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

/** Things you set once: language, theme, the edit guard and auto-approve. */
function SettingsMenu() {
  const t = useT();
  const state = useBoard((s) => s.state)!;
  const lang = useBoard((s) => s.lang);
  const theme = useBoard((s) => s.theme);
  const setLang = useBoard((s) => s.setLang);
  const setTheme = useBoard((s) => s.setTheme);
  const act = useBoard((s) => s.act);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`grid size-9 place-items-center rounded-lg border bg-panel hover:text-text ${open ? 'border-ok text-ok' : 'border-line text-muted'}`}
        title={t('settings')}
        aria-label={t('settings')}
      >
        <Icon name="sliders" size={16} />
      </button>
      {open && (
        <div className="absolute end-0 top-full z-40 mt-2 w-72 divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel shadow-[var(--shadow)]">
          <Row label={t('settings.lang')}>
            <Segmented value={lang} onChange={setLang} options={[{ v: 'ar', label: 'العربية' }, { v: 'en', label: 'English' }]} />
          </Row>
          <Row label={t('settings.theme')}>
            <Segmented value={theme} onChange={setTheme} options={[{ v: 'dark', label: t('theme.dark') }, { v: 'light', label: t('theme.light') }]} />
          </Row>
          <Row label={t('guard.title')} hint={t(`guard.hint.${state.cfg.guard}` as const)}>
            <Segmented
              value={state.cfg.guard}
              onChange={(mode) => act({ type: 'setGuard', mode }, `${t('guard.title')} · ${t(`guard.${mode}` as const)}`)}
              options={GUARDS.map((g) => ({ v: g, label: t(`guard.${g}` as const), title: t(`guard.hint.${g}` as const) }))}
            />
          </Row>
          <label className="flex cursor-pointer items-start gap-2 px-3 py-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={state.cfg.autoApprove}
              onChange={(e) => act({ type: 'setCfg', autoApprove: e.target.checked })}
              className="mt-0.5 size-4 shrink-0 accent-[var(--ok)]"
            />
            <span>
              {t('autoApprove')}
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{t('autoApprove.hint')}</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

export function TopBar({ panel, onPanel }: { panel?: Panel; onPanel: (p: Panel) => void }) {
  const t = useT();
  const state = useBoard((s) => s.state)!;

  const leaves = state.steps.filter((x) => !hasChildren(state, x.id) && x.s !== 'skip');
  const done = leaves.filter((x) => x.s === 'done').length;
  const archived = new Set(state.archive.phases.map((p) => p.id));
  const archiveCount = archived.size + state.archive.steps.filter((x) => !archived.has(x.p)).length;
  const panels = [
    ['archive', 'archive', t('archive'), archiveCount],
    ['activity', 'list', t('activity'), 0],
  ] as const;

  return (
    <header className="relative z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel/90 px-4 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2.5">
        <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true">
          <path d="M16 2 30 16 16 30 2 16Z" fill="var(--run)" />
          <path d="M16 9 23 16 16 23 9 16Z" fill="var(--done)" />
        </svg>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-bold tracking-[0.18em] text-muted" dir="ltr">
              CLAUDE FUN
            </span>
            <span dir="auto" className="truncate text-[15px] font-semibold">
              {state.project.name}
            </span>
          </div>
          {state.project.goal && (
            <div dir="auto" className="max-w-[40ch] truncate text-[12px] text-muted">
              {state.project.goal}
            </div>
          )}
        </div>
      </div>

      <div className="ms-auto flex flex-wrap items-center gap-2">
        <ClaudePill />
        <div className="flex items-center gap-1.5">
          <Ring value={done} total={leaves.length} />
          <span className="hidden font-mono text-[12px] text-muted sm:inline" dir="ltr">
            {done}/{leaves.length}
          </span>
        </div>
        <TokenMeter />
        <button
          type="button"
          onClick={() => onPanel('message')}
          aria-pressed={panel === 'message'}
          className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition ${
            panel === 'message' ? 'bg-ok text-white' : 'bg-ok/15 text-ok hover:bg-ok/25'
          }`}
        >
          <Icon name="chat" size={15} />
          {t('msg.title')}
        </button>
        {panels.map(([key, icon, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => onPanel(key)}
            aria-pressed={panel === key}
            className={`relative grid size-9 place-items-center rounded-lg border bg-panel hover:text-text ${panel === key ? 'border-ok text-ok' : 'border-line text-muted'}`}
            title={label}
            aria-label={label}
          >
            <Icon name={icon} size={16} />
            {count > 0 && (
              <span className="absolute -end-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-ok px-1 font-mono text-[10px] font-bold text-white">{count}</span>
            )}
          </button>
        ))}
        <SettingsMenu />
      </div>
    </header>
  );
}

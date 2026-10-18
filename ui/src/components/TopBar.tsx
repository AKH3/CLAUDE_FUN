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

const GUARDS: GuardMode[] = ['strict', 'sensitive', 'off'];

export function TopBar({ panel, onPanel }: { panel?: Panel; onPanel: (p: Panel) => void }) {
  const t = useT();
  const state = useBoard((s) => s.state)!;
  const connected = useBoard((s) => s.connected);
  const lang = useBoard((s) => s.lang);
  const theme = useBoard((s) => s.theme);
  const setLang = useBoard((s) => s.setLang);
  const setTheme = useBoard((s) => s.setTheme);
  const act = useBoard((s) => s.act);

  const leaves = state.steps.filter((x) => !hasChildren(state, x.id) && x.s !== 'skip');
  const done = leaves.filter((x) => x.s === 'done').length;
  const pending = state.inbox.filter((d) => !d.ack).length;
  const archived = new Set(state.archive.phases.map((p) => p.id));
  const archiveCount = archived.size + state.archive.steps.filter((x) => !archived.has(x.p)).length;
  const panels = [
    ['commands', 'terminal', t('cmd.title'), 0],
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
        <div className="flex items-center gap-1.5">
          <Ring value={done} total={leaves.length} />
          <span className="hidden font-mono text-[12px] text-muted sm:inline" dir="ltr">
            {done}/{leaves.length}
          </span>
        </div>

        <TokenMeter />

        <span
          className={`hidden items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] md:flex ${pending ? 'bg-todo/15 text-todo' : 'text-muted'}`}
          title={pending ? t('outbox') : t('outbox.none')}
        >
          <Icon name="mail" size={14} />
          {pending ? (
            <>
              <span className="font-mono">{pending}</span> {t('outbox')}
            </>
          ) : (
            <Icon name="check" size={12} />
          )}
        </span>

        <div className="flex items-center rounded-lg border border-line bg-panel p-0.5" role="radiogroup" aria-label={t('guard.title')}>
          <Icon name="shield" size={14} className="mx-1.5 text-muted" />
          {GUARDS.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={state.cfg.guard === g}
              title={t(`guard.hint.${g}` as const)}
              onClick={() => state.cfg.guard !== g && act({ type: 'setGuard', mode: g }, `guard ${g}`)}
              className={`rounded-md px-2 py-1 text-[12px] transition ${
                state.cfg.guard === g ? (g === 'off' ? 'bg-fail/15 text-fail' : 'bg-ok/15 text-ok') : 'text-muted hover:text-text'
              }`}
            >
              {t(`guard.${g}` as const)}
            </button>
          ))}
        </div>

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
        <button
          type="button"
          onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          className="grid size-9 place-items-center rounded-lg border border-line bg-panel text-[13px] font-semibold text-muted hover:text-text"
          title="العربية / English"
        >
          {t('lang')}
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="grid size-9 place-items-center rounded-lg border border-line bg-panel text-muted hover:text-text"
          title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
          aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
        <span className="flex items-center gap-1.5 text-[12px] text-muted" title={connected ? t('live.on') : t('live.off')}>
          <span className={`size-2.5 rounded-full ${connected ? 'bg-done shadow-[0_0_8px_var(--done)]' : 'bg-fail'}`} />
          <span className="hidden lg:inline">{connected ? t('live.on') : t('live.off')}</span>
        </span>
      </div>
    </header>
  );
}

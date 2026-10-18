import { useState } from 'react';
import { useBoard, useT } from '../store';
import { Icon, type IconName } from './Icon';

const KIND_ICON: Record<string, { icon: IconName; color: string }> = {
  done: { icon: 'check', color: 'var(--done)' },
  fail: { icon: 'alert', color: 'var(--fail)' },
  run: { icon: 'play', color: 'var(--run)' },
  phase: { icon: 'star', color: 'var(--gold)' },
  plan: { icon: 'list', color: 'var(--ok)' },
  user: { icon: 'mail', color: 'var(--todo)' },
  note: { icon: 'note', color: 'var(--muted)' },
  block: { icon: 'alert', color: 'var(--block)' },
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function ActivityPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const state = useBoard((s) => s.state)!;
  const act = useBoard((s) => s.act);
  const [v, setV] = useState('');
  const send = async () => {
    if (v.trim() && (await act({ type: 'note', x: v.trim() }, 'note'))) setV('');
  };

  return (
    <aside className="scroll-thin absolute inset-y-0 start-0 z-20 flex w-[min(340px,100vw)] flex-col overflow-y-auto border-e border-line bg-panel shadow-[var(--shadow)]">
      <div className="sticky top-0 flex items-center gap-2 bg-panel px-4 py-3">
        <Icon name="list" size={16} />
        <span className="font-semibold">{t('activity')}</span>
        <button type="button" onClick={onClose} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2" aria-label={t('act.close')}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="border-t border-line px-4 py-3">
        <div className="flex gap-2">
          <input
            dir="auto"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={t('note.general')}
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-muted focus:border-ok"
          />
          <button type="button" onClick={send} disabled={!v.trim()} className="grid size-9 place-items-center rounded-lg bg-ok text-white disabled:opacity-30" aria-label={t('act.send')}>
            <Icon name="send" size={15} />
          </button>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={state.cfg.autoApprove} onChange={(e) => act({ type: 'setCfg', autoApprove: e.target.checked })} className="accent-[var(--ok)]" />
          {t('autoApprove')}
        </label>
      </div>
      <ol className="border-t border-line px-2 py-2">
        {[...state.log].reverse().map((l, i) => {
          const k = KIND_ICON[l.k ?? 'note'] ?? KIND_ICON.note;
          return (
            <li key={`${l.at}-${i}`} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-panel2">
              <span className="mt-0.5 shrink-0" style={{ color: k.color }}>
                <Icon name={k.icon} size={13} />
              </span>
              <span dir="auto" className="min-w-0 flex-1 break-words">
                {l.m}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-muted" dir="ltr">
                {hhmm(l.at)}
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

const TOAST_STYLE: Record<string, { icon: IconName; color: string }> = {
  done: { icon: 'check', color: 'var(--done)' },
  fail: { icon: 'alert', color: 'var(--fail)' },
  phase: { icon: 'star', color: 'var(--gold)' },
  plan: { icon: 'list', color: 'var(--ok)' },
  sent: { icon: 'send', color: 'var(--ok)' },
  error: { icon: 'alert', color: 'var(--fail)' },
};

export function Toasts() {
  const toasts = useBoard((s) => s.toasts);
  const drop = useBoard((s) => s.dropToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((x) => {
        const st = TOAST_STYLE[x.kind];
        return (
          <button
            key={x.id}
            type="button"
            onClick={() => drop(x.id)}
            className={`toast pointer-events-auto flex max-w-[min(520px,100%)] items-center gap-2 rounded-xl border bg-panel px-3.5 py-2.5 text-[13px] shadow-[var(--shadow)] ${x.kind === 'phase' ? 'text-[15px] font-semibold' : ''}`}
            style={{ borderColor: st.color }}
          >
            <span style={{ color: st.color }}>
              <Icon name={st.icon} size={x.kind === 'phase' ? 18 : 15} fill={x.kind === 'phase'} />
            </span>
            <span dir="auto" className="truncate">
              {x.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState() {
  const t = useT();
  const act = useBoard((s) => s.act);
  const [v, setV] = useState('');
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="w-[min(460px,100%)] rounded-2xl border border-dashed border-line bg-panel/70 p-7 text-center shadow-[var(--shadow)]">
        <svg viewBox="0 0 32 32" className="mx-auto mb-4 size-12 opacity-80" aria-hidden="true">
          <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="var(--run)" strokeWidth="1.5" />
          <path d="M16 9 23 16 16 23 9 16Z" fill="var(--done)" opacity=".6" />
        </svg>
        <h2 className="text-lg font-semibold">{t('empty.title')}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t('empty.body')}</p>
        <p className="mt-2 font-mono text-[12.5px] text-ok">{t('empty.cmd')}</p>
        <div className="mt-5 flex gap-2">
          <input
            dir="auto"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={async (e) => e.key === 'Enter' && v.trim() && (await act({ type: 'addPhase', t: v.trim() })) && setV('')}
            placeholder={t('act.addPhase')}
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-muted focus:border-ok"
          />
          <button
            type="button"
            disabled={!v.trim()}
            onClick={async () => (await act({ type: 'addPhase', t: v.trim() })) && setV('')}
            className="grid size-9 place-items-center rounded-lg bg-ok text-white disabled:opacity-30"
            aria-label={t('act.addPhase')}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

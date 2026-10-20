import { useState } from 'react';
import { copyText } from '../copy';
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

  return (
    <aside className="scroll-thin absolute inset-y-0 start-0 z-20 flex w-[min(340px,100vw)] flex-col overflow-y-auto border-e border-line bg-panel shadow-[var(--shadow)]">
      <div className="sticky top-0 flex items-center gap-2 bg-panel px-4 py-3">
        <Icon name="list" size={16} />
        <span className="font-semibold">{t('activity')}</span>
        <button type="button" onClick={onClose} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2" aria-label={t('act.close')}>
          <Icon name="x" size={16} />
        </button>
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
  later: { icon: 'pause', color: 'var(--todo)' },
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
  const openAdd = useBoard((s) => s.openAdd);
  const [v, setV] = useState('');
  const send = async () => {
    const x = v.trim();
    if (x && (await act({ type: 'note', x: `plan: ${x}` }))) setV('');
  };
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="w-[min(480px,100%)] rounded-2xl border border-dashed border-line bg-panel/70 p-7 text-center shadow-[var(--shadow)]">
        <svg viewBox="0 0 32 32" className="mx-auto mb-4 size-12 opacity-80" aria-hidden="true">
          <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="var(--run)" strokeWidth="1.5" />
          <path d="M16 9 23 16 16 23 9 16Z" fill="var(--done)" opacity=".6" />
        </svg>
        <h2 className="text-lg font-semibold">{t('empty.title')}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t('empty.body')}</p>
        <textarea
          dir="auto"
          rows={3}
          value={v}
          maxLength={480}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={t('empty.placeholder')}
          className="mt-5 w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-start text-[14px] outline-none placeholder:text-muted focus:border-ok"
        />
        <button
          type="button"
          disabled={!v.trim()}
          onClick={send}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-done px-3 py-2 text-[14px] font-semibold text-[var(--bg)] transition hover:brightness-110 disabled:opacity-40"
        >
          <Icon name="send" size={15} />
          {t('empty.send')}
        </button>
        <button type="button" onClick={() => openAdd('phase')} className="mt-3 text-[12.5px] text-muted underline-offset-4 hover:text-text hover:underline">
          {t('empty.manual')}
        </button>
      </div>
    </div>
  );
}

/** Shown while clicks wait and nothing can wake Claude: says exactly what to type, with a copy button. */
export function PendingBanner() {
  const t = useT();
  const connected = useBoard((s) => s.connected);
  const claude = useBoard((s) => s.claude);
  const toast = useBoard((s) => s.toast);
  const pending = useBoard((s) => s.state?.inbox.filter((d) => !d.ack).length ?? 0);
  if (!connected || !pending || claude === 'ready' || claude === 'working') return null;
  const word = t('banner.word');
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-todo/30 bg-todo/12 px-4 py-2 text-[13px]">
      <Icon name="pause" size={14} className="shrink-0 text-todo" />
      <span className="font-semibold text-todo">{t('banner.title')}</span>
      <span>{t(claude === 'away' ? 'banner.away' : 'banner.idle')}</span>
      <button
        type="button"
        onClick={async () => (await copyText(word)) && toast('done', `${t('banner.copy')} ✓`)}
        className="ms-auto flex items-center gap-1.5 rounded-lg bg-todo/20 px-2.5 py-1 text-[12.5px] font-medium text-todo hover:bg-todo/30"
      >
        <Icon name="copy" size={13} />
        {t('banner.copy')}
      </button>
    </div>
  );
}

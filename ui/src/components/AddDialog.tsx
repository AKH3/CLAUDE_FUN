import { useEffect, useState } from 'react';
import { useBoard, useT } from '../store';
import { Icon } from './Icon';

/** "New task" (title + details) or "new phase" (name) dialog, opened from the + boxes on the board. */
export function AddDialog() {
  const t = useT();
  const adding = useBoard((s) => s.adding);
  const close = useBoard((s) => s.closeAdd);
  const act = useBoard((s) => s.act);
  const state = useBoard((s) => s.state);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle('');
    setDetails('');
    setApprove(false);
  }, [adding]);

  useEffect(() => {
    if (!adding) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding, close]);

  if (!adding) return null;
  const isPhase = adding === 'phase';
  const phase = isPhase ? undefined : state?.phases.find((p) => p.id === adding.phase);

  const submit = async () => {
    const x = title.trim();
    if (!x || busy) return;
    setBusy(true);
    const ok = isPhase
      ? await act({ type: 'addPhase', t: x }, x)
      : await act({ type: 'addStep', phase: adding.phase, t: x, d: details.trim() || undefined, ok: approve }, x);
    setBusy(false);
    if (ok) close();
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.currentTarget.tagName === 'INPUT')) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={close}>
      <form
        className="w-[min(480px,100%)] overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow)]"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="plus" size={16} className="text-ok" />
          <span className="font-semibold">{isPhase ? t('act.addPhase') : t('add.task')}</span>
          {phase && (
            <span dir="auto" className="truncate text-[13px] text-muted">
              {t('add.in')} {phase.id} · {phase.t}
            </span>
          )}
          <button type="button" onClick={close} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-text" aria-label={t('act.close')}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">{isPhase ? t('add.phaseTitle') : t('add.title')}</span>
            <input
              autoFocus
              dir="auto"
              maxLength={isPhase ? 120 : 200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={onEnter}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[14px] outline-none focus:border-ok"
            />
          </label>
          {!isPhase && (
            <>
              <label className="block">
                <span className="mb-1 block text-[12px] text-muted">{t('add.details')}</span>
                <textarea
                  dir="auto"
                  rows={4}
                  maxLength={1000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  onKeyDown={onEnter}
                  className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-ok"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="size-4 accent-[var(--done)]" />
                {t('add.approve')}
              </label>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-panel2 hover:text-text">
            {t('act.cancel')}
          </button>
          <button type="submit" disabled={!title.trim() || busy} className="flex items-center gap-1.5 rounded-lg bg-done px-4 py-2 text-[13px] font-semibold text-[var(--bg)] transition hover:brightness-110 disabled:opacity-40">
            <Icon name="plus" size={14} />
            {isPhase ? t('add.phaseSubmit') : t('add.submit')}
          </button>
        </footer>
      </form>
    </div>
  );
}

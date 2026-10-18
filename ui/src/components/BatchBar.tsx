import { useBoard, useT } from '../store';
import { Icon } from './Icon';

/** Appears once steps are picked with "#": starts the open ones in the picked order, or archives them all. */
export function BatchBar() {
  const t = useT();
  const batch = useBoard((s) => s.batch);
  const act = useBoard((s) => s.act);
  const clear = useBoard((s) => s.clearBatch);
  const select = useBoard((s) => s.select);
  const state = useBoard((s) => s.state);
  if (!batch.length) return null;

  const startable = batch.filter((id) => ['todo', 'ok', 'block'].includes(state?.steps.find((x) => x.id === id)?.s ?? ''));
  const start = async () => {
    if (await act({ type: 'approveMany', ids: startable }, startable.join(' → '))) clear();
  };
  const archive = async () => {
    if (await act({ type: 'archive', ids: batch }, `${t('archive')} · ${batch.length}`)) clear();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4">
      <div className="toast pointer-events-auto flex max-w-[min(620px,100%)] flex-wrap items-center gap-2 rounded-2xl border border-ok bg-panel px-3 py-2.5 shadow-[var(--shadow)]">
        <ol className="flex flex-wrap items-center gap-1" dir="ltr">
          {batch.map((id, i) => (
            <li key={id} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted">→</span>}
              <button type="button" onClick={() => select(id)} className="flex items-center gap-1 rounded-md bg-ok/15 px-1.5 py-0.5 font-mono text-[12px] text-ok hover:bg-ok/25">
                <span className="grid size-4 place-items-center rounded-full bg-ok text-[10px] font-bold text-white">{i + 1}</span>
                {id}
              </button>
            </li>
          ))}
        </ol>
        {startable.length > 0 && <span className="hidden text-[11.5px] text-muted sm:inline">{t('batch.hint')}</span>}
        <span className="ms-auto flex items-center gap-1.5">
          {startable.length > 0 && (
            <button type="button" onClick={start} className="flex items-center gap-1.5 rounded-lg bg-done px-3 py-1.5 text-[13px] font-semibold text-[var(--bg)] hover:brightness-110">
              <Icon name="play" size={13} fill />
              {t('batch.start')} ({startable.length})
            </button>
          )}
          <button type="button" onClick={archive} className="flex items-center gap-1.5 rounded-lg bg-panel2 px-3 py-1.5 text-[13px] font-medium hover:bg-line">
            <Icon name="archive" size={13} />
            {t('archive.do')} ({batch.length})
          </button>
          <button type="button" onClick={clear} title={t('batch.clear')} aria-label={t('batch.clear')} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-text">
            <Icon name="x" size={15} />
          </button>
        </span>
      </div>
    </div>
  );
}

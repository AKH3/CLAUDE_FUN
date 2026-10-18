import type { Step } from '../../../src/core/schema';
import { STATUS_COLOR } from '../format';
import { useBoard, useT } from '../store';
import { Icon } from './Icon';

const day = (iso: string | undefined, lang: string) => (iso ? new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : '');

function RestoreBtn({ id }: { id: string }) {
  const t = useT();
  const act = useBoard((s) => s.act);
  return (
    <button
      type="button"
      onClick={() => act({ type: 'unarchive', ids: [id] }, `${t('archive.restore')} · ${id}`)}
      className="flex shrink-0 items-center gap-1 rounded-md bg-ok/12 px-2 py-1 text-[12px] font-medium text-ok hover:bg-ok/22"
    >
      <Icon name="retry" size={12} />
      {t('archive.restore')}
    </button>
  );
}

function StepRow({ st, restorable }: { st: Step; restorable: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-panel2">
      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[st.s] }} />
      <span className="font-mono text-[11px] text-muted" dir="ltr">
        {st.id}
      </span>
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {st.t}
      </span>
      {restorable && <RestoreBtn id={st.id} />}
    </li>
  );
}

/** Archived phases and tasks, with one-click restore. They stay in .claude-board/state.json. */
export function ArchivePanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const state = useBoard((s) => s.state)!;
  const lang = useBoard((s) => s.lang);
  const { phases, steps } = state.archive;
  const archivedPhase = new Set(phases.map((p) => p.id));
  // loose tasks: archived on their own while their phase stayed on the board
  const loose = steps.filter((x) => !archivedPhase.has(x.p));
  const looseByPhase = [...new Set(loose.map((x) => x.p))];
  const titleOf = (id: string) => state.phases.find((p) => p.id === id)?.t ?? id;
  // a sub-task archived alone (its parent is still on the board) gets its own restore button
  const topLevel = (list: Step[]) => list.filter((x) => !x.parent || !list.some((y) => y.id === x.parent));

  return (
    <aside className="scroll-thin absolute inset-y-0 start-0 z-20 flex w-[min(360px,100vw)] flex-col overflow-y-auto border-e border-line bg-panel shadow-[var(--shadow)]">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-panel px-4 py-3">
        <Icon name="archive" size={16} />
        <span className="font-semibold">{t('archive')}</span>
        <button type="button" onClick={onClose} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2" aria-label={t('act.close')}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted">
        {t('archive.where')}
        <code className="mt-1 block font-mono text-ok" dir="ltr">
          .claude-board/state.json
        </code>
      </p>

      {!phases.length && !loose.length && <p className="border-t border-line px-4 py-6 text-center text-[13px] text-muted">{t('archive.empty')}</p>}

      {phases.map((ph) => {
        const list = steps.filter((x) => x.p === ph.id);
        return (
          <section key={ph.id} className="border-t border-line px-3 py-3">
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <span className="rounded-md bg-panel2 px-1.5 py-0.5 font-mono text-[11px] font-bold" dir="ltr">
                {ph.id}
              </span>
              <span dir="auto" className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                {ph.t}
              </span>
              <RestoreBtn id={ph.id} />
            </div>
            <div className="mb-1 px-1 text-[11.5px] text-muted">
              {list.length} {t('archive.steps')} · {day(ph.arc, lang)}
            </div>
            <ul>
              {list.map((x) => (
                <li key={x.id} className="flex items-center gap-2 px-2 py-1 text-[12.5px] text-muted">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[x.s] }} />
                  <span className="font-mono text-[10.5px]" dir="ltr">
                    {x.id}
                  </span>
                  <span dir="auto" className="truncate">
                    {x.t}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {looseByPhase.map((pid) => {
        const list = loose.filter((x) => x.p === pid);
        const tops = new Set(topLevel(list).map((x) => x.id));
        return (
          <section key={pid} className="border-t border-line px-3 py-3">
            <div className="mb-1 px-1 text-[12px] text-muted" dir="auto">
              {t('archive.from')} {pid} · {titleOf(pid)}
            </div>
            <ul>
              {list.map((x) => (
                <StepRow key={x.id} st={x} restorable={tops.has(x.id)} />
              ))}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}

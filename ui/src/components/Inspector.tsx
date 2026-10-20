import { useEffect, useState, type ReactNode } from 'react';
import type { Phase, Step } from '../../../src/core/schema';
import { childrenOf, depsMet, hasChildren, runLine } from '../../../src/core/tree';
import { duration, kfmt, STATUS_COLOR, STATUS_ICON } from '../format';
import { useBoard, useT } from '../store';
import { Effort } from './Effort';
import { Icon, type IconName } from './Icon';

function Btn({
  icon,
  children,
  onClick,
  tone = 'muted',
  disabled,
}: {
  icon: IconName;
  children: ReactNode;
  onClick: () => void;
  tone?: 'done' | 'ok' | 'fail' | 'muted' | 'run';
  disabled?: boolean;
}) {
  const tones = {
    done: 'bg-done text-[var(--bg)] hover:brightness-110',
    ok: 'bg-ok/15 text-ok hover:bg-ok/25',
    run: 'bg-run/15 text-run hover:bg-run/25',
    fail: 'bg-fail/12 text-fail hover:bg-fail/22',
    muted: 'bg-panel2 text-text hover:bg-line',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition disabled:opacity-40 ${tones[tone]}`}
    >
      <Icon name={icon} size={14} />
      {children}
    </button>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      {title && <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h3>}
      {children}
    </section>
  );
}

function Composer({ placeholder, onSend, icon = 'send', multiline = true }: { placeholder: string; onSend: (v: string) => Promise<boolean>; icon?: IconName; multiline?: boolean }) {
  const [v, setV] = useState('');
  const t = useT();
  const send = async () => {
    const x = v.trim();
    if (x && (await onSend(x))) setV('');
  };
  const common = {
    value: v,
    dir: 'auto' as const,
    placeholder,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    },
    className: 'w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-muted focus:border-ok',
  };
  return (
    <div className="flex items-end gap-2">
      {multiline ? <textarea rows={2} {...common} /> : <input {...common} />}
      <button
        type="button"
        onClick={send}
        disabled={!v.trim()}
        title={t('act.send')}
        aria-label={t('act.send')}
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-ok text-white transition disabled:opacity-30"
      >
        <Icon name={icon} size={15} />
      </button>
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: IconName; label: string; value: ReactNode; color?: string }) {
  return (
    <div className="rounded-lg bg-bg px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10.5px] text-muted">
        <Icon name={icon} size={11} />
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold" style={{ color }} dir="ltr">
        {value}
      </div>
    </div>
  );
}

function StepPanel({ st }: { st: Step }) {
  const t = useT();
  const state = useBoard((s) => s.state)!;
  const usage = useBoard((s) => s.usage);
  const git = useBoard((s) => s.git);
  const act = useBoard((s) => s.act);
  const select = useBoard((s) => s.select);
  const openDiff = useBoard((s) => s.openDiff);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(st.t);
  useEffect(() => {
    setTitle(st.t);
    setEditing(false);
  }, [st.id, st.t]);

  const container = hasChildren(state, st.id);
  const locked = (st.s === 'todo' || st.s === 'ok') && !depsMet(state, st);
  const phase = state.phases.find((p) => p.id === st.p);
  const kids = childrenOf(state, st.id);
  const tokens = usage?.steps[st.id] ?? 0;
  const status = locked ? 'locked' : st.s;
  const place = runLine(state).findIndex((x) => x.id === st.id) + 1;

  return (
    <>
      <div className="px-4 pt-1 pb-3">
        <div className="mb-1 text-[12px] text-muted" dir="auto">
          {phase?.id} · {phase?.t}
        </div>
        {editing ? (
          <div className="flex gap-2">
            <input
              autoFocus
              dir="auto"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && title.trim()) {
                  if (await act({ type: 'edit', id: st.id, t: title.trim() }, `${st.id}`)) setEditing(false);
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              className="flex-1 rounded-lg border border-ok bg-bg px-2 py-1.5 text-[15px] outline-none"
            />
          </div>
        ) : (
          <h2 dir="auto" className="cursor-text text-[17px] leading-snug font-semibold" onDoubleClick={() => setEditing(true)} title="✎">
            {st.t}
          </h2>
        )}
        {st.d && (
          <p dir="auto" className="mt-1.5 text-[13px] text-muted">
            {st.d}
          </p>
        )}
        {st.deps.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-muted">{t('deps')}:</span>
            {st.deps.map((d) => {
              const dep = state.steps.find((x) => x.id === d);
              return (
                <button key={d} type="button" onClick={() => select(d)} className="rounded-md border px-1.5 py-0.5 font-mono" style={{ borderColor: dep ? STATUS_COLOR[dep.s] : 'var(--line)' }} dir="ltr">
                  {d}
                </button>
              );
            })}
          </div>
        )}
        {place > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-run">
            <Icon name="list" size={12} />
            <span className="font-semibold">{place === 1 ? t('line.next') : `${t('line.place')} ${place}`}</span>
            <span className="text-muted">· {t('line.hint')}</span>
          </div>
        )}
        {st.by === 'user' && <div className="mt-2 text-[12px] text-gold">★ {t('by.user')}</div>}
        {st.e && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px]">
            <span className="text-muted">{t('effort')}:</span>
            <Effort e={st.e} label />
          </div>
        )}
      </div>

      <AskSection st={st} />

      <Section>
        <div className="grid grid-cols-2 gap-2">
          {(st.s === 'todo' || st.s === 'block') && (
            <Btn icon="play" tone="done" onClick={() => act({ type: 'approve', id: st.id }, st.id)}>
              {t('act.approve')}
            </Btn>
          )}
          {st.s === 'ok' && (
            <Btn icon="pause" onClick={() => act({ type: 'hold', id: st.id }, `${t('act.hold')} · ${st.id}`)}>
              {t('act.hold')}
            </Btn>
          )}
          {!container && !['done', 'skip'].includes(st.s) && (
            <Btn icon="scissors" tone="ok" onClick={() => act({ type: 'split', id: st.id }, `split ${st.id}`)}>
              {t('act.split')}
            </Btn>
          )}
          {['done', 'fail', 'skip', 'block'].includes(st.s) && (
            <Btn icon="retry" tone="run" onClick={() => act({ type: 'retry', id: st.id }, `retry ${st.id}`)}>
              {t('act.retry')}
            </Btn>
          )}
          {!['done', 'skip'].includes(st.s) && (
            <Btn icon="x" tone="fail" onClick={() => act({ type: 'reject', id: st.id }, `skip ${st.id}`)}>
              {t('act.reject')}
            </Btn>
          )}
          {git && st.base && (
            <Btn icon="diff" onClick={() => openDiff(st.id)}>
              {t('act.diff')}
            </Btn>
          )}
          {st.s !== 'run' && (
            <Btn icon="archive" onClick={async () => (await act({ type: 'archive', ids: [st.id] }, `${t('archive')} · ${st.id}`)) && select(undefined)}>
              {t('archive.do')}
            </Btn>
          )}
        </div>
        {locked && (
          <p className="mt-2 flex items-center gap-1 text-[12px] text-muted">
            <Icon name="lock" size={12} /> {t('status.locked')}
          </p>
        )}
      </Section>

      <Section>
        {st.r || st.at.run || tokens ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat icon="file" label={t('cap.files')} value={st.r?.f ?? '–'} />
              <Stat
                icon="diff"
                label="+ / −"
                value={
                  st.r?.ins !== undefined ? (
                    <>
                      <span className="text-done">+{st.r.ins}</span> <span className="text-fail">−{st.r.del ?? 0}</span>
                    </>
                  ) : (
                    '–'
                  )
                }
              />
              <Stat
                icon="check"
                label={t('cap.tests')}
                value={st.r?.t ? t(`tests.${st.r.t}` as const) : '–'}
                color={st.r?.t === 'pass' ? 'var(--done)' : st.r?.t === 'fail' ? 'var(--fail)' : undefined}
              />
              <Stat icon="bolt" label={t('cap.tokens')} value={tokens ? kfmt(tokens) : '–'} />
              <Stat icon="pulse" label={t('cap.time')} value={duration(st.at.run, st.at.end) ?? '–'} />
              <Stat
                icon={STATUS_ICON[status]}
                label={st.id}
                value={<span className="font-sans text-[12.5px]" style={{ color: STATUS_COLOR[status] }}>{t(`status.${status}` as const)}</span>}
              />
            </div>
            {st.r?.files?.length ? (
              <ul className="scroll-thin mt-2 max-h-32 space-y-0.5 overflow-auto text-[12px]" dir="ltr">
                {st.r.files.map((f) => (
                  <li key={f}>
                    <button type="button" className="w-full truncate rounded px-1.5 py-0.5 text-start font-mono text-muted hover:bg-panel2 hover:text-text" onClick={() => openDiff(st.id, f)}>
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-muted">{t('cap.none')}</p>
        )}
      </Section>

      {(st.n || st.un) && (
        <Section>
          {st.n && (
            <div className="mb-2 rounded-lg bg-run/10 px-3 py-2 text-[13px]">
              <div className="mb-0.5 text-[11px] text-run">{t('note.claude')}</div>
              <div dir="auto">{st.n}</div>
            </div>
          )}
          {st.un && (
            <div className="rounded-lg bg-ok/10 px-3 py-2 text-[13px]">
              <div className="mb-0.5 text-[11px] text-ok">{t('note.you')}</div>
              <div dir="auto">{st.un}</div>
            </div>
          )}
        </Section>
      )}

      {kids.length > 0 && (
        <Section title={t('phase.steps')}>
          <StepList steps={kids} />
        </Section>
      )}

      <Section title={t('note.you')}>
        <Composer placeholder={t('note.placeholder')} onSend={(x) => act({ type: 'note', id: st.id, x }, `${st.id} note`)} />
        {!['done', 'skip'].includes(st.s) && (
          <div className="mt-2">
            <Composer
              multiline={false}
              icon="plus"
              placeholder={t('act.addSub')}
              onSend={(x) => act({ type: 'addStep', parent: st.id, t: x }, `+ ${st.id}`)}
            />
          </div>
        )}
      </Section>
    </>
  );
}

function AskSection({ st }: { st: Step }) {
  const t = useT();
  const act = useBoard((s) => s.act);
  const live = useBoard((s) => s.live());
  const ask = () => act({ type: 'ask', id: st.id }, st.id);
  // honest about when the answer comes: in seconds if Claude can be reached, else once it is
  const pending = t(live ? 'ask.pending' : 'ask.later');
  return (
    <Section>
      {st.a ? (
        <div className="rounded-lg bg-ok/10 px-3 py-2 text-[13px]">
          <div className="mb-1 flex items-center gap-1 text-[11px] text-ok">
            <Icon name="help" size={12} />
            {t('ask.title')}
            {!st.ask && (
              <button type="button" onClick={ask} className="ms-auto rounded px-1 text-muted hover:text-text">
                {t('ask.again')}
              </button>
            )}
          </div>
          <div dir="auto" className="leading-relaxed">
            {st.a}
          </div>
          {st.ask && <div className="mt-1.5 animate-pulse text-[11.5px] text-todo">{pending}</div>}
        </div>
      ) : st.ask ? (
        <div className="flex items-center gap-2 rounded-lg bg-todo/10 px-3 py-2.5 text-[13px] text-todo">
          <Icon name="help" size={15} className="animate-pulse" />
          {pending}
        </div>
      ) : (
        <button
          type="button"
          onClick={ask}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-start text-[13px] text-muted transition hover:border-ok hover:text-text"
        >
          <Icon name="help" size={15} className="text-ok" />
          {t('ask.cta')}
        </button>
      )}
    </Section>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  const select = useBoard((s) => s.select);
  return (
    <ul className="space-y-1">
      {steps.map((x) => (
        <li key={x.id}>
          <button type="button" onClick={() => select(x.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] hover:bg-panel2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[x.s] }} />
            <span className="font-mono text-[11px] text-muted" dir="ltr">
              {x.id}
            </span>
            <span dir="auto" className="truncate">
              {x.t}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PhasePanel({ ph }: { ph: Phase }) {
  const t = useT();
  const state = useBoard((s) => s.state)!;
  const usage = useBoard((s) => s.usage);
  const act = useBoard((s) => s.act);
  const select = useBoard((s) => s.select);
  const top = childrenOf(state, null, ph.id);
  const leaves = state.steps.filter((x) => x.p === ph.id && !hasChildren(state, x.id) && x.s !== 'skip');
  const done = leaves.filter((x) => x.s === 'done').length;
  const todo = leaves.filter((x) => x.s === 'todo').length;
  const tokens = usage?.phases[ph.id] ?? 0;
  return (
    <>
      <div className="px-4 pt-1 pb-3">
        <h2 dir="auto" className="text-[17px] font-semibold">
          {ph.t}
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat icon="check" label={t('progress')} value={`${done}/${leaves.length}`} color="var(--done)" />
          <Stat icon="pause" label={t('status.todo')} value={todo} color={todo ? 'var(--todo)' : undefined} />
          <Stat icon="bolt" label={t('cap.tokens')} value={tokens ? kfmt(tokens) : '–'} />
        </div>
      </div>
      {todo > 0 && (
        <Section>
          <Btn icon="play" tone="done" onClick={() => act({ type: 'approvePhase', id: ph.id }, ph.id)}>
            {t('act.approvePhase')} ({todo})
          </Btn>
        </Section>
      )}
      <Section title={t('phase.steps')}>
        <StepList steps={top} />
        <p className="mt-2 text-[11.5px] text-muted">{t('reorder.hint')}</p>
      </Section>
      <Section>
        <Composer multiline={false} icon="plus" placeholder={t('act.addStep')} onSend={(x) => act({ type: 'addStep', phase: ph.id, t: x }, `+ ${ph.id}`)} />
      </Section>
      <Section>
        <Btn icon="archive" disabled={leaves.some((x) => x.s === 'run')} onClick={async () => (await act({ type: 'archive', ids: [ph.id] }, `${t('archive')} · ${ph.id}`)) && select(undefined)}>
          {t('archive.phase')}
        </Btn>
      </Section>
    </>
  );
}

export function Inspector() {
  const t = useT();
  const state = useBoard((s) => s.state);
  const selected = useBoard((s) => s.selected);
  const select = useBoard((s) => s.select);

  useEffect(() => {
    // Esc closes the diff first, then the inspector
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !useBoard.getState().diff && !useBoard.getState().adding && select(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  if (!state || !selected) return null;
  const st = state.steps.find((x) => x.id === selected);
  const ph = state.phases.find((x) => x.id === selected);
  if (!st && !ph) return null;
  const color = st ? STATUS_COLOR[st.s] : 'var(--line)';

  return (
    <aside className="scroll-thin absolute inset-y-0 end-0 z-20 flex w-[min(400px,100vw)] flex-col overflow-y-auto border-s border-line bg-panel shadow-[var(--shadow)]">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-panel px-4 py-3">
        <span className="rounded-md px-2 py-0.5 font-mono text-[12px] font-bold" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }} dir="ltr">
          {selected}
        </span>
        {st && <span className="text-[12px]" style={{ color }}>{t(`status.${st.s}` as const)}</span>}
        <button type="button" onClick={() => select(undefined)} className="ms-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-text" aria-label={t('act.close')}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {st ? <StepPanel st={st} /> : <PhasePanel ph={ph!} />}
    </aside>
  );
}

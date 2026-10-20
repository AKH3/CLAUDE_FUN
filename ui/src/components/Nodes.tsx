import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { Step } from '../../../src/core/schema';
import { duration, kfmt, PHASE_PALETTE, STATUS_COLOR, STATUS_ICON } from '../format';
import type { AddNodeT, AddPhaseNodeT, LaneNodeT, PhaseNodeT, StepNodeT } from '../layout';
import { useBoard, useT } from '../store';
import { Effort } from './Effort';
import { Icon } from './Icon';

const sides = (rtl: boolean) => ({ lead: rtl ? Position.Right : Position.Left, trail: rtl ? Position.Left : Position.Right });

/** Adds a class for a moment when `trigger` flips to true (status transitions). */
function useFlash(trigger: boolean, ms = 900) {
  const prev = useRef(trigger);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (trigger && !prev.current) {
      setOn(true);
      const t = setTimeout(() => setOn(false), ms);
      prev.current = trigger;
      return () => clearTimeout(t);
    }
    prev.current = trigger;
  }, [trigger, ms]);
  return on;
}

function MiniBtn({ icon, label, onClick, color }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; color: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="nodrag grid size-6 place-items-center rounded-md border border-line bg-panel2 text-muted transition hover:scale-110 hover:text-text"
      style={{ ['--c' as string]: color }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

/**
 * "?" on a card. Claude writes the explanation when it plans, so it opens at
 * once (and shows on hover); older steps ask Claude, which the board wakes.
 */
function AskBtn({ st }: { st: Step }) {
  const t = useT();
  const act = useBoard((s) => s.act);
  const select = useBoard((s) => s.select);
  const tone = st.a ? 'text-ok' : st.ask ? 'animate-pulse text-todo' : 'text-muted hover:text-text';
  return (
    <button
      type="button"
      title={st.a ?? t('act.ask')}
      aria-label={t('act.ask')}
      className={`nodrag grid size-5 place-items-center rounded-full transition hover:scale-110 ${tone}`}
      onClick={(e) => {
        e.stopPropagation();
        select(st.id);
        if (!st.a && !st.ask) act({ type: 'ask', id: st.id });
      }}
    >
      <Icon name="help" size={15} />
    </button>
  );
}

/** Picks a step for a batch start; shows its position in the batch once picked. */
function PickBtn({ id, n }: { id: string; n: number }) {
  const t = useT();
  const toggle = useBoard((s) => s.toggleBatch);
  return (
    <button
      type="button"
      title={t('batch.pick')}
      aria-label={t('batch.pick')}
      aria-pressed={n > 0}
      className={`nodrag grid size-6 place-items-center rounded-full border font-mono text-[11px] font-bold transition hover:scale-110 ${
        n ? 'border-ok bg-ok text-white' : 'border-dashed border-muted text-muted hover:text-text'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        toggle(id);
      }}
    >
      {n || '#'}
    </button>
  );
}

export const StepNode = memo(function StepNode({ data, selected }: NodeProps<StepNodeT>) {
  const { step: st, locked, container, kids, kidsDone, tokens, rtl } = data;
  const t = useT();
  const act = useBoard((s) => s.act);
  const status = locked ? 'locked' : st.s;
  const color = STATUS_COLOR[status];
  const lit = useFlash(st.s === 'done');
  const pick = useBoard((s) => s.batch.indexOf(st.id)) + 1;
  const pickable = !container && st.s !== 'run';
  const pickBtn = pickable ? <PickBtn id={st.id} n={pick} /> : null;
  const { lead, trail } = sides(rtl);
  const cls = [
    'relative flex h-full flex-col rounded-xl border border-s-4 bg-panel px-3 py-2 shadow-[var(--shadow)] transition-[opacity,transform]',
    st.s === 'todo' && !locked ? 'node-todo' : '',
    st.s === 'run' ? 'node-run' : '',
    lit ? 'node-lit' : '',
    locked || st.s === 'skip' ? 'opacity-55' : '',
    selected ? 'ring-2 ring-offset-0' : '',
    pick ? 'outline-2 outline-offset-2 outline-ok' : '',
  ].join(' ');

  return (
    <div className={cls} style={{ borderColor: color, ['--tw-ring-color' as string]: color }}>
      <Handle type="target" id="lead" position={lead} />
      <Handle type="target" id="trail-in" position={trail} />
      <Handle type="source" id="trail-out" position={trail} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={rtl ? { left: 'auto', right: 14 } : { left: 14 }} />

      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="grid size-4 place-items-center rounded-full" style={{ background: color, color: 'var(--bg)' }}>
          <Icon name={STATUS_ICON[status]} size={10} />
        </span>
        <span className="font-mono" dir="ltr">
          {st.id}
        </span>
        {st.by === 'user' && <Icon name="star" size={11} fill className="text-gold" />}
        {st.un && <Icon name="note" size={12} className="text-ok" />}
        {st.e && <Effort e={st.e} />}
        <span className="ms-auto flex items-center gap-1">
          {tokens > 0 && (
            <span className="flex items-center gap-0.5 font-mono" dir="ltr" title={t('cap.tokens')}>
              <Icon name="bolt" size={11} />
              {kfmt(tokens)}
            </span>
          )}
          <AskBtn st={st} />
        </span>
      </div>

      <div dir="auto" className={`mt-1 line-clamp-2 text-[13px] leading-snug font-medium ${st.s === 'skip' ? 'line-through' : ''}`}>
        {st.t}
      </div>

      <div className="mt-auto flex items-center gap-1.5 text-[11px]">
        {container ? (
          <>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
              <div className="h-full rounded-full bg-done transition-all" style={{ width: `${(kidsDone / Math.max(kids, 1)) * 100}%` }} />
            </div>
            <span className="font-mono text-muted" dir="ltr">
              {kidsDone}/{kids}
            </span>
          </>
        ) : st.s === 'todo' && !locked ? (
          <>
            <span className="truncate text-todo">{t('status.todo')}</span>
            <span className="ms-auto flex shrink-0 items-center gap-1">
              {pickBtn}
              <button
                type="button"
                title={t('act.approve')}
                className="nodrag flex items-center gap-1 rounded-md bg-done px-2 py-0.5 text-[12px] font-semibold text-[var(--bg)] transition hover:brightness-110"
                onClick={(e) => {
                  e.stopPropagation();
                  act({ type: 'approve', id: st.id }, st.id);
                }}
              >
                <Icon name="play" size={10} fill />
                {t('act.start')}
              </button>
            </span>
          </>
        ) : st.s === 'run' ? (
          <>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-panel2">
              <div className="run-bar h-full w-full" />
            </div>
            <span className="text-run">{t('status.run')}</span>
          </>
        ) : st.s === 'done' || st.s === 'fail' ? (
          <span className="flex w-full items-center gap-2 text-muted" dir="ltr">
            {st.r?.f !== undefined && (
              <span className="flex items-center gap-0.5">
                <Icon name="file" size={11} />
                {st.r.f}
              </span>
            )}
            {st.r?.ins !== undefined && (
              <span className="font-mono">
                <span className="text-done">+{st.r.ins}</span> <span className="text-fail">−{st.r.del ?? 0}</span>
              </span>
            )}
            {st.r?.t && st.r.t !== 'none' && (
              <span className={`rounded px-1 ${st.r.t === 'pass' ? 'bg-done/15 text-done' : 'bg-fail/15 text-fail'}`}>
                {st.r.t === 'pass' ? '✓ tests' : '✗ tests'}
              </span>
            )}
            <span className="ms-auto">{duration(st.at.run, st.at.end)}</span>
            {pickBtn}
          </span>
        ) : locked ? (
          <>
            <span className="flex items-center gap-1 text-muted">
              <Icon name="lock" size={11} />
              <span dir="ltr">{st.deps.join(', ')}</span>
            </span>
            <span className="ms-auto">{pickBtn}</span>
          </>
        ) : (
          <>
            <span style={{ color }}>{t(`status.${st.s}` as const)}</span>
            <span className="ms-auto">{pickBtn}</span>
          </>
        )}
      </div>
    </div>
  );
});

export const PhaseNode = memo(function PhaseNode({ data }: NodeProps<PhaseNodeT>) {
  const { phase, index, done, total, todo, complete, running, tokens, rtl, collapsed } = data;
  const t = useT();
  const act = useBoard((s) => s.act);
  const select = useBoard((s) => s.select);
  const toggle = useBoard((s) => s.toggleCollapsed);
  const burst = useFlash(complete, 1200);
  const { lead, trail } = sides(rtl);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const accent = PHASE_PALETTE[index % PHASE_PALETTE.length];

  return (
    <div
      className={`relative flex h-full flex-col rounded-2xl border-2 bg-panel2 px-3.5 py-2.5 shadow-[var(--shadow)] ${burst ? 'burst' : ''}`}
      style={{ borderColor: complete ? 'var(--gold)' : running ? 'var(--run)' : 'var(--line)' }}
    >
      <Handle type="target" id="in" position={lead} />
      <Handle type="source" id="out" position={trail} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          title={collapsed ? t('phase.expand') : t('phase.collapse')}
          aria-label={collapsed ? t('phase.expand') : t('phase.collapse')}
          className="nodrag -ms-1 grid size-6 shrink-0 place-items-center rounded-md text-muted transition hover:bg-bg hover:text-text"
          onClick={(e) => {
            e.stopPropagation();
            toggle(phase.id);
          }}
        >
          <Icon name="chevron" size={15} className={`transition-transform ${collapsed ? (rtl ? 'rotate-180' : '') : 'rotate-90'}`} />
        </button>
        <span className="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold text-white" style={{ background: accent }} dir="ltr">
          {phase.id}
        </span>
        <span dir="auto" className="truncate text-[15px] font-semibold">
          {phase.t}
        </span>
        {complete && <Icon name="star" size={16} fill className="ms-auto shrink-0 text-gold" />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: complete ? 'var(--gold)' : `linear-gradient(90deg, ${accent}, var(--done))` }}
          />
        </div>
        <span className="font-mono text-[11px] text-muted" dir="ltr">
          {done}/{total}
        </span>
      </div>
      <div className="mt-auto flex items-center gap-2 text-[11px] text-muted">
        {tokens > 0 && (
          <span className="flex items-center gap-0.5 font-mono" dir="ltr">
            <Icon name="bolt" size={11} />
            {kfmt(tokens)}
          </span>
        )}
        {complete ? (
          <span className="text-gold">{t('phase.complete')}</span>
        ) : todo > 0 ? (
          <button
            type="button"
            className="nodrag ms-auto flex items-center gap-1 rounded-md bg-done/15 px-2 py-0.5 font-medium text-done transition hover:bg-done/25"
            onClick={(e) => {
              e.stopPropagation();
              act({ type: 'approvePhase', id: phase.id }, phase.id);
            }}
          >
            <Icon name="check" size={12} />
            {t('act.approvePhase')} ({todo})
          </button>
        ) : (
          <span>
            {total} {t('phase.steps')}
          </span>
        )}
        <span className={`flex gap-1 ${todo > 0 && !complete ? '' : 'ms-auto'}`}>
          {complete && <MiniBtn icon="archive" label={t('archive.phase')} color="var(--gold)" onClick={() => act({ type: 'archive', ids: [phase.id] }, `${t('archive')} · ${phase.id}`)} />}
          <MiniBtn icon="info" label={t('phase.details')} color="var(--ok)" onClick={() => select(phase.id)} />
        </span>
      </div>
    </div>
  );
});

export const LaneNode = memo(function LaneNode({ data }: NodeProps<LaneNodeT>) {
  return (
    <div
      className="h-full w-full rounded-[22px] border border-dashed"
      style={{
        borderColor: data.complete ? 'color-mix(in srgb, var(--gold) 45%, transparent)' : 'var(--line)',
        background: data.active
          ? 'color-mix(in srgb, var(--run) 7%, transparent)'
          : data.complete
            ? 'color-mix(in srgb, var(--gold) 5%, transparent)'
            : 'color-mix(in srgb, var(--panel) 35%, transparent)',
      }}
    />
  );
});

const addCls =
  'nodrag flex h-full w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[13px] text-muted transition hover:border-ok hover:bg-ok/5 hover:text-ok';

/** "+ new task" box at the bottom of a phase column. */
export const AddNode = memo(function AddNode({ data }: NodeProps<AddNodeT>) {
  const t = useT();
  const openAdd = useBoard((s) => s.openAdd);
  return (
    <button type="button" className={addCls} onClick={() => openAdd({ phase: data.phase })}>
      <Icon name="plus" size={15} />
      {t('add.task')}
    </button>
  );
});

/** "+ new phase" column after the last phase. */
export const AddPhaseNode = memo(function AddPhaseNode(_: NodeProps<AddPhaseNodeT>) {
  const t = useT();
  const openAdd = useBoard((s) => s.openAdd);
  return (
    <button type="button" className={`${addCls} rounded-2xl text-[14px]`} onClick={() => openAdd('phase')}>
      <Icon name="plus" size={17} />
      {t('act.addPhase')}
    </button>
  );
});

export const nodeTypes = { step: StepNode, phase: PhaseNode, lane: LaneNode, add: AddNode, addPhase: AddPhaseNode };

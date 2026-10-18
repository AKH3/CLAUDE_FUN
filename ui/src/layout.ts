// Deterministic skill-tree layout: one column per phase (mirrored for RTL),
// steps stacked under their phase, substeps indented, deps as cross links.
import type { Edge, Node } from '@xyflow/react';
import type { Phase, State, Step, Usage } from '../../src/core/schema';
import { childrenOf, depsMet, descendants, hasChildren, phaseComplete, phasesSorted } from '../../src/core/tree';

export const COL_W = 312;
export const PHASE_W = 268;
export const PHASE_H = 104;
export const STEP_W = 252;
export const STEP_H = 96;
export const GAP = 14;
export const INDENT = 22;
export const TOP = PHASE_H + 30;

export interface StepData extends Record<string, unknown> {
  step: Step;
  depth: number;
  locked: boolean;
  container: boolean;
  kids: number;
  kidsDone: number;
  tokens: number;
  rtl: boolean;
}

export interface PhaseData extends Record<string, unknown> {
  phase: Phase;
  index: number;
  done: number;
  total: number;
  todo: number;
  running: boolean;
  complete: boolean;
  tokens: number;
  rtl: boolean;
}

export interface LaneData extends Record<string, unknown> {
  complete: boolean;
  active: boolean;
}

export type StepNodeT = Node<StepData, 'step'>;
export type PhaseNodeT = Node<PhaseData, 'phase'>;
export type LaneNodeT = Node<LaneData, 'lane'>;
export type BoardNode = StepNodeT | PhaseNodeT | LaneNodeT;

const leafOf = (s: State, st: Step) => (hasChildren(s, st.id) ? descendants(s, st.id).filter((x) => !hasChildren(s, x.id)) : [st]);

export function layout(s: State, usage: Usage | undefined, rtl: boolean) {
  const nodes: BoardNode[] = [];
  const edges: Edge[] = [];
  const phases = phasesSorted(s);
  const n = phases.length;
  const stepTokens = (st: Step) => leafOf(s, st).reduce((a, x) => a + (usage?.steps[x.id] ?? 0), 0);
  const isRunning = (st: Step) => st.s === 'run';

  phases.forEach((ph, i) => {
    const x = (rtl ? n - 1 - i : i) * COL_W;
    const leaves = s.steps.filter((st) => st.p === ph.id && !hasChildren(s, st.id) && st.s !== 'skip');
    const complete = phaseComplete(s, ph.id);
    const running = leaves.some(isRunning);

    nodes.push({
      id: ph.id,
      type: 'phase',
      position: { x, y: 0 },
      width: PHASE_W,
      height: PHASE_H,
      draggable: false,
      data: {
        phase: ph,
        index: i,
        done: leaves.filter((x) => x.s === 'done').length,
        total: leaves.length,
        todo: leaves.filter((x) => x.s === 'todo').length,
        running,
        complete,
        tokens: usage?.phases[ph.id] ?? 0,
        rtl,
      },
    });

    let y = TOP;
    const walk = (list: Step[], depth: number) => {
      for (const st of list) {
        const w = STEP_W - depth * INDENT;
        const sx = x + (PHASE_W - STEP_W) / 2 + (rtl ? 0 : depth * INDENT);
        const kids = descendants(s, st.id).filter((k) => !hasChildren(s, k.id));
        nodes.push({
          id: st.id,
          type: 'step',
          position: { x: sx, y },
          width: w,
          height: STEP_H,
          data: {
            step: st,
            depth,
            locked: (st.s === 'todo' || st.s === 'ok') && !depsMet(s, st),
            container: kids.length > 0,
            kids: kids.length,
            kidsDone: kids.filter((k) => k.s === 'done').length,
            tokens: stepTokens(st),
            rtl,
          },
        });
        y += STEP_H + GAP;
        const children = childrenOf(s, st.id);
        for (const c of children) {
          edges.push({
            id: `k-${st.id}-${c.id}`,
            source: st.id,
            sourceHandle: 'bottom',
            target: c.id,
            targetHandle: 'lead',
            type: 'smoothstep',
            className: isRunning(c) ? 'edge-flow' : undefined,
            style: { stroke: c.s === 'done' ? 'var(--done)' : c.s === 'run' ? 'var(--run)' : 'var(--line)', strokeWidth: 2 },
          });
        }
        walk(children, depth + 1);
      }
    };
    walk(childrenOf(s, null, ph.id), 0);

    nodes.unshift({
      id: `lane-${ph.id}`,
      type: 'lane',
      position: { x: x - 12, y: -12 },
      width: PHASE_W + 24,
      height: Math.max(y, TOP + STEP_H) - GAP + 26,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      data: { complete, active: running },
    });

    if (i > 0) {
      const prev = phases[i - 1];
      const prevDone = phaseComplete(s, prev.id);
      edges.push({
        id: `p-${prev.id}-${ph.id}`,
        source: prev.id,
        sourceHandle: 'out',
        target: ph.id,
        targetHandle: 'in',
        type: 'smoothstep',
        className: running ? 'edge-flow' : undefined,
        style: { stroke: prevDone ? 'var(--gold)' : 'var(--line)', strokeWidth: prevDone ? 3 : 2 },
      });
    }
  });

  for (const st of s.steps) {
    for (const d of st.deps) {
      const dep = s.steps.find((x) => x.id === d);
      if (!dep) continue;
      const same = dep.p === st.p;
      const met = dep.s === 'done' || dep.s === 'skip';
      edges.push({
        id: `d-${d}-${st.id}`,
        source: d,
        sourceHandle: 'trail-out',
        target: st.id,
        targetHandle: same ? 'trail-in' : 'lead',
        type: 'default',
        className: st.s === 'run' ? 'edge-flow' : undefined,
        style: {
          stroke: met ? 'var(--done)' : 'var(--muted)',
          strokeWidth: 1.6,
          strokeDasharray: met ? undefined : '5 5',
          opacity: met ? 0.8 : 0.6,
        },
      });
    }
  }

  return { nodes, edges };
}

/** New sibling index for a step dropped at `y` (used for drag-to-reprioritise). */
export function dropIndex(s: State, id: string, y: number, positions: Map<string, number>): number {
  const st = s.steps.find((x) => x.id === id)!;
  const sibs = st.parent ? childrenOf(s, st.parent) : childrenOf(s, null, st.p);
  const others = sibs.filter((x) => x.id !== id);
  return others.filter((x) => (positions.get(x.id) ?? 0) < y).length;
}

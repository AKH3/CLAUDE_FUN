// Pure read-only helpers over the step tree. No runtime imports, so the
// browser bundle can share them without pulling in zod.
import type { State, Step, StepStatus } from './schema.js';

export const findStep = (s: State, id: string) => s.steps.find((x) => x.id === id);
export const findPhase = (s: State, id: string) => s.phases.find((x) => x.id === id);

export const num = (id: string) => {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};

export function phaseNum(s: State, phaseId: string): number {
  const m = /^P(\d+)$/.exec(phaseId);
  if (m) return Number(m[1]);
  return s.phases.findIndex((p) => p.id === phaseId) + 1;
}

export function phasesSorted(s: State) {
  return [...s.phases].sort((a, b) => a.o - b.o);
}

export function childrenOf(s: State, parent: string | null, phase?: string): Step[] {
  return s.steps
    .filter((x) => x.parent === parent && (parent !== null || x.p === phase))
    .sort((a, b) => a.o - b.o);
}

export const hasChildren = (s: State, id: string) => s.steps.some((x) => x.parent === id);

export function descendants(s: State, id: string): Step[] {
  const out: Step[] = [];
  const walk = (pid: string) => {
    for (const c of s.steps.filter((x) => x.parent === pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** Steps in work order: phase order, then sibling order, depth-first. */
export function ordered(s: State): Step[] {
  const out: Step[] = [];
  const walk = (list: Step[]) => {
    for (const st of list) {
      out.push(st);
      walk(childrenOf(s, st.id));
    }
  };
  for (const p of phasesSorted(s)) walk(childrenOf(s, null, p.id));
  return out;
}

export const leaves = (s: State) => ordered(s).filter((x) => !hasChildren(s, x.id));

export const FINISHED: StepStatus[] = ['done', 'skip'];

/** The user's run order: approved steps with a place in line, first to last. */
export function runLine(s: State): Step[] {
  return leaves(s)
    .filter((x) => x.s === 'ok' && x.q !== undefined)
    .sort((a, b) => a.q! - b.q!);
}

/** Next approved step whose deps are met: the user's line first, then plan order. */
export function nextStep(s: State): Step | undefined {
  const ready = leaves(s).filter((x) => x.s === 'ok' && depsMet(s, x));
  return runLine(s).find((x) => ready.includes(x)) ?? ready[0];
}

export function depsMet(s: State, st: Step): boolean {
  return st.deps.every((d) => {
    const dep = findStep(s, d);
    return !dep || FINISHED.includes(dep.s);
  });
}

export function unmetDeps(s: State, st: Step): string[] {
  return st.deps.filter((d) => {
    const dep = findStep(s, d);
    return dep && !FINISHED.includes(dep.s);
  });
}

export function phaseComplete(s: State, phaseId: string) {
  const ls = s.steps.filter((x) => x.p === phaseId && !hasChildren(s, x.id));
  return ls.length > 0 && ls.every((x) => FINISHED.includes(x.s));
}

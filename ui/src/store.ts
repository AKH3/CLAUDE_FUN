import { create } from 'zustand';
import type { Action, ClaudeStatus, State, Usage } from '../../src/core/schema';
import { translate, type I18nKey, type Lang } from './i18n';

export type Theme = 'dark' | 'light';

export interface Toast {
  id: number;
  kind: 'done' | 'fail' | 'phase' | 'plan' | 'sent' | 'later' | 'error';
  text: string;
}

interface BoardStore {
  state?: State;
  usage?: Usage;
  git: boolean;
  connected: boolean;
  /** Whether a click can reach Claude right now. */
  claude: ClaudeStatus;
  problem?: string;
  selected?: string;
  diff?: { id: string; file?: string };
  lang: Lang;
  theme: Theme;
  toasts: Toast[];
  /** Steps picked for a batch start, in the order the user picked them. */
  batch: string[];
  /** Collapsed phases, keyed by `project|phaseId` so boards don't share them. */
  collapsed: Record<string, boolean>;
  /** Open "new task / new phase" dialog: a phase id for a task, or 'phase' for a new phase. */
  adding?: { phase: string } | 'phase';
  setState: (s: State) => void;
  setUsage: (u: Usage) => void;
  setConnected: (v: boolean) => void;
  setClaude: (c: ClaudeStatus) => void;
  /** True when a click reaches Claude within seconds. */
  live: () => boolean;
  setProblem: (p?: string) => void;
  setGit: (v: boolean) => void;
  select: (id?: string) => void;
  openDiff: (id: string, file?: string) => void;
  closeDiff: () => void;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dropToast: (id: number) => void;
  act: (a: Action, sentLabel?: string) => Promise<boolean>;
  toggleBatch: (id: string) => void;
  clearBatch: () => void;
  isCollapsed: (phaseId: string) => boolean;
  toggleCollapsed: (phaseId: string) => void;
  openAdd: (target: { phase: string } | 'phase') => void;
  closeAdd: () => void;
}

// board housekeeping that Claude doesn't need to act on
const LOCAL: Action['type'][] = ['archive', 'unarchive', 'setCfg', 'setGuard', 'reorder', 'edit'];

// anything not running can be picked: open ones to start, any of them to archive
const PICKABLE = ['todo', 'ok', 'block', 'done', 'fail', 'skip'];

// ?lang=en&theme=light in the URL wins over the remembered choice
const saved = <T extends string>(key: string, fallback: T): T => {
  try {
    const fromUrl = new URLSearchParams(location.search).get(key.replace(/^cb\./, ''));
    return (fromUrl as T) || (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {}
};

const savedJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
};

let toastSeq = 0;
const collapseKey = (s: State | undefined, phaseId: string) => `${s?.project.name ?? ''}|${phaseId}`;

export const useBoard = create<BoardStore>((set, get) => ({
  git: false,
  connected: false,
  claude: 'away',
  lang: saved<Lang>('cb.lang', 'ar'),
  theme: saved<Theme>('cb.theme', 'dark'),
  toasts: [],
  batch: [],
  collapsed: savedJson<Record<string, boolean>>('cb.collapsed', {}),
  setState: (state) =>
    set((cur) => ({
      state,
      problem: undefined,
      // drop picks that started, finished or vanished since
      batch: cur.batch.filter((id) => PICKABLE.includes(state.steps.find((x) => x.id === id)?.s ?? '')),
    })),
  setUsage: (usage) => set({ usage }),
  setConnected: (connected) => set({ connected }),
  setClaude: (claude) => set({ claude }),
  live: () => get().connected && (get().claude === 'ready' || get().claude === 'working'),
  setProblem: (problem) => set({ problem }),
  setGit: (git) => set({ git }),
  select: (selected) => set({ selected }),
  openDiff: (id, file) => set({ diff: { id, file } }),
  closeDiff: () => set({ diff: undefined }),
  setLang: (lang) => {
    save('cb.lang', lang);
    set({ lang });
  },
  setTheme: (theme) => {
    save('cb.theme', theme);
    set({ theme });
  },
  toast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dropToast(id), kind === 'phase' || kind === 'later' ? 6000 : 3200);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  act: async (a, sentLabel) => {
    try {
      const r = await fetch('api/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-board': '1' },
        body: JSON.stringify(a),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      const { lang, toast, live } = get();
      // housekeeping stays on the board; everything else says honestly when Claude will see it
      if (LOCAL.includes(a.type)) {
        if (sentLabel) toast('done', sentLabel);
      } else {
        const when = translate(lang, live() ? 'sent.live' : 'sent.later');
        toast(live() ? 'sent' : 'later', sentLabel ? `${when} · ${sentLabel}` : when);
      }
      return true;
    } catch (e: any) {
      get().toast('error', e?.message ?? String(e));
      return false;
    }
  },
  toggleBatch: (id) => set((s) => ({ batch: s.batch.includes(id) ? s.batch.filter((x) => x !== id) : [...s.batch, id] })),
  clearBatch: () => set({ batch: [] }),
  isCollapsed: (phaseId) => !!get().collapsed[collapseKey(get().state, phaseId)],
  toggleCollapsed: (phaseId) => {
    const key = collapseKey(get().state, phaseId);
    const collapsed = { ...get().collapsed };
    if (collapsed[key]) delete collapsed[key];
    else collapsed[key] = true;
    save('cb.collapsed', JSON.stringify(collapsed));
    set({ collapsed });
  },
  openAdd: (adding) => set({ adding }),
  closeAdd: () => set({ adding: undefined }),
}));

export function useT() {
  const lang = useBoard((s) => s.lang);
  return (key: I18nKey) => translate(lang, key);
}

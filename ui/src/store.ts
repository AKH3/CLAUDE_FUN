import { create } from 'zustand';
import type { Action, State, Usage } from '../../src/core/schema';
import { translate, type I18nKey, type Lang } from './i18n';

export type Theme = 'dark' | 'light';

export interface Toast {
  id: number;
  kind: 'done' | 'fail' | 'phase' | 'plan' | 'sent' | 'error';
  text: string;
}

interface BoardStore {
  state?: State;
  usage?: Usage;
  git: boolean;
  connected: boolean;
  problem?: string;
  selected?: string;
  diff?: { id: string; file?: string };
  lang: Lang;
  theme: Theme;
  toasts: Toast[];
  setState: (s: State) => void;
  setUsage: (u: Usage) => void;
  setConnected: (v: boolean) => void;
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
}

const saved = <T extends string>(key: string, fallback: T): T => {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {}
};

let toastSeq = 0;

export const useBoard = create<BoardStore>((set, get) => ({
  git: false,
  connected: false,
  lang: saved<Lang>('cb.lang', 'ar'),
  theme: saved<Theme>('cb.theme', 'dark'),
  toasts: [],
  setState: (state) => set({ state, problem: undefined }),
  setUsage: (usage) => set({ usage }),
  setConnected: (connected) => set({ connected }),
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
    setTimeout(() => get().dropToast(id), kind === 'phase' ? 5000 : 3200);
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
      if (sentLabel) get().toast('sent', `${translate(get().lang, 'sent')} · ${sentLabel}`);
      return true;
    } catch (e: any) {
      get().toast('error', e?.message ?? String(e));
      return false;
    }
  },
}));

export function useT() {
  const lang = useBoard((s) => s.lang);
  return (key: I18nKey) => translate(lang, key);
}

import type { LogEntry, State } from '../../src/core/schema';
import { translate } from './i18n';
import { useBoard } from './store';

/** Turns newly appended log entries into toasts (done / failed / phase complete / plan). */
function announce(prev: State | undefined, next: State) {
  if (!prev) return;
  const seen = new Set(prev.log.map((l) => l.at + l.m));
  const fresh: LogEntry[] = next.log.filter((l) => !seen.has(l.at + l.m));
  const { toast, lang } = useBoard.getState();
  for (const l of fresh.slice(-4)) {
    const id = l.m.split(' ')[0];
    const title = next.steps.find((s) => s.id === id)?.t ?? next.phases.find((p) => p.id === id)?.t ?? '';
    if (l.k === 'done') toast('done', `${id} ${translate(lang, 'toast.done')} · ${title}`);
    else if (l.k === 'fail') toast('fail', `${id} ${translate(lang, 'toast.fail')} · ${title}`);
    else if (l.k === 'phase') toast('phase', `${translate(lang, 'toast.phase')} · ${title}`);
    else if (l.k === 'plan') toast('plan', `${translate(lang, 'toast.plan')} · ${l.m.replace(/^plan /, '')}`);
  }
}

export function connect() {
  const store = useBoard.getState();
  fetch('api/state')
    .then((r) => r.json())
    .then((j) => {
      store.setGit(!!j.git);
      if (j.claude) store.setClaude(j.claude);
      if (!useBoard.getState().state) store.setState(j.state);
      if (j.usage) store.setUsage(j.usage);
    })
    .catch(() => {});

  const es = new EventSource('api/events');
  es.onopen = () => useBoard.getState().setConnected(true);
  es.onerror = () => useBoard.getState().setConnected(false);
  es.addEventListener('state', (e) => {
    const next = JSON.parse((e as MessageEvent).data) as State;
    const prev = useBoard.getState().state;
    if (prev && next.rev < prev.rev) return;
    announce(prev, next);
    useBoard.getState().setState(next);
  });
  es.addEventListener('claude', (e) => useBoard.getState().setClaude(JSON.parse((e as MessageEvent).data).status));
  es.addEventListener('usage', (e) => useBoard.getState().setUsage(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('problem', (e) => useBoard.getState().setProblem(JSON.parse((e as MessageEvent).data).message));
  return () => es.close();
}

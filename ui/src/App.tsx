import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { AddDialog } from './components/AddDialog';
import { ArchivePanel } from './components/ArchivePanel';
import { BatchBar } from './components/BatchBar';
import { Canvas } from './components/Canvas';
import { CommandsPanel } from './components/CommandsPanel';
import { DiffModal } from './components/DiffModal';
import { Icon } from './components/Icon';
import { Inspector } from './components/Inspector';
import { ActivityPanel, EmptyState, Toasts } from './components/Panels';
import { TopBar } from './components/TopBar';
import { connect } from './sse';
import { useBoard } from './store';

export type Panel = 'activity' | 'archive' | 'commands';

export function App() {
  const state = useBoard((s) => s.state);
  const lang = useBoard((s) => s.lang);
  const theme = useBoard((s) => s.theme);
  const problem = useBoard((s) => s.problem);
  const [panel, setPanel] = useState<Panel>();
  const close = () => setPanel(undefined);

  useEffect(() => connect(), []);
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    html.dataset.theme = theme;
  }, [lang, theme]);
  useEffect(() => {
    if (state) document.title = `${state.project.name} · Claude Board`;
  }, [state?.project.name]);

  if (!state) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-ping rounded-full bg-run" />
          Claude Board…
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <TopBar panel={panel} onPanel={(p) => setPanel((cur) => (cur === p ? undefined : p))} />
        {problem && (
          <div className="flex items-center gap-2 bg-fail/15 px-4 py-2 text-[13px] text-fail" dir="ltr">
            <Icon name="alert" size={14} /> {problem}
          </div>
        )}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {state.phases.length ? <Canvas /> : <EmptyState />}
          {panel === 'activity' && <ActivityPanel onClose={close} />}
          {panel === 'archive' && <ArchivePanel onClose={close} />}
          {panel === 'commands' && <CommandsPanel onClose={close} />}
          <Inspector />
        </main>
        <DiffModal />
        <AddDialog />
        <BatchBar />
        <Toasts />
      </div>
    </ReactFlowProvider>
  );
}

import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { childrenOf } from '../../../src/core/tree';
import { STATUS_COLOR } from '../format';
import { dropIndex, layout, type BoardNode } from '../layout';
import { useBoard } from '../store';
import { nodeTypes } from './Nodes';

export function Canvas() {
  const state = useBoard((s) => s.state)!;
  const usage = useBoard((s) => s.usage);
  const lang = useBoard((s) => s.lang);
  const theme = useBoard((s) => s.theme);
  const selected = useBoard((s) => s.selected);
  const select = useBoard((s) => s.select);
  const act = useBoard((s) => s.act);
  const collapsed = useBoard((s) => s.collapsed);
  const isCollapsed = useBoard((s) => s.isCollapsed);
  const toggleCollapsed = useBoard((s) => s.toggleCollapsed);
  const rtl = lang === 'ar';
  const { fitView } = useReactFlow();

  // `collapsed` is listed so the layout reruns when a phase is folded
  const laid = useMemo(() => layout(state, usage, rtl, isCollapsed), [state, usage, rtl, collapsed, isCollapsed]);
  const [nodes, setNodes] = useState<BoardNode[]>(laid.nodes);
  const homeX = useRef(new Map<string, number>());

  useEffect(() => {
    homeX.current = new Map(laid.nodes.map((n) => [n.id, n.position.x]));
    setNodes(laid.nodes.map((n) => ({ ...n, selected: n.id === selected })));
  }, [laid, selected]);

  // re-frame when the shape of the tree changes (new phases, language mirror)
  const shape = `${state.phases.length}:${rtl}`;
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 400, maxZoom: 1 }), 60);
    return () => clearTimeout(t);
  }, [shape, fitView]);

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    // steps only move vertically: their column is their phase
    const fixed = changes.map((c) =>
      c.type === 'position' && c.position ? { ...c, position: { x: homeX.current.get(c.id) ?? c.position.x, y: c.position.y } } : c,
    );
    setNodes((nds) => applyNodeChanges(fixed, nds));
  }, []);

  const onNodeDragStop: OnNodeDrag<BoardNode> = useCallback(
    (_e, node) => {
      if (node.type !== 'step') return;
      const st = state.steps.find((x) => x.id === node.id);
      if (!st) return;
      const sibs = st.parent ? childrenOf(state, st.parent) : childrenOf(state, null, st.p);
      const ys = new Map(laid.nodes.map((n) => [n.id, n.position.y]));
      const to = dropIndex(state, st.id, node.position.y, ys);
      const from = sibs.findIndex((x) => x.id === st.id);
      if (to !== from) act({ type: 'reorder', id: st.id, to }, `${st.id} → #${to + 1}`);
      else setNodes(laid.nodes.map((n) => ({ ...n, selected: n.id === selected })));
    },
    [state, laid, act, selected],
  );

  return (
    <div className="absolute inset-0" dir="ltr">
      <ReactFlow<BoardNode>
        nodes={nodes}
        edges={laid.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_e, n) => (n.type === 'phase' ? toggleCollapsed(n.id) : n.type === 'step' && select(n.id))}
        onPaneClick={() => select(undefined)}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        nodeDragThreshold={6}
        minZoom={0.2}
        maxZoom={1.75}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="var(--grid)" />
        <Controls showInteractive={false} position={rtl ? 'bottom-right' : 'bottom-left'} />
        <MiniMap
          pannable
          zoomable
          position={rtl ? 'bottom-left' : 'bottom-right'}
          className="!hidden md:!block"
          nodeBorderRadius={6}
          nodeColor={(n) => {
            if (n.type === 'lane') return 'transparent';
            if (n.type === 'phase') return 'var(--panel2)';
            const d = (n as any).data;
            return STATUS_COLOR[d.locked ? 'locked' : d.step.s as keyof typeof STATUS_COLOR];
          }}
        />
      </ReactFlow>
    </div>
  );
}

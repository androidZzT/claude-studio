'use client';

import { useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, AlertTriangle, CheckCircle2, Clock, GitBranch } from 'lucide-react';
import type { VisualWorkflowRun } from '@/types/visual-workflow';
import { visualRunToFlow } from '@/lib/visual-run-to-flow';
import { DagNode } from './DagNode';

const nodeTypes: NodeTypes = {
  dagNode: DagNode as unknown as NodeTypes['dagNode'],
};

interface VisualWorkflowCanvasProps {
  readonly run: VisualWorkflowRun;
  readonly selectedNodeId: string | null;
  readonly onNodeSelect: (nodeId: string) => void;
  readonly loading?: boolean;
  readonly showCanvasGrid?: boolean;
  readonly showMinimap?: boolean;
}

function VisualWorkflowCanvasInner({
  run,
  selectedNodeId,
  onNodeSelect,
  loading = false,
  showCanvasGrid = true,
  showMinimap = true,
}: VisualWorkflowCanvasProps) {
  const reactFlow = useReactFlow();
  const flow = useMemo(() => visualRunToFlow(run), [run]);

  useEffect(() => {
    const timer = setTimeout(() => reactFlow.fitView({ padding: 0.18, duration: 250 }), 80);
    return () => clearTimeout(timer);
  }, [reactFlow, run.runId]);

  const selectedIds = useMemo(() => new Set(selectedNodeId ? [selectedNodeId] : []), [selectedNodeId]);
  const nodes = useMemo(
    () => flow.nodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) })),
    [flow.nodes, selectedIds],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch size={14} className="text-accent" />
            <h2 className="truncate text-sm font-semibold text-foreground">{run.runId}</h2>
            <StatusPill status={run.status} />
          </div>
          <p className="mt-1 truncate text-xs text-muted">
            {run.source === 'harness-run' ? run.runRoot : run.definitionPath ?? run.runRoot}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-wider text-muted">
          {loading && <span>Refreshing...</span>}
          <span>{run.nodes.length} nodes</span>
          <span>{run.edges.length} edges</span>
        </div>
      </div>

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => onNodeSelect(node.id)}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          {showCanvasGrid && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />}
          <Controls className="!bg-surface !border-border !shadow-lg [&>button]:!bg-surface [&>button]:!border-border [&>button]:!text-muted [&>button:hover]:!bg-surface-hover" />
          {showMinimap && (
            <MiniMap
              className="!bg-surface !border !border-border"
              nodeColor={(node) => {
                const status = node.data.executionStatus;
                if (status === 'succeeded' || status === 'done') return '#22c55e';
                if (status === 'failed') return '#ef4444';
                if (status === 'blocked' || status === 'waiting-checkpoint') return '#f59e0b';
                if (status === 'running') return '#38bdf8';
                return '#64748b';
              }}
            />
          )}
        </ReactFlow>
      </div>
    </div>
  );
}

function StatusPill({ status }: { readonly status: VisualWorkflowRun['status'] }) {
  const config = getStatusConfig(status);
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.className}`}>
      <Icon size={10} />
      {config.label}
    </span>
  );
}

function getStatusConfig(status: VisualWorkflowRun['status']) {
  switch (status) {
    case 'succeeded':
      return { label: 'Succeeded', icon: CheckCircle2, className: 'bg-green-500/15 text-green-300' };
    case 'failed':
      return { label: 'Failed', icon: AlertTriangle, className: 'bg-red-500/15 text-red-300' };
    case 'blocked':
      return { label: 'Blocked', icon: AlertTriangle, className: 'bg-amber-500/15 text-amber-300' };
    case 'running':
      return { label: 'Running', icon: Activity, className: 'bg-sky-500/15 text-sky-300' };
    default:
      return { label: status, icon: Clock, className: 'bg-slate-500/15 text-slate-300' };
  }
}

export function VisualWorkflowCanvas(props: VisualWorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <VisualWorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

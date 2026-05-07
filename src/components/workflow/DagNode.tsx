'use client';

import { memo, useCallback, useState } from 'react';
import { Lock, ShieldCheck, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DagNodeData, ExecutionNodeStatus } from '@/lib/workflow-to-flow';
import { isProtectedNode } from '@/lib/workflow-constants';

type DagNodeProps = NodeProps & { data: DagNodeData };

function executionClassName(executionStatus: ExecutionNodeStatus | null | undefined): string {
  if (!executionStatus) return '';

  switch (executionStatus) {
    case 'pending':
      return 'opacity-40 transition-opacity duration-300';
    case 'queued':
      return 'border-yellow-400/60 bg-yellow-500/5 transition-colors duration-300';
    case 'running':
      return 'preview-node-pulse border-blue-400 bg-blue-500/10';
    case 'done':
    case 'succeeded':
      return 'border-green-500/60 bg-green-500/5 transition-colors duration-300';
    case 'failed':
      return 'border-red-500/60 bg-red-500/5 transition-colors duration-300';
    case 'waiting-checkpoint':
    case 'blocked':
      return 'preview-checkpoint-pulse border-amber-400 bg-amber-500/15';
    case 'skipped':
      return 'opacity-50 border-slate-500/50 bg-slate-500/5 transition-opacity duration-300';
    case 'cancelled':
      return 'opacity-30 transition-opacity duration-300';
    default:
      return '';
  }
}

function executionIcon(executionStatus: ExecutionNodeStatus | null | undefined) {
  if (!executionStatus) return null;

  switch (executionStatus) {
    case 'running':
      return <Loader2 size={10} className="animate-spin text-blue-400" />;
    case 'done':
    case 'succeeded':
      return <CheckCircle2 size={10} className="text-green-400" />;
    case 'failed':
      return <XCircle size={10} className="text-red-400" />;
    case 'waiting-checkpoint':
    case 'blocked':
      return <AlertCircle size={10} className="text-amber-400" />;
    default:
      return null;
  }
}

function baseClassName(data: DagNodeData, selected: boolean | undefined, hasExecutionState: boolean): string {
  if (hasExecutionState) {
    // During preview/execution, base border/bg are overridden
    return 'border-border bg-surface';
  }

  if (data.checkpoint) return 'border-amber-500/50 bg-amber-500/10';
  if (selected) return 'border-accent bg-accent/10';
  return 'border-border bg-surface';
}

function isSkillOrMcpDrag(e: React.DragEvent): boolean {
  const types = e.dataTransfer.types;
  return types.includes('application/cc-skill') || types.includes('application/cc-mcp');
}

function DagNodeInner({ data, selected }: DagNodeProps) {
  const inCount = data.inCount ?? 0;
  const outCount = data.outCount ?? 0;
  const hasExecution = data.executionStatus != null;
  const execution = executionClassName(data.executionStatus);
  const base = baseClassName(data, selected, hasExecution);
  const execIcon = executionIcon(data.executionStatus);

  const [dragOver, setDragOver] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (isSkillOrMcpDrag(e)) {
      e.preventDefault();
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the node itself (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as globalThis.Node)) return;
    setDragOver(false);
  }, []);

  const handleDragOverNode = useCallback((e: React.DragEvent) => {
    if (isSkillOrMcpDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDropOnNode = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const skillRaw = e.dataTransfer.getData('application/cc-skill');
    if (skillRaw) {
      try {
        const { name } = JSON.parse(skillRaw) as { name: string };
        window.dispatchEvent(new CustomEvent('harness-studio:bind-skill', {
          detail: { nodeId: data.nodeId, skillName: name },
        }));
      } catch { /* ignore */ }
      return;
    }

    const mcpRaw = e.dataTransfer.getData('application/cc-mcp');
    if (mcpRaw) {
      try {
        const { name } = JSON.parse(mcpRaw) as { name: string };
        window.dispatchEvent(new CustomEvent('harness-studio:bind-mcp', {
          detail: { nodeId: data.nodeId, mcpName: name },
        }));
      } catch { /* ignore */ }
    }
  }, [data.nodeId]);

  const dragOverClass = dragOver ? 'ring-2 ring-accent ring-offset-1 ring-offset-background border-dashed border-accent' : '';

  return (
    <div
      className={`min-w-[200px] max-w-[260px] rounded-lg border px-3 py-2 text-xs shadow-md transition-colors ${base} ${execution} ${dragOverClass}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOverNode}
      onDrop={handleDropOnNode}
    >
      <Handle id="top" type="target" position={Position.Top} className="!bg-muted !w-2 !h-2" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-muted !w-2 !h-2" />
      <Handle id="left" type="target" position={Position.Left} className="!bg-purple-400 !w-2 !h-2" />
      <Handle id="left-out" type="source" position={Position.Left} className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent" />
      <Handle id="right" type="source" position={Position.Right} className="!bg-purple-400 !w-2 !h-2" />
      <Handle id="right-in" type="target" position={Position.Right} className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent" />

      <div className="mb-1 flex items-center gap-1 font-semibold text-foreground">
        {data.label}
        {isProtectedNode(data.nodeId, data.agent) && (
          <Lock size={12} className="text-muted/60" />
        )}
        {execIcon && <span className="ml-auto">{execIcon}</span>}
      </div>
      <div className="text-muted">
        <span className="text-accent/80">{data.agent}</span>
        {data.tool && <span className="ml-1 text-muted/60">via {data.tool}</span>}
      </div>

      {data.task ? (
        <div className="mt-1 line-clamp-2 text-muted/70 leading-tight">{data.task}</div>
      ) : (
        <div className="mt-1 text-muted/40 italic leading-tight">Click to set task...</div>
      )}

      {/* Skill pills */}
      {data.skills.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {data.skills.slice(0, 3).map((skill) => (
            <span
              key={skill}
              className="inline-block max-w-[120px] truncate rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400"
              title={skill}
            >
              {skill}
            </span>
          ))}
          {data.skills.length > 3 && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400/70">
              +{data.skills.length - 3}
            </span>
          )}
        </div>
      )}

      {/* MCP pills */}
      {data.mcpServers.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {data.mcpServers.slice(0, 2).map((mcp) => (
            <span
              key={mcp}
              className="inline-block max-w-[120px] truncate rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-400"
              title={mcp}
            >
              {mcp}
            </span>
          ))}
          {data.mcpServers.length > 2 && (
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400/70">
              +{data.mcpServers.length - 2}
            </span>
          )}
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {data.checkpoint && (
            <span className="flex items-center gap-0.5 text-[10px] font-medium uppercase text-amber-400">
              <ShieldCheck size={10} /> checkpoint
            </span>
          )}
          {typeof data.toolCallCount === 'number' && (
            <span className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] text-sky-300">
              {data.toolCallCount} tools
            </span>
          )}
          {typeof data.skillUseCount === 'number' && data.skillUseCount > 0 && (
            <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-300">
              {data.skillUseCount} skills
            </span>
          )}
        </div>
        <span className="ml-auto text-[10px] text-muted/50">
          {formatDuration(data.durationMs) ?? `${inCount} in / ${outCount} out`}
        </span>
      </div>
    </div>
  );
}

export const DagNode = memo(DagNodeInner);

function formatDuration(durationMs: number | undefined): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

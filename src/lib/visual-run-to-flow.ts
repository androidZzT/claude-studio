import type { Edge, Node } from '@xyflow/react';
import type { DagNodeData, ExecutionNodeStatus } from './workflow-to-flow';
import type { VisualNodeStatus, VisualWorkflowRun } from '@/types/visual-workflow';

export function visualRunToFlow(run: VisualWorkflowRun): {
  readonly nodes: Node<DagNodeData>[];
  readonly edges: Edge[];
} {
  const levels = computeLevels(run);
  const grouped = groupByLevel(run, levels);
  const nodeById = new Map(run.nodes.map((node) => [node.id, node]));

  const nodes: Node<DagNodeData>[] = run.nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const siblings = grouped.get(level) ?? [node.id];
    const siblingIndex = siblings.indexOf(node.id);
    const totalSiblings = siblings.length;
    const summary = node.trajectorySummary;

    return {
      id: node.id,
      type: 'dagNode',
      position: {
        x: 330 * Math.max(siblingIndex, 0) - 165 * (totalSiblings - 1),
        y: 205 * level,
      },
      data: {
        label: node.label,
        agent: node.agent ?? node.tool ?? 'phase',
        task: node.task ?? summary?.final_output_preview ?? '',
        checkpoint: node.checkpoint ?? false,
        nodeId: node.id,
        skills: [],
        mcpServers: [],
        executionStatus: statusToExecution(node.status),
        tool: node.tool,
        durationMs: node.durationMs,
        toolCallCount: summary?.tool_call_count,
        skillUseCount: summary?.skill_use_count,
        totalTokens: summary?.total_tokens,
        trajectoryStatus: node.trajectoryStatus ?? summary?.status,
      },
    };
  });

  const edges: Edge[] = run.edges.map((edge) => {
    const sourceStatus = nodeById.get(edge.source)?.status;
    const targetStatus = nodeById.get(edge.target)?.status;
    const active = sourceStatus === 'running' || targetStatus === 'running';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: 'bottom',
      targetHandle: 'top',
      animated: active,
      style: { stroke: edgeColor(targetStatus), strokeWidth: active ? 2 : 1.5 },
      data: { edgeType: 'dispatch' },
    } satisfies Edge;
  });

  return { nodes, edges };
}

function statusToExecution(status: VisualNodeStatus): ExecutionNodeStatus {
  return status;
}

function edgeColor(status: VisualNodeStatus | undefined): string {
  switch (status) {
    case 'succeeded': return '#22c55e';
    case 'failed': return '#ef4444';
    case 'blocked': return '#f59e0b';
    case 'running': return '#38bdf8';
    case 'cancelled': return '#64748b';
    default: return '#64748b';
  }
}

function computeLevels(run: VisualWorkflowRun): Map<string, number> {
  const ids = new Set(run.nodes.map((node) => node.id));
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();
  for (const id of ids) {
    parents.set(id, new Set());
    children.set(id, new Set());
  }
  for (const edge of run.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    parents.get(edge.target)?.add(edge.source);
    children.get(edge.source)?.add(edge.target);
  }

  const levels = new Map<string, number>();
  const queue = Array.from(ids).filter((id) => (parents.get(id)?.size ?? 0) === 0);
  for (const id of queue) levels.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const baseLevel = levels.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      const nextLevel = Math.max(levels.get(child) ?? 0, baseLevel + 1);
      levels.set(child, nextLevel);
      const childParents = parents.get(child) ?? new Set<string>();
      const allParentsPlaced = Array.from(childParents).every((parent) => levels.has(parent));
      if (allParentsPlaced && !queue.includes(child)) queue.push(child);
    }
  }

  let fallbackLevel = 0;
  for (const node of run.nodes) {
    if (!levels.has(node.id)) {
      levels.set(node.id, fallbackLevel++);
    }
  }
  return levels;
}

function groupByLevel(run: VisualWorkflowRun, levels: ReadonlyMap<string, number>): Map<number, readonly string[]> {
  const grouped = new Map<number, string[]>();
  for (const node of run.nodes) {
    const level = levels.get(node.id) ?? 0;
    const group = grouped.get(level) ?? [];
    group.push(node.id);
    grouped.set(level, group);
  }
  return grouped;
}

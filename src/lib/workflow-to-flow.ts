import type { Node, Edge } from '@xyflow/react';
import type { Workflow, WorkflowNode } from '@/types/resources';
import { ensureStringArray } from './array-utils';

export type EdgeType = 'dispatch' | 'report' | 'sync' | 'roundtrip';

export type ExecutionNodeStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'waiting-checkpoint'
  | 'cancelled';

/**
 * Data carried by each DAG node. Extends Record<string, unknown> to satisfy
 * React Flow's Node<T> constraint. All known fields are explicitly typed;
 * the index signature is required by the framework but should not be used
 * for arbitrary property access — add new fields here instead.
 */
export interface DagNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly agent: string;
  readonly task: string;
  readonly checkpoint: boolean;
  readonly nodeId: string;
  readonly skills: readonly string[];
  readonly mcpServers: readonly string[];
  readonly executionStatus?: ExecutionNodeStatus | null;
  readonly inCount?: number;
  readonly outCount?: number;
  readonly text?: string;
}

export const DISPATCH_EDGE_STYLE = {
  stroke: '#888',
} as const;

export const REPORT_EDGE_STYLE = {
  stroke: '#22d3ee',
  strokeDasharray: '5 5',
} as const;

export const SYNC_EDGE_STYLE = {
  stroke: '#a855f7',
  strokeWidth: 2,
  strokeDasharray: '2 4',
} as const;

export const ROUNDTRIP_EDGE_STYLE = {
  stroke: '#14b8a6',
  strokeWidth: 2,
} as const;

export function workflowToFlow(workflow: Workflow): {
  readonly nodes: Node<DagNodeData>[];
  readonly edges: Edge[];
} {
  const levelMap = computeLevels(workflow.nodes);

  // Build sync adjacency map from workflow nodes
  const syncMap = buildSyncMap(workflow.nodes);

  // Group nodes by level
  const levelGroups = new Map<number, WorkflowNode[]>();
  for (const wn of workflow.nodes) {
    const level = levelMap.get(wn.id) ?? 0;
    const group = levelGroups.get(level) ?? [];
    levelGroups.set(level, [...group, wn]);
  }

  // Order each level's nodes for sync affinity, processing levels top-down
  // so that earlier levels' positions inform later levels
  const orderedLevelGroups = new Map<number, readonly string[]>();
  const nodePositionIndex = new Map<string, number>();
  const maxLevel = Math.max(...Array.from(levelMap.values()), 0);

  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const group = levelGroups.get(lvl) ?? [];
    const ids = group.map((n) => n.id);
    const ordered = orderNodesBySyncAffinity(ids, syncMap, nodePositionIndex);
    orderedLevelGroups.set(lvl, ordered);
    // Record each node's index within its level for cross-level alignment
    for (let i = 0; i < ordered.length; i++) {
      nodePositionIndex.set(ordered[i], i);
    }
  }

  const nodes: Node<DagNodeData>[] = workflow.nodes.map((wn) => {
    const level = levelMap.get(wn.id) ?? 0;
    const ordered = orderedLevelGroups.get(level) ?? [wn.id];
    const siblingIndex = ordered.indexOf(wn.id);
    const totalSiblings = ordered.length;

    return {
      id: wn.id,
      type: 'dagNode',
      position: {
        x: 320 * siblingIndex - 160 * (totalSiblings - 1),
        y: 200 * level,
      },
      data: {
        label: wn.id,
        agent: wn.agent,
        task: wn.task,
        checkpoint: wn.checkpoint ?? false,
        nodeId: wn.id,
        skills: wn.skills ?? [],
        mcpServers: wn.mcp_servers ?? [],
      },
    };
  });

  // Build position lookup for horizontal handle routing on sync edges
  const positionLookup = new Map<string, { readonly x: number; readonly y: number }>();
  for (const n of nodes) {
    positionLookup.set(n.id, n.position);
  }

  const edges: Edge[] = [];
  for (const wn of workflow.nodes) {
    for (const dep of ensureStringArray(wn.depends_on)) {
      edges.push({
        id: `dispatch:${dep}->${wn.id}`,
        source: dep,
        target: wn.id,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        animated: true,
        style: DISPATCH_EDGE_STYLE,
        data: { edgeType: 'dispatch' as EdgeType },
      });
    }
    for (const target of ensureStringArray(wn.reports_to)) {
      edges.push({
        id: `report:${wn.id}->${target}`,
        source: wn.id,
        target,
        sourceHandle: 'top',
        targetHandle: 'bottom',
        animated: true,
        style: REPORT_EDGE_STYLE,
        label: 'report',
        data: { edgeType: 'report' as EdgeType },
      });
    }
    for (const peer of ensureStringArray(wn.syncs_with)) {
      const sourcePos = positionLookup.get(wn.id);
      const targetPos = positionLookup.get(peer);
      // Route horizontally: source on right side, target on left side
      // If source is right of target, swap to use left-out / right-in
      const sourceIsLeft = (sourcePos?.x ?? 0) <= (targetPos?.x ?? 0);
      edges.push({
        id: `sync:${wn.id}->${peer}`,
        source: wn.id,
        target: peer,
        sourceHandle: sourceIsLeft ? 'right' : 'left-out',
        targetHandle: sourceIsLeft ? 'left' : 'right-in',
        animated: true,
        style: SYNC_EDGE_STYLE,
        label: 'sync',
        data: { edgeType: 'sync' as EdgeType },
      });
    }
    for (const target of ensureStringArray(wn.roundtrip)) {
      edges.push({
        id: `roundtrip:${target}->${wn.id}`,
        source: target,
        target: wn.id,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        animated: true,
        style: ROUNDTRIP_EDGE_STYLE,
        label: 'roundtrip',
        markerStart: 'arrowclosed',
        markerEnd: 'arrowclosed',
        data: { edgeType: 'roundtrip' as EdgeType },
      });
    }
  }

  return { nodes, edges };
}

function computeLevels(nodes: readonly WorkflowNode[]): Map<string, number> {
  const levels = new Map<string, number>();
  const depsMap = new Map<string, readonly string[]>();

  for (const n of nodes) {
    const deps = [
      ...ensureStringArray(n.depends_on),
      ...ensureStringArray(n.roundtrip),
    ];
    depsMap.set(n.id, deps);
  }

  function getLevel(id: string): number {
    if (levels.has(id)) return levels.get(id)!;

    const deps = depsMap.get(id) ?? [];
    if (deps.length === 0) {
      levels.set(id, 0);
      return 0;
    }

    const maxParent = Math.max(...deps.map(getLevel));
    const level = maxParent + 1;
    levels.set(id, level);
    return level;
  }

  for (const n of nodes) {
    getLevel(n.id);
  }

  return levels;
}

/**
 * Build a bidirectional sync adjacency map from workflow nodes.
 * For each syncs_with relationship A→B, both A→B and B→A are recorded.
 */
function buildSyncMap(nodes: readonly WorkflowNode[]): Map<string, readonly string[]> {
  const adjacency = new Map<string, Set<string>>();

  const ensureSet = (id: string): Set<string> => {
    const existing = adjacency.get(id);
    if (existing) return existing;
    const fresh = new Set<string>();
    adjacency.set(id, fresh);
    return fresh;
  };

  for (const node of nodes) {
    for (const peer of ensureStringArray(node.syncs_with)) {
      ensureSet(node.id).add(peer);
      ensureSet(peer).add(node.id);
    }
  }

  const result = new Map<string, readonly string[]>();
  for (const [id, peers] of adjacency) {
    result.set(id, Array.from(peers));
  }
  return result;
}

/**
 * Build a bidirectional sync adjacency map from edges (for auto-layout).
 */
export function buildSyncMapFromEdges(edges: readonly Edge[]): Map<string, readonly string[]> {
  const adjacency = new Map<string, Set<string>>();

  const ensureSet = (id: string): Set<string> => {
    const existing = adjacency.get(id);
    if (existing) return existing;
    const fresh = new Set<string>();
    adjacency.set(id, fresh);
    return fresh;
  };

  for (const edge of edges) {
    if (edge.data?.edgeType === 'sync') {
      ensureSet(edge.source).add(edge.target);
      ensureSet(edge.target).add(edge.source);
    }
  }

  const result = new Map<string, readonly string[]>();
  for (const [id, peers] of adjacency) {
    result.set(id, Array.from(peers));
  }
  return result;
}

/**
 * Order nodes within a single level to minimize sync edge lengths.
 *
 * Strategy:
 * 1. Find connected components of same-level nodes via sync edges.
 * 2. Within each component, order nodes sequentially (BFS from first node).
 * 3. Order components by the average x-position of their cross-level sync
 *    partners (from nodePositionIndex), so each component is placed near
 *    the nodes it syncs with at other levels.
 * 4. Non-sync nodes fill remaining positions, also ordered by their
 *    cross-level sync partner positions (or original order as fallback).
 */
export function orderNodesBySyncAffinity(
  nodeIds: readonly string[],
  syncMap: Map<string, readonly string[]>,
  nodePositionIndex: Map<string, number>,
): readonly string[] {
  if (nodeIds.length <= 1) return nodeIds;

  const nodeSet = new Set(nodeIds);

  // Build same-level sync adjacency (only between nodes at this level)
  const sameLevelAdj = new Map<string, string[]>();
  for (const id of nodeIds) {
    const peers = (syncMap.get(id) ?? []).filter((p) => nodeSet.has(p));
    if (peers.length > 0) {
      sameLevelAdj.set(id, peers);
    }
  }

  // Find connected components of same-level sync-connected nodes
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of nodeIds) {
    if (visited.has(id) || !sameLevelAdj.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const peer of sameLevelAdj.get(current) ?? []) {
        if (!visited.has(peer)) {
          visited.add(peer);
          queue.push(peer);
        }
      }
    }
    components.push(component);
  }

  // Collect non-sync nodes (not part of any same-level sync component)
  const nonSyncNodes = nodeIds.filter((id) => !visited.has(id));

  // Compute the "attraction position" for a node: average index of its
  // cross-level sync partners that have already been positioned.
  const attractionPos = (id: string): number | null => {
    const crossLevelPeers = (syncMap.get(id) ?? []).filter(
      (p) => !nodeSet.has(p) && nodePositionIndex.has(p),
    );
    if (crossLevelPeers.length === 0) return null;
    const sum = crossLevelPeers.reduce((acc, p) => acc + (nodePositionIndex.get(p) ?? 0), 0);
    return sum / crossLevelPeers.length;
  };

  // Compute average attraction for a group of nodes
  const groupAttraction = (ids: readonly string[]): number | null => {
    const positions = ids
      .map(attractionPos)
      .filter((p): p is number => p !== null);
    if (positions.length === 0) return null;
    return positions.reduce((a, b) => a + b, 0) / positions.length;
  };

  // Build list of "items" to place: each item is either a component or a single non-sync node
  type PlacementItem = { readonly ids: readonly string[]; readonly attraction: number | null };

  const items: PlacementItem[] = [
    ...components.map((comp) => ({
      ids: comp as readonly string[],
      attraction: groupAttraction(comp),
    })),
    ...nonSyncNodes.map((id) => ({
      ids: [id] as readonly string[],
      attraction: attractionPos(id),
    })),
  ];

  // Sort items: those with attraction positions come first (sorted by position),
  // then those without (preserving original order).
  const withAttraction = items
    .filter((it): it is PlacementItem & { attraction: number } => it.attraction !== null)
    .sort((a, b) => a.attraction - b.attraction);

  const withoutAttraction = items.filter((it) => it.attraction === null);

  // Merge: interleave items with attraction into final order.
  // Items without attraction fill gaps to maintain a natural layout.
  const sorted = [...withAttraction, ...withoutAttraction];

  return sorted.flatMap((item) => item.ids);
}

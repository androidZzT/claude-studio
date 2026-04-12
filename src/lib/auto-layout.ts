import type { Node, Edge } from '@xyflow/react';
import type { DagNodeData } from './workflow-to-flow';
import { buildSyncMapFromEdges, orderNodesBySyncAffinity } from './workflow-to-flow';
import { computeLevelsFromDepsMap } from './topology';

const HORIZONTAL_SPACING = 320;
const VERTICAL_SPACING = 200;

/**
 * Computes dependency levels from edges using shared topology algorithm.
 * Returns a Map from nodeId to level number.
 */
function computeLevelsFromEdges(
  nodes: readonly Node<DagNodeData>[],
  edges: readonly Edge[],
): Map<string, number> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const depsMap = new Map<string, readonly string[]>();

  for (const node of nodes) {
    const deps = edges
      .filter((e) => {
        const type = e.data?.edgeType ?? 'dispatch';
        return e.target === node.id && (type === 'dispatch' || type === 'roundtrip');
      })
      .map((e) => e.source)
      .filter((id) => nodeIds.has(id));
    depsMap.set(node.id, deps);
  }

  // Use shared topology and convert level arrays back to Map
  const levelArrays = computeLevelsFromDepsMap(nodeIds, depsMap);
  const levels = new Map<string, number>();
  for (let i = 0; i < levelArrays.length; i++) {
    for (const id of levelArrays[i]) {
      levels.set(id, i);
    }
  }
  return levels;
}

/**
 * Returns new nodes with positions recalculated using dependency-based
 * level layout. Sticky notes are left at their current positions.
 */
export function autoLayoutNodes(
  nodes: readonly Node<DagNodeData>[],
  edges: readonly Edge[],
): Node<DagNodeData>[] {
  const dagNodes = nodes.filter((n) => n.type !== 'stickyNote');
  const stickyNodes = nodes.filter((n) => n.type === 'stickyNote');

  const levels = computeLevelsFromEdges(dagNodes, edges);
  const syncMap = buildSyncMapFromEdges(edges);

  // Group nodes by level
  const levelGroups = new Map<number, Node<DagNodeData>[]>();
  for (const node of dagNodes) {
    const level = levels.get(node.id) ?? 0;
    const group = levelGroups.get(level) ?? [];
    levelGroups.set(level, [...group, node]);
  }

  // Order each level's nodes for sync affinity, processing top-down
  const orderedLevelIds = new Map<number, readonly string[]>();
  const nodePositionIndex = new Map<string, number>();
  const maxLevel = Math.max(...Array.from(levels.values()), 0);

  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const group = levelGroups.get(lvl) ?? [];
    const ids = group.map((n) => n.id);
    const ordered = orderNodesBySyncAffinity(ids, syncMap, nodePositionIndex);
    orderedLevelIds.set(lvl, ordered);
    for (let i = 0; i < ordered.length; i++) {
      nodePositionIndex.set(ordered[i], i);
    }
  }

  const layouted: Node<DagNodeData>[] = dagNodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const ordered = orderedLevelIds.get(level) ?? [node.id];
    const siblingIndex = ordered.indexOf(node.id);
    const totalSiblings = ordered.length;

    return {
      ...node,
      position: {
        x: HORIZONTAL_SPACING * siblingIndex - (HORIZONTAL_SPACING / 2) * (totalSiblings - 1),
        y: VERTICAL_SPACING * level,
      },
    };
  });

  return [...layouted, ...stickyNodes.map((n) => ({ ...n }))];
}

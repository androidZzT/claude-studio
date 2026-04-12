import type { Node, Edge } from '@xyflow/react';
import type { DagNodeData } from './workflow-to-flow';

/**
 * Core topology algorithm: computes topological levels from a dependency map.
 * Nodes at level 0 have no dependencies. Nodes at level N depend on at least
 * one node at level N-1 (or lower). Shared by React Flow canvas, execution
 * engine, and auto-layout.
 */
export function computeLevelsFromDepsMap(
  nodeIds: ReadonlySet<string>,
  depsMap: ReadonlyMap<string, readonly string[]>,
): readonly (readonly string[])[] {
  const levelCache = new Map<string, number>();

  function getLevel(id: string): number {
    const cached = levelCache.get(id);
    if (cached !== undefined) return cached;

    const deps = depsMap.get(id) ?? [];
    if (deps.length === 0) {
      levelCache.set(id, 0);
      return 0;
    }

    const maxParent = Math.max(...deps.map(getLevel));
    const level = maxParent + 1;
    levelCache.set(id, level);
    return level;
  }

  for (const id of nodeIds) {
    getLevel(id);
  }

  // Group by level
  const maxLevel = nodeIds.size > 0
    ? Math.max(...Array.from(nodeIds).map((id) => levelCache.get(id) ?? 0))
    : -1;

  const levels: string[][] = [];
  for (let i = 0; i <= maxLevel; i++) {
    const nodesAtLevel = Array.from(nodeIds).filter(
      (id) => (levelCache.get(id) ?? 0) === i
    );
    levels.push(nodesAtLevel);
  }

  return levels;
}

/**
 * Groups node IDs into topological levels based on dispatch edges.
 * Nodes at level 0 have no dispatch dependencies.
 * Nodes at level N depend on at least one node at level N-1 (or lower).
 *
 * Returns an array of arrays, where each inner array contains node IDs
 * at that level. Parallel nodes share the same level.
 */
export function computeTopologyLevels(
  nodes: readonly Node<DagNodeData>[],
  edges: readonly Edge[]
): readonly (readonly string[])[] {
  const dispatchEdges = edges.filter(
    (e) => {
      const type = e.data?.edgeType ?? 'dispatch';
      return type === 'dispatch' || type === 'roundtrip';
    }
  );

  const nodeIds = new Set(nodes.map((n) => n.id));
  const depsMap = new Map<string, readonly string[]>();

  for (const id of nodeIds) {
    const parents = dispatchEdges
      .filter((e) => e.target === id && nodeIds.has(e.source))
      .map((e) => e.source);
    depsMap.set(id, parents);
  }

  return computeLevelsFromDepsMap(nodeIds, depsMap);
}

/**
 * Checks whether any node at the given level index is a checkpoint node.
 * Accepts either a node array (builds Map internally) or a pre-built Map
 * for callers that check multiple levels in a loop.
 */
export function levelHasCheckpoint(
  levelNodeIds: readonly string[],
  nodesOrMap: readonly Node<DagNodeData>[] | Map<string, Node<DagNodeData>>
): boolean {
  const nodeMap = nodesOrMap instanceof Map
    ? nodesOrMap
    : new Map(nodesOrMap.map((n) => [n.id, n]));
  return levelNodeIds.some((id) => {
    const node = nodeMap.get(id);
    return node?.data?.checkpoint === true;
  });
}

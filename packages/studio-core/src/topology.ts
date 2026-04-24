/**
 * Core topology algorithm: computes topological levels from a dependency map.
 * Nodes at level 0 have no dependencies. Nodes at level N depend on at least
 * one node at level N-1 (or lower).
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

  const maxLevel = nodeIds.size > 0
    ? Math.max(...Array.from(nodeIds).map((id) => levelCache.get(id) ?? 0))
    : -1;

  const levels: string[][] = [];
  for (let i = 0; i <= maxLevel; i++) {
    const nodesAtLevel = Array.from(nodeIds).filter(
      (id) => (levelCache.get(id) ?? 0) === i,
    );
    levels.push(nodesAtLevel);
  }

  return levels;
}

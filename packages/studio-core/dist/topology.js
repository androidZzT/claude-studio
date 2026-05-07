"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeLevelsFromDepsMap = computeLevelsFromDepsMap;
/**
 * Core topology algorithm: computes topological levels from a dependency map.
 * Nodes at level 0 have no dependencies. Nodes at level N depend on at least
 * one node at level N-1 (or lower).
 */
function computeLevelsFromDepsMap(nodeIds, depsMap) {
    const levelCache = new Map();
    function getLevel(id) {
        const cached = levelCache.get(id);
        if (cached !== undefined)
            return cached;
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
    const levels = [];
    for (let i = 0; i <= maxLevel; i++) {
        const nodesAtLevel = Array.from(nodeIds).filter((id) => (levelCache.get(id) ?? 0) === i);
        levels.push(nodesAtLevel);
    }
    return levels;
}
//# sourceMappingURL=topology.js.map
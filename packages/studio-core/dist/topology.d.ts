/**
 * Core topology algorithm: computes topological levels from a dependency map.
 * Nodes at level 0 have no dependencies. Nodes at level N depend on at least
 * one node at level N-1 (or lower).
 */
export declare function computeLevelsFromDepsMap(nodeIds: ReadonlySet<string>, depsMap: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[];

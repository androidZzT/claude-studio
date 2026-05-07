import type { TechDesignConformanceInput } from "../types.js";

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function scoreTechDesignConformance(input?: TechDesignConformanceInput | null): number | null {
  if (!input || input.totalRules <= 0 || input.violations < 0) {
    return null;
  }

  return clampUnitInterval(1 - input.violations / input.totalRules);
}

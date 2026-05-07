import type { FirstPassRateInput } from "../types.js";

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function scoreFirstPassRate(input?: FirstPassRateInput | null): number | null {
  if (!input || input.totalPRs <= 0 || input.firstPassPRs < 0) {
    return null;
  }

  return clampUnitInterval(input.firstPassPRs / input.totalPRs);
}

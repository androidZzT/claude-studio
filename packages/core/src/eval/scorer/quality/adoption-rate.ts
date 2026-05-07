import type { AdoptionRateInput } from "../types.js";

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function scoreAdoptionRate(input?: AdoptionRateInput | null): number | null {
  if (!input || input.aiProducedLines <= 0 || input.reworkLines < 0) {
    return null;
  }

  return clampUnitInterval(1 - input.reworkLines / input.aiProducedLines);
}

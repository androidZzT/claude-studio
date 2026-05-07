import type { SmokePassRateInput } from "../types.js";

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function scoreSmokePassRate(input?: SmokePassRateInput | null): number | null {
  if (!input || input.smokeTotal <= 0 || input.smokePassed < 0) {
    return null;
  }

  return clampUnitInterval(input.smokePassed / input.smokeTotal);
}

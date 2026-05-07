import type { BugDensityInput } from "../types.js";

export function scoreBugDensity(input?: BugDensityInput | null): number | null {
  if (!input || input.totalLOC <= 0 || input.bugCount < 0) {
    return null;
  }

  return input.bugCount / (input.totalLOC / 1000);
}

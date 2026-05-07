import type { ReviewPassEfficiencyInput } from "../types.js";

export function scoreReviewPassEfficiency(input?: ReviewPassEfficiencyInput | null): number | null {
  if (!input || input.reviewRound <= 0) {
    return null;
  }

  return 1 / input.reviewRound;
}

import { describe, expect, it } from "vitest";

import { scoreReviewPassEfficiency } from "../../../../src/eval/scorer/quality/index.js";

describe("scoreReviewPassEfficiency", () => {
  it("computes the reciprocal of the latest review round", () => {
    expect(scoreReviewPassEfficiency({ reviewRound: 1 })).toBe(1);
    expect(scoreReviewPassEfficiency({ reviewRound: 2 })).toBe(0.5);
  });

  it("returns null for missing or invalid rounds", () => {
    expect(scoreReviewPassEfficiency()).toBeNull();
    expect(scoreReviewPassEfficiency({ reviewRound: 0 })).toBeNull();
  });
});

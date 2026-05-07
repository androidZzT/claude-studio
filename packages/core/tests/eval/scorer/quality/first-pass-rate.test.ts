import { describe, expect, it } from "vitest";

import { scoreFirstPassRate } from "../../../../src/eval/scorer/quality/index.js";

describe("scoreFirstPassRate", () => {
  it("computes the share of first-pass PRs", () => {
    expect(scoreFirstPassRate({ firstPassPRs: 3, totalPRs: 4 })).toBe(0.75);
  });

  it("returns null for missing or invalid inputs", () => {
    expect(scoreFirstPassRate()).toBeNull();
    expect(scoreFirstPassRate({ firstPassPRs: -1, totalPRs: 4 })).toBeNull();
    expect(scoreFirstPassRate({ firstPassPRs: 1, totalPRs: 0 })).toBeNull();
  });
});

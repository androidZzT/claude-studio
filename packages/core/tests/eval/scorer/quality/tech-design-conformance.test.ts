import { describe, expect, it } from "vitest";

import { scoreTechDesignConformance } from "../../../../src/eval/scorer/quality/index.js";

describe("scoreTechDesignConformance", () => {
  it("computes the conformance ratio", () => {
    expect(scoreTechDesignConformance({ violations: 2, totalRules: 10 })).toBe(0.8);
  });

  it("clamps negative ratios to zero", () => {
    expect(scoreTechDesignConformance({ violations: 20, totalRules: 10 })).toBe(0);
  });

  it("returns null for missing or invalid inputs", () => {
    expect(scoreTechDesignConformance()).toBeNull();
    expect(scoreTechDesignConformance({ violations: -1, totalRules: 10 })).toBeNull();
    expect(scoreTechDesignConformance({ violations: 1, totalRules: 0 })).toBeNull();
  });
});

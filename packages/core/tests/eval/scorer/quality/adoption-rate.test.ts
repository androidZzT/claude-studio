import { describe, expect, it } from "vitest";

import { scoreAdoptionRate } from "../../../../src/eval/scorer/quality/index.js";

describe("scoreAdoptionRate", () => {
  it("computes adoption from produced and rework lines", () => {
    expect(scoreAdoptionRate({ aiProducedLines: 100, reworkLines: 20 })).toBe(0.8);
  });

  it("clamps heavy rework to zero", () => {
    expect(scoreAdoptionRate({ aiProducedLines: 100, reworkLines: 200 })).toBe(0);
  });

  it("returns null for missing or invalid inputs", () => {
    expect(scoreAdoptionRate()).toBeNull();
    expect(scoreAdoptionRate({ aiProducedLines: 0, reworkLines: 0 })).toBeNull();
    expect(scoreAdoptionRate({ aiProducedLines: 100, reworkLines: -1 })).toBeNull();
  });
});

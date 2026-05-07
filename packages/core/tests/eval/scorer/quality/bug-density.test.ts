import { describe, expect, it } from "vitest";

import { scoreBugDensity } from "../../../../src/eval/scorer/quality/index.js";

describe("scoreBugDensity", () => {
  it("computes bug density in bugs per KLOC", () => {
    expect(scoreBugDensity({ bugCount: 3, totalLOC: 1500 })).toBe(2);
  });

  it("returns null for missing or invalid inputs", () => {
    expect(scoreBugDensity()).toBeNull();
    expect(scoreBugDensity({ bugCount: -1, totalLOC: 1000 })).toBeNull();
    expect(scoreBugDensity({ bugCount: 1, totalLOC: 0 })).toBeNull();
  });
});

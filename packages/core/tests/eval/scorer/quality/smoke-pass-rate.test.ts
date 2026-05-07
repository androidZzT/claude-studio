import { describe, expect, it } from "vitest";

import { scoreSmokePassRate } from "../../../../src/eval/scorer/quality/index.js";

describe("scoreSmokePassRate", () => {
  it("computes the smoke pass ratio", () => {
    expect(scoreSmokePassRate({ smokePassed: 8, smokeTotal: 10 })).toBe(0.8);
  });

  it("returns null for missing or invalid inputs", () => {
    expect(scoreSmokePassRate()).toBeNull();
    expect(scoreSmokePassRate({ smokePassed: -1, smokeTotal: 10 })).toBeNull();
    expect(scoreSmokePassRate({ smokePassed: 1, smokeTotal: 0 })).toBeNull();
  });
});

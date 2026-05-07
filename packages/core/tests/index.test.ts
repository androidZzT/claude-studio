import { describe, expect, it } from "vitest";

import { BOOTSTRAP_STAGE, HarnessError, createWorkspaceSummary } from "../src/index.js";

describe("@harness/core", () => {
  it("creates an immutable workspace summary with defaults", () => {
    const summary = createWorkspaceSummary({});

    expect(summary).toEqual({
      name: "harness-cli",
      stage: BOOTSTRAP_STAGE,
      ready: false,
      nextCommand: "npm run build"
    });
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it("throws a typed error", () => {
    const error = new HarnessError("boom", "TEST_ERROR");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("TEST_ERROR");
  });
});

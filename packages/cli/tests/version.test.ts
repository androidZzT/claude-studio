import { describe, expect, it } from "vitest";

import { parseCliVersion } from "../src/version.js";

describe("parseCliVersion", () => {
  it("returns the version from package metadata", () => {
    expect(parseCliVersion('{ "version": "1.2.3" }')).toBe("1.2.3");
  });

  it("falls back when version is missing", () => {
    expect(parseCliVersion("{}")).toBe("0.0.0");
  });
});

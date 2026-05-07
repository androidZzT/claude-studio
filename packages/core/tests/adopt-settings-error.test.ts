import { afterEach, describe, expect, it, vi } from "vitest";

describe("adopt settings unexpected errors", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../src/adopt/extractors/shared.js");
  });

  it("rethrows unexpected non-HarnessError failures from the JSON reader", async () => {
    vi.doMock("../src/adopt/extractors/shared.js", () => ({
      readJsonObject: vi.fn(async () => {
        throw new Error("boom");
      })
    }));

    const { extractSettings } = await import("../src/adopt/extractors/settings.js");
    await expect(extractSettings("/tmp/source")).rejects.toThrow("boom");
  });
});

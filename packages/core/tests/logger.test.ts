import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/index.js";

function createSink() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("createLogger", () => {
  it("filters messages below the minimum level", () => {
    const sink = createSink();
    const logger = createLogger("warn", sink);

    logger.debug("ignore");
    logger.info("ignore");
    logger.warn("warned", { scope: "test" });
    logger.error("failed");

    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledWith("[warn] warned", { scope: "test" });
    expect(sink.error).toHaveBeenCalledWith("[error] failed", {});
  });

  it("uses info logging by default", () => {
    const sink = createSink();
    const logger = createLogger(undefined, sink);

    logger.info("bootstrapped");

    expect(sink.info).toHaveBeenCalledWith("[info] bootstrapped", {});
  });
});

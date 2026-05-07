import { afterEach, describe, expect, it, vi } from "vitest";

import type { CliIo } from "../src/index.js";

function createIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout(message: string): void {
        stdout.push(message);
      },
      stderr(message: string): void {
        stderr.push(message);
      }
    },
    stdout,
    stderr
  };
}

const originalStdinTty = process.stdin.isTTY;
const originalStdoutTty = process.stdout.isTTY;

describe("harness cli interactive adopt", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:readline");
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTty, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTty, configurable: true });
  });

  it("uses the default interactive prompt to derive skipped capabilities", async () => {
    let questionCount = 0;
    const createInterface = vi.fn(() => ({
      question: vi.fn((_: string, callback: (answer: string) => void) => {
        questionCount += 1;
        callback(questionCount === 1 ? "n" : "");
      }),
      close: vi.fn()
    }));
    vi.doMock("node:readline", () => ({
      default: { createInterface },
      createInterface
    }));
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const { runCli } = await import("../src/index.js");
    const { io, stdout, stderr } = createIo();
    const runAdopt = vi
      .fn()
      .mockResolvedValueOnce({
        targetDir: "/tmp/plan",
        createdFiles: ["harness.yaml"],
        detectedCapabilities: ["agents", "metrics"],
        skippedCapabilities: [],
        warnings: [],
        dryRun: true
      })
      .mockResolvedValueOnce({
        targetDir: "/tmp/final",
        createdFiles: ["harness.yaml"],
        detectedCapabilities: ["metrics"],
        skippedCapabilities: ["agents"],
        warnings: [],
        dryRun: false
      });

    const exitCode = await runCli(["adopt", "/tmp/source", "--interactive"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      runAdopt,
      async runDiff() {
        throw new Error("not used");
      },
      async runDoctor() {
        throw new Error("not used");
      },
      async runInit() {
        throw new Error("not used");
      },
      async runSync() {
        throw new Error("not used");
      }
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toBe("Interactive adopt mode:");
    expect(createInterface).toHaveBeenCalledTimes(1);
    expect(runAdopt).toHaveBeenNthCalledWith(
      2,
      "/tmp/source",
      expect.objectContaining({
        skipCapabilities: ["agents"]
      })
    );
  });

  it("fails gracefully when interactive adopt is requested without a TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    const { runCli } = await import("../src/index.js");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["adopt", "/tmp/source", "--interactive"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runAdopt() {
        return {
          targetDir: "/tmp/plan",
          createdFiles: ["harness.yaml"],
          detectedCapabilities: ["agents"],
          skippedCapabilities: [],
          warnings: [],
          dryRun: true
        };
      },
      async runDiff() {
        throw new Error("not used");
      },
      async runDoctor() {
        throw new Error("not used");
      },
      async runInit() {
        throw new Error("not used");
      },
      async runSync() {
        throw new Error("not used");
      }
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toContain("requires an interactive terminal");
  });
});

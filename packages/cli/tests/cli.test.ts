import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/index.js";

function createIo() {
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

describe("harness cli", () => {
  it("prints help by default", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli([], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Usage: harness <command> [options]");
  });

  it("prints adapters help when requested explicitly", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["help", "adapters"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Usage: harness adapters");
  });

  it("prints eval help when requested explicitly", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["help", "eval"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Usage: harness eval");
  });

  it("prints doctor output as json", async () => {
    const { io, stdout } = createIo();
    const exitCode = await runCli(["doctor", "--json"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff() {
        return { added: [], modified: [], removed: [], unchanged: [] };
      },
      async runDoctor() {
        return {
          configPath: "/tmp/harness.yaml",
          projectName: "fixture",
          tools: ["codex"],
          checks: [],
          summary: {
            pass: 2,
            fail: 0
          }
        };
      },
      async runInit() {
        throw new Error("not used");
      },
      async runSync() {
        return { added: [], modified: [], removed: [], unchanged: [] };
      }
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      projectName: "fixture",
      summary: {
        pass: 2,
        fail: 0
      }
    });
  });

  it("prints doctor output as text", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["doctor"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff() {
        return { added: [], modified: [], removed: [], unchanged: [] };
      },
      async runDoctor() {
        return {
          configPath: "/tmp/harness.yaml",
          projectName: "fixture",
          tools: ["codex"],
          checks: [
            {
              id: "node",
              kind: "command",
              status: "pass",
              message: "node 22.22.0 available"
            }
          ],
          summary: {
            pass: 1,
            fail: 0
          }
        };
      },
      async runInit() {
        throw new Error("not used");
      },
      async runSync() {
        return { added: [], modified: [], removed: [], unchanged: [] };
      }
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Doctor report for fixture");
    expect(stdout[1]).toContain("Config: /tmp/harness.yaml");
    expect(stdout[2]).toContain("[PASS] node 22.22.0 available");
  });

  it("returns a non-zero exit code for unsupported commands", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["unknown"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toContain("Unsupported command");
  });

  it("returns a non-zero exit code for unexpected extra arguments", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(["doctor", "extra"], io);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toContain("Unknown argument: extra");
  });

  it("returns an error when --config has no path", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(["doctor", "--config"], io);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toContain("Missing value for --config");
  });

  it("prints the cli version", async () => {
    const { io, stdout } = createIo();
    const exitCode = await runCli(["--version"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff() {
        return { added: [], modified: [], removed: [], unchanged: [] };
      },
      async runDoctor() {
        return {
          configPath: "",
          projectName: "",
          tools: [],
          checks: [],
          summary: {
            pass: 0,
            fail: 0
          }
        };
      },
      async runInit() {
        throw new Error("not used");
      },
      async runSync() {
        return { added: [], modified: [], removed: [], unchanged: [] };
      }
    });

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["0.1.0"]);
  });

  it("uses default dependencies for version output", async () => {
    const { io, stdout } = createIo();
    const exitCode = await runCli(["--version"], io);

    expect(exitCode).toBe(0);
    expect(stdout[0]).toBe("0.1.0");
  });

  it("uses default dependencies for config-backed doctor checks", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["doctor", "--json", "--config", "packages/core/tests/fixtures/script-check.yaml"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      projectName: "script-fixture",
      summary: {
        pass: 1,
        fail: 0
      }
    });
  });

  it("prints diff output as json", async () => {
    const { io, stdout } = createIo();
    const exitCode = await runCli(["diff", "--json"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff() {
        return {
          added: [{ path: "AGENTS.md", reason: "new" }],
          modified: [],
          removed: [],
          unchanged: []
        };
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
    expect(JSON.parse(stdout[0] ?? "{}")).toEqual({
      added: [{ path: "AGENTS.md", reason: "new" }],
      modified: [],
      removed: [],
      unchanged: []
    });
  });

  it("returns exit 1 for `diff --check` when drift exists", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["diff", "--check"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff() {
        return {
          added: [{ path: "AGENTS.md", reason: "new" }],
          modified: [],
          removed: [],
          unchanged: []
        };
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
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Drift detected.");
  });

  it("returns exit 0 for `diff --check` when the workspace is clean", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["diff", "--check", "--json"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff() {
        return {
          added: [],
          modified: [],
          removed: [],
          unchanged: [{ path: "AGENTS.md", reason: "sha256-match" }]
        };
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
    expect(JSON.parse(stdout[0] ?? "{}")).toEqual({
      added: [],
      modified: [],
      removed: [],
      unchanged: [{ path: "AGENTS.md", reason: "sha256-match" }]
    });
  });

  it("passes --no-local through to diff", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(["diff", "--no-local"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff(_configPath?: string, options?: { readonly noLocal?: boolean }) {
        expect(options?.noLocal).toBe(true);
        return {
          added: [],
          modified: [],
          removed: [],
          unchanged: []
        };
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
  });

  it("prints sync dry-run output as text", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["sync", "--dry-run"], io, {
      async loadVersion() {
        return "0.1.0";
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
      async runSync(_configPath?: string, dryRun?: boolean) {
        expect(dryRun).toBe(true);
        return {
          added: [],
          modified: [],
          removed: [],
          unchanged: [{ path: "AGENTS.md", reason: "sha256-match" }]
        };
      }
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("No drift detected.");
    expect(stdout.some((line) => line.includes("Unchanged: 1"))).toBe(true);
  });

  it("passes --adopt-settings through to sync", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["sync", "--adopt-settings", "--json"], io, {
      async loadVersion() {
        return "0.1.0";
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
      async runSync(_configPath?: string, dryRun?: boolean, options?: { readonly adoptPartialJsonOwnership?: boolean }) {
        expect(dryRun).toBe(false);
        expect(options?.adoptPartialJsonOwnership).toBe(true);
        return {
          added: [],
          modified: [{ path: ".claude/settings.json", reason: "sha256-mismatch" }],
          removed: [],
          unchanged: []
        };
      }
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toEqual({
      added: [],
      modified: [{ path: ".claude/settings.json", reason: "sha256-mismatch" }],
      removed: [],
      unchanged: []
    });
  });

  it("passes --no-local through to sync", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(["sync", "--no-local"], io, {
      async loadVersion() {
        return "0.1.0";
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
      async runSync(_configPath?: string, _dryRun?: boolean, options?: { readonly noLocal?: boolean }) {
        expect(options?.noLocal).toBe(true);
        return {
          added: [],
          modified: [],
          removed: [],
          unchanged: []
        };
      }
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
  });

  it("prints init help text", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["init", "--help"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Usage: harness init [name]");
  });

  it("prints init output as json", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["init", "demo", "--json"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      async runDiff() {
        throw new Error("not used");
      },
      async runDoctor() {
        throw new Error("not used");
      },
      async runInit(options) {
        expect(options.scope).toBe("project");
        expect(options.force).toBe(false);
        expect(options.targetDir).toMatch(/demo$/);
        return {
          targetDir: options.targetDir,
          createdFiles: ["harness.yaml"],
          skippedFiles: []
        };
      },
      async runSync() {
        throw new Error("not used");
      }
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toEqual({
      createdFiles: ["harness.yaml"],
      skippedFiles: [],
      targetDir: expect.stringMatching(/demo$/)
    });
  });

  it("rejects ambiguous init targets", async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(["init", "demo", "--in-place"], io);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toContain("Cannot use [name] together with --in-place");
  });

  it("uses interactive capability selections to refine adopt output", async () => {
    const { io, stdout } = createIo();
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
        detectedCapabilities: ["agents"],
        skippedCapabilities: ["metrics"],
        warnings: [],
        dryRun: false
      });

    const exitCode = await runCli(["adopt", "/tmp/source", "--interactive"], io, {
      async loadVersion() {
        return "0.1.0";
      },
      promptAdoptCapabilities: vi.fn(async () => ["metrics"]),
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
    expect(runAdopt).toHaveBeenNthCalledWith(
      1,
      "/tmp/source",
      expect.objectContaining({
        dryRun: true,
        interactive: true,
        skipCapabilities: []
      })
    );
    expect(runAdopt).toHaveBeenNthCalledWith(
      2,
      "/tmp/source",
      expect.objectContaining({
        dryRun: false,
        interactive: true,
        skipCapabilities: ["metrics"]
      })
    );
    expect(stdout[0]).toContain("Adopted harness workspace in /tmp/final");
  });
});

import { access, mkdtemp, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);

  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

describe.sequential("harness init integration", () => {
  it("scaffolds a named target, then blocks the same target without force", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-cli-init-"));

    await withCwd(tempRoot, async () => {
      const first = createIo();
      const firstExitCode = await runCli(["init", "test-init"], first.io);

      expect(firstExitCode).toBe(0);
      await expect(access(path.join(tempRoot, "test-init", "harness.yaml"))).resolves.toBeUndefined();
      await expect(access(path.join(tempRoot, "test-init", "AGENTS.md.template"))).resolves.toBeUndefined();
      await expect(access(path.join(tempRoot, "test-init", ".codex/config.toml.template"))).resolves.toBeUndefined();
      await expect(access(path.join(tempRoot, "test-init", ".gitignore"))).resolves.toBeUndefined();
      await expect(access(path.join(tempRoot, "test-init", "README.md"))).resolves.toBeUndefined();
      await expect(readFile(path.join(tempRoot, "test-init", "AGENTS.md.template"), "utf8")).resolves.toContain(
        "harness-generated AGENTS.md"
      );

      const second = createIo();
      const secondExitCode = await runCli(["init", "test-init"], second.io);

      expect(secondExitCode).toBe(1);
      expect(second.stderr[0]).toContain("harness.yaml");

      const forced = createIo();
      const forcedExitCode = await runCli(["init", "test-init", "--force"], forced.io);

      expect(forcedExitCode).toBe(0);
    });
  });

  it("supports in-place init json output and scope=global", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-cli-init-json-"));

    await withCwd(tempRoot, async () => {
      const { io, stdout, stderr } = createIo();
      const exitCode = await runCli(["init", "--in-place", "--scope", "global", "--json"], io);
      const resolvedTempRoot = await realpath(tempRoot);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout[0] ?? "{}")).toEqual({
        createdFiles: [
          ".codex/config.toml.template",
          ".gitignore",
          "AGENTS.md.template",
          "README.md",
          "harness.yaml"
        ],
        skippedFiles: [],
        targetDir: resolvedTempRoot
      });
      await expect(readFile(path.join(tempRoot, "harness.yaml"), "utf8")).resolves.toContain("scope: global");
    });
  });

  it("closes the init -> sync -> diff -> sync loop with zero drift", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-cli-init-e2e-"));
    const demoDir = path.join(tempRoot, "demo");

    await withCwd(tempRoot, async () => {
      const initIo = createIo();
      expect(await runCli(["init", "demo"], initIo.io)).toBe(0);
    });

    await withCwd(demoDir, async () => {
      const syncFirst = createIo();
      expect(await runCli(["sync"], syncFirst.io)).toBe(0);
      expect(syncFirst.stdout[0]).toContain("Sync completed.");
      expect(syncFirst.stdout.some((line) => line.includes("Added: 2"))).toBe(true);

      const diffIo = createIo();
      expect(await runCli(["diff", "--json"], diffIo.io)).toBe(0);
      expect(JSON.parse(diffIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [],
        removed: [],
        unchanged: [
          { path: ".codex/config.toml", reason: "sha256-match" },
          { path: "AGENTS.md", reason: "sha256-match" }
        ]
      });

      const syncSecond = createIo();
      expect(await runCli(["sync"], syncSecond.io)).toBe(0);
      expect(syncSecond.stdout[0]).toContain("Sync completed with no changes.");
    });
  });
});

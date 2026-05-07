import { access, cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseHarnessConfig } from "@harness/core";

import { runCli } from "../src/index.js";

const fixtureRoot = path.resolve("packages/core/tests/fixtures/mini-claude-dir");

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

async function createSourceWorkspace(): Promise<{ root: string; sourceDir: string; harnessDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-adopt-cli-"));
  const sourceDir = path.join(root, "source");
  const harnessDir = path.join(root, "mini-harness");
  await cp(fixtureRoot, sourceDir, { recursive: true });
  return { root, sourceDir, harnessDir };
}

describe.sequential("adopt integration", () => {
  it("adopts a mini .claude fixture into a harness repo and produces a valid harness config", async () => {
    const { root, sourceDir, harnessDir } = await createSourceWorkspace();

    await withCwd(root, async () => {
      const io = createIo();
      expect(await runCli(["adopt", sourceDir, "--output", harnessDir, "--name", "mini-harness"], io.io)).toBe(0);
    });

    await expect(access(path.join(harnessDir, "harness.yaml"))).resolves.toBeUndefined();
    await expect(access(path.join(harnessDir, "agents", "code-reviewer.md"))).resolves.toBeUndefined();
    await expect(access(path.join(harnessDir, "skills", "demo-skill", "SKILL.md"))).resolves.toBeUndefined();
    await expect(access(path.join(harnessDir, "docs", "architecture", "adr", "ADR-001.md"))).resolves.toBeUndefined();
    await expect(access(path.join(harnessDir, "metrics", "events.schema.md"))).resolves.toBeUndefined();
    await expect(access(path.join(harnessDir, "metrics", "events.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });

    const config = parseHarnessConfig(await readFile(path.join(harnessDir, "harness.yaml"), "utf8"));
    expect(config.name).toBe("mini-harness");
    expect(config.adapters["claude-code"]?.capabilities).toEqual([
      "agents",
      "skills",
      "rules",
      "scripts",
      "commands",
      "hooks",
      "mcp",
      "plugins",
      "reference_projects",
      "docs",
      "metrics"
    ]);
  });

  it("supports dry-run without writing the target directory", async () => {
    const { root, sourceDir, harnessDir } = await createSourceWorkspace();

    await withCwd(root, async () => {
      const io = createIo();
      expect(await runCli(["adopt", sourceDir, "--output", harnessDir, "--dry-run", "--json"], io.io)).toBe(0);
      const result = JSON.parse(io.stdout[0] ?? "{}") as { dryRun: boolean; createdFiles: string[] };
      expect(result.dryRun).toBe(true);
      expect(result.createdFiles).toContain("harness.yaml");
    });

    await expect(access(harnessDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aborts when the target exists unless --force is provided", async () => {
    const { root, sourceDir, harnessDir } = await createSourceWorkspace();

    await withCwd(root, async () => {
      const firstIo = createIo();
      expect(await runCli(["adopt", sourceDir, "--output", harnessDir], firstIo.io)).toBe(0);

      const secondIo = createIo();
      expect(await runCli(["adopt", sourceDir, "--output", harnessDir], secondIo.io)).toBe(1);
      expect(secondIo.stderr[0]).toContain("--force");

      const forceIo = createIo();
      expect(await runCli(["adopt", sourceDir, "--output", harnessDir, "--force"], forceIo.io)).toBe(0);
    });
  });

  it("supports capability skips such as --skip metrics", async () => {
    const { root, sourceDir, harnessDir } = await createSourceWorkspace();

    await withCwd(root, async () => {
      const io = createIo();
      expect(await runCli(["adopt", sourceDir, "--output", harnessDir, "--skip", "metrics"], io.io)).toBe(0);
    });

    await expect(access(path.join(harnessDir, "metrics"))).rejects.toMatchObject({ code: "ENOENT" });
    const config = parseHarnessConfig(await readFile(path.join(harnessDir, "harness.yaml"), "utf8"));
    expect(config.adapters["claude-code"]?.capabilities).not.toContain("metrics");
  });

  it("round-trips the adopted harness back into the source workspace with zero drift", async () => {
    const { root, sourceDir, harnessDir } = await createSourceWorkspace();

    await withCwd(root, async () => {
      const adoptIo = createIo();
      expect(await runCli(["adopt", sourceDir, "--output", harnessDir, "--name", "mini-harness"], adoptIo.io)).toBe(0);
    });

    await withCwd(sourceDir, async () => {
      const diffIo = createIo();
      expect(await runCli(["diff", "--harness-repo", harnessDir, "--json"], diffIo.io)).toBe(0);
      expect(JSON.parse(diffIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [],
        removed: [],
        unchanged: [
          { path: ".claude/agents/code-reviewer.md", reason: "sha256-match" },
          { path: ".claude/commands/review.md", reason: "sha256-match" },
          { path: ".claude/docs/architecture/adr/ADR-001.md", reason: "sha256-match" },
          { path: ".claude/docs/README.md", reason: "sha256-match" },
          { path: ".claude/metrics/events.schema.md", reason: "sha256-match" },
          { path: ".claude/reference-project.json", reason: "sha256-match" },
          { path: ".claude/rules/style.md", reason: "sha256-match" },
          { path: ".claude/rules/testing.md", reason: "sha256-match" },
          { path: ".claude/scripts/check.sh", reason: "sha256-match" },
          { path: ".claude/settings.json", reason: "sha256-match" },
          { path: ".claude/skills/demo-skill/resources/checklist.md", reason: "sha256-match" },
          { path: ".claude/skills/demo-skill/SKILL.md", reason: "sha256-match" }
        ]
      });

      const syncIo = createIo();
      expect(await runCli(["sync", "--harness-repo", harnessDir, "--adopt-settings", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}").modified).toEqual([]);
    });
  });
});

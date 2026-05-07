import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { adoptFromSource } from "../src/index.js";
import type { HarnessError } from "../src/index.js";

async function createSourceWorkspace(name = "source-workspace"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-adopt-core-"));
  const sourceDir = path.join(root, name);
  await mkdir(path.join(sourceDir, ".claude", "agents"), { recursive: true });
  await writeFile(path.join(sourceDir, ".claude", "agents", "reviewer.md"), "agent\n", "utf8");
  return sourceDir;
}

describe("adopt core", () => {
  it("rejects unsupported tools", async () => {
    const sourceDir = await createSourceWorkspace();

    await expect(adoptFromSource(sourceDir, { dryRun: true, tools: ["codex"] })).rejects.toMatchObject({
      code: "ADOPT_UNSUPPORTED_TOOL"
    } satisfies Partial<HarnessError>);
  });

  it("infers default target dir and harness name when omitted", async () => {
    const sourceDir = await createSourceWorkspace("mini-app");

    const result = await adoptFromSource(sourceDir, { dryRun: true });
    expect(result.targetDir).toBe(path.join(path.dirname(sourceDir), "mini-app-harness"));

    const written = await adoptFromSource(sourceDir, { outputDir: path.join(path.dirname(sourceDir), "mini-out") });
    expect(written.dryRun).toBe(false);

    const harnessYaml = await readFile(path.join(written.targetDir, "harness.yaml"), "utf8");
    expect(harnessYaml).toContain("name: mini-app-harness");
  });

  it("falls back to a generated AGENTS template when the source has no canonical markdown", async () => {
    const sourceDir = await createSourceWorkspace("no-template");
    const targetDir = path.join(path.dirname(sourceDir), "no-template-harness");

    await expect(access(path.join(sourceDir, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(sourceDir, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });

    await adoptFromSource(sourceDir, { outputDir: targetDir });
    const template = await readFile(path.join(targetDir, "AGENTS.md.template"), "utf8");
    expect(template).toBe(`# no-template\n\nMigrated from ${sourceDir}.\n`);
  });
});

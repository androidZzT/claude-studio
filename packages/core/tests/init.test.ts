import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDiff, runInit, runSync } from "../src/index.js";
import type { HarnessError } from "../src/index.js";

async function createTempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("runInit", () => {
  it("creates the codex scaffold in a new target directory", async () => {
    const tempRoot = await createTempRoot("harness-init-");
    const targetDir = path.join(tempRoot, "demo");

    const result = await runInit({
      force: false,
      scope: "project",
      targetDir
    });

    expect(result.targetDir).toBe(targetDir);
    expect(result.createdFiles).toEqual([
      ".codex/config.toml.template",
      ".gitignore",
      "AGENTS.md.template",
      "README.md",
      "harness.yaml"
    ]);
    expect(result.skippedFiles).toEqual([]);
    await expect(access(path.join(targetDir, "harness.yaml"))).resolves.toBeUndefined();
    await expect(access(path.join(targetDir, "AGENTS.md.template"))).resolves.toBeUndefined();
    await expect(access(path.join(targetDir, ".codex/config.toml.template"))).resolves.toBeUndefined();
    await expect(access(path.join(targetDir, ".gitignore"))).resolves.toBeUndefined();
    await expect(access(path.join(targetDir, "README.md"))).resolves.toBeUndefined();
    await expect(access(path.join(targetDir, ".harness/manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(targetDir, ".gitignore"), "utf8")).resolves.toContain("/AGENTS.md");
    await expect(readFile(path.join(targetDir, ".gitignore"), "utf8")).resolves.toContain("/.codex/config.toml");
    await expect(readFile(path.join(targetDir, "AGENTS.md.template"), "utf8")).resolves.toContain(
      "do not edit AGENTS.md directly"
    );
  });

  it("rejects a non-empty directory without force", async () => {
    const targetDir = await createTempRoot("harness-init-non-empty-");
    await writeFile(path.join(targetDir, "notes.txt"), "hello\n", "utf8");

    await expect(
      runInit({
        force: false,
        scope: "project",
        targetDir
      })
    ).rejects.toMatchObject({
      code: "INIT_TARGET_NOT_EMPTY"
    } satisfies Partial<HarnessError>);
  });

  it("rejects an existing harness target without force and names the conflicting file", async () => {
    const targetDir = await createTempRoot("harness-init-conflict-");
    await writeFile(path.join(targetDir, "harness.yaml"), "name: old\n", "utf8");

    await expect(
      runInit({
        force: false,
        scope: "project",
        targetDir
      })
    ).rejects.toMatchObject({
      code: "INIT_TARGET_CONFLICT",
      message: expect.stringContaining("harness.yaml")
    } satisfies Partial<HarnessError>);
  });

  it("overwrites an existing harness scaffold when force is true", async () => {
    const targetDir = await createTempRoot("harness-init-force-");
    await writeFile(path.join(targetDir, "harness.yaml"), "name: old\n", "utf8");
    await writeFile(path.join(targetDir, "AGENTS.md.template"), "# old\n", "utf8");
    await writeFile(path.join(targetDir, "notes.txt"), "keep\n", "utf8");

    const result = await runInit({
      force: true,
      scope: "global",
      targetDir
    });

    expect(result.createdFiles).toContain("harness.yaml");
    await expect(readFile(path.join(targetDir, "harness.yaml"), "utf8")).resolves.toContain("scope: global");
    await expect(readFile(path.join(targetDir, "notes.txt"), "utf8")).resolves.toBe("keep\n");
  });

  it("supports initializing an existing empty directory", async () => {
    const targetDir = await createTempRoot("harness-init-empty-dir-");

    const result = await runInit({
      force: false,
      scope: "project",
      targetDir
    });

    expect(result.targetDir).toBe(targetDir);
    expect(result.createdFiles).toContain("harness.yaml");
  });

  it("closes the init to sync to diff loop without precreating a manifest", async () => {
    const tempRoot = await createTempRoot("harness-init-e2e-");
    const targetDir = path.join(tempRoot, "demo");

    await runInit({
      force: false,
      scope: "project",
      targetDir
    });

    const firstSync = await runSync(targetDir);
    const diffResult = await runDiff(targetDir);
    const secondSync = await runSync(targetDir);

    expect(firstSync.added).toEqual([
      { path: ".codex/config.toml", reason: "new" },
      { path: "AGENTS.md", reason: "new" }
    ]);
    expect(firstSync.modified).toEqual([]);
    expect(firstSync.removed).toEqual([]);
    expect(diffResult.added).toEqual([]);
    expect(diffResult.modified).toEqual([]);
    expect(diffResult.removed).toEqual([]);
    expect(diffResult.unchanged).toEqual([
      { path: ".codex/config.toml", reason: "sha256-match" },
      { path: "AGENTS.md", reason: "sha256-match" }
    ]);
    expect(secondSync).toEqual(diffResult);
    await expect(access(path.join(targetDir, ".harness/manifest.json"))).resolves.toBeUndefined();
  });
});

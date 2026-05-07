import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { describe, expect, it } from "vitest";

import { loadManifest, reconcile } from "../src/index.js";
import type { PlannedFile } from "../src/index.js";

function createPlannedFile(rootDir: string, relativePath: string, content: string): PlannedFile {
  return {
    rootDir,
    path: relativePath,
    absolutePath: path.join(rootDir, relativePath),
    content,
    mode: 0o644
  };
}

describe("reconcile", () => {
  it("classifies add, modify, remove, and unchanged states", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "reconcile-"));
    await mkdir(path.join(rootDir, ".codex"), { recursive: true });
    await mkdir(path.join(rootDir, ".harness"), { recursive: true });
    await writeFile(path.join(rootDir, "existing.txt"), "match\n", "utf8");
    await writeFile(path.join(rootDir, ".codex/config.toml"), "old\n", "utf8");
    await writeFile(
      path.join(rootDir, ".harness/manifest.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          files: [
            {
              path: "existing.txt",
              sha256: "3b92a7d72d7efea9af9ef46910a8688b5a9f8560f09c89b6f0d1fb064bf30f7e",
              mode: 420
            },
            {
              path: "removed.txt",
              sha256: "0000000000000000000000000000000000000000000000000000000000000000",
              mode: 420
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await reconcile(
      [
        createPlannedFile(rootDir, "existing.txt", "match\n"),
        createPlannedFile(rootDir, ".codex/config.toml", "new\n"),
        createPlannedFile(rootDir, "new.txt", "created\n")
      ],
      { dryRun: true, rootDir }
    );

    expect(result.added).toEqual([{ path: "new.txt", reason: "new" }]);
    expect(result.modified).toEqual([{ path: ".codex/config.toml", reason: "sha256-mismatch" }]);
    expect(result.removed).toEqual([{ path: "removed.txt", reason: "manifest-owned-not-planned" }]);
    expect(result.unchanged).toEqual([{ path: "existing.txt", reason: "sha256-match" }]);
  });

  it("writes planned files and refreshes manifest on sync", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "reconcile-write-"));

    const plan = [
      createPlannedFile(rootDir, "AGENTS.md", "generated\n"),
      createPlannedFile(rootDir, ".codex/config.toml", '[shell_environment_policy]\ninherit = "core"\n')
    ];

    const result = await reconcile(plan, { dryRun: false, rootDir });
    const manifest = await loadManifest(rootDir);

    expect(result.added).toHaveLength(2);
    expect(result.modified).toHaveLength(0);
    expect(manifest.files.map((file) => file.path)).toEqual([".codex/config.toml", "AGENTS.md"]);
  });
});

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createManifestFromPlan, existingOwnedKeys, hashOwnedValues, mergeWrite, readPartial, reconcile, removePartial } from "../src/index.js";
import { sha256 } from "../src/reconciler/file-ops.js";
import type { PartialPlannedFile, PlannedFile } from "../src/index.js";

function createFullPlannedFile(rootDir: string, relativePath: string, content: string): PlannedFile {
  return {
    rootDir,
    path: relativePath,
    absolutePath: path.join(rootDir, relativePath),
    kind: "full",
    content,
    mode: 0o644
  };
}

function createPartialPlannedFile(
  rootDir: string,
  relativePath: string,
  ownedValues: Record<string, unknown>,
  mode = 0o644
): PartialPlannedFile {
  return {
    rootDir,
    path: relativePath,
    absolutePath: path.join(rootDir, relativePath),
    kind: "partial-json",
    ownedKeys: Object.keys(ownedValues).sort((left, right) => left.localeCompare(right)),
    ownedValues,
    mode
  };
}

describe("partial json merger", () => {
  it("writes pure harness fields into an empty file", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-empty-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");

    await mergeWrite(filePath, ["hooks", "mcpServers"], { hooks: { Stop: [] }, mcpServers: {} }, 0o644);

    await expect(readFile(filePath, "utf8")).resolves.toBe('{\n  "hooks": {\n    "Stop": []\n  },\n  "mcpServers": {}\n}\n');
  });

  it("preserves user key order and appends harness keys in sorted order", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-order-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{\n  "theme": "dark",\n  "fontSize": 14\n}\n', "utf8");

    await mergeWrite(filePath, ["mcpServers", "hooks"], { mcpServers: {}, hooks: { Stop: [] } }, 0o644);

    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{\n  "theme": "dark",\n  "fontSize": 14,\n  "hooks": {\n    "Stop": []\n  },\n  "mcpServers": {}\n}\n'
    );
  });

  it("replaces existing harness-managed keys while keeping user keys", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-replace-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{\n  "theme": "dark",\n  "hooks": {\n    "Stop": []\n  }\n}\n', "utf8");

    await mergeWrite(filePath, ["hooks"], { hooks: { SessionStart: [] } }, 0o644);

    await expect(readFile(filePath, "utf8")).resolves.toBe('{\n  "theme": "dark",\n  "hooks": {\n    "SessionStart": []\n  }\n}\n');
  });

  it("removes harness-managed keys while keeping user fields and deletes empty files", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-remove-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{\n  "theme": "dark",\n  "hooks": {\n    "Stop": []\n  },\n  "mcpServers": {}\n}\n', "utf8");

    await removePartial(filePath, ["hooks", "mcpServers"], 0o644);
    await expect(readFile(filePath, "utf8")).resolves.toBe('{\n  "theme": "dark"\n}\n');

    await writeFile(filePath, '{\n  "hooks": {\n    "Stop": []\n  }\n}\n', "utf8");
    await removePartial(filePath, ["hooks"], 0o644);
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads only the owned subset and hashes it canonically", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-read-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{\n  "theme": "dark",\n  "mcpServers": {\n    "beta": {},\n    "alpha": {}\n  }\n}\n', "utf8");

    const ownedSubset = await readPartial(filePath, ["hooks", "mcpServers"]);

    expect(ownedSubset).toEqual({
      mcpServers: {
        beta: {},
        alpha: {}
      }
    });
    expect(hashOwnedValues(ownedSubset)).toBe(
      hashOwnedValues({
        mcpServers: {
          alpha: {},
          beta: {}
        }
      })
    );
  });

  it("reports existing owned keys for adoption checks", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-owned-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{\n  "theme": "dark",\n  "hooks": {},\n  "mcpServers": {}\n}\n', "utf8");

    await expect(existingOwnedKeys(filePath, ["hooks", "mcpServers"])).resolves.toEqual(["hooks", "mcpServers"]);
  });

  it("fails on first ownership of an existing shared file without adoption and succeeds with adoption", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-conflict-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{\n  "theme": "dark"\n}\n', "utf8");
    const partialPlan = [createPartialPlannedFile(rootDir, ".claude/settings.json", { hooks: { SessionStart: [] } })];

    await expect(reconcile(partialPlan, { dryRun: false, rootDir })).rejects.toMatchObject({
      code: "RECONCILE_PARTIAL_OWNERSHIP_CONFLICT",
      message: expect.stringContaining("Run with --adopt-settings")
    });

    const adoptedResult = await reconcile(partialPlan, {
      dryRun: false,
      rootDir,
      adoptPartialJsonOwnership: true
    });

    expect(adoptedResult.modified).toEqual([{ path: ".claude/settings.json", reason: "sha256-mismatch" }]);
    await expect(readFile(filePath, "utf8")).resolves.toBe('{\n  "theme": "dark",\n  "hooks": {\n    "SessionStart": []\n  }\n}\n');
  });

  it("requires re-adoption when a managed shared file is replaced without any owned keys left", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-readopt-"));
    const filePath = path.join(rootDir, ".claude", "settings.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    const partialPlan = [createPartialPlannedFile(rootDir, ".claude/settings.json", { hooks: { SessionStart: [] } })];

    await reconcile(partialPlan, {
      dryRun: false,
      rootDir,
      adoptPartialJsonOwnership: true
    });
    await writeFile(filePath, '{\n  "theme": "light"\n}\n', "utf8");

    await expect(reconcile(partialPlan, { dryRun: false, rootDir })).rejects.toMatchObject({
      code: "RECONCILE_PARTIAL_OWNERSHIP_CONFLICT",
      message: expect.stringContaining("take ownership again")
    });
  });

  it("stores partial-json ownership metadata in the manifest", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-manifest-"));
    const manifest = createManifestFromPlan([
      createFullPlannedFile(rootDir, "AGENTS.md", "generated\n"),
      createPartialPlannedFile(rootDir, ".claude/settings.json", { hooks: { Stop: [] }, mcpServers: {} })
    ]);

    expect(manifest.files).toEqual([
      {
        path: ".claude/settings.json",
        kind: "partial-json",
        owned_keys: ["hooks", "mcpServers"],
        owned_sha256: hashOwnedValues({ hooks: { Stop: [] }, mcpServers: {} }),
        mode: 0o644
      },
      {
        path: "AGENTS.md",
        sha256: sha256("generated\n"),
        mode: 0o644
      }
    ]);
  });

  it("rejects duplicate planned paths before any write occurs", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "partial-json-duplicate-"));

    await expect(
      reconcile(
        [
          createFullPlannedFile(rootDir, ".claude/settings.json", "{}\n"),
          createPartialPlannedFile(rootDir, ".claude/settings.json", { hooks: { Stop: [] } })
        ],
        { dryRun: true, rootDir }
      )
    ).rejects.toMatchObject({
      code: "RECONCILE_DUPLICATE_PATH"
    });
  });
});

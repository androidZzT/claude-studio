import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HarnessError } from "../src/index.js";
import { collectRecursiveFiles, collectTopLevelMarkdownFiles, readJsonObject } from "../src/adopt/extractors/shared.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("adopt shared extractors", () => {
  it("parses JSON objects and rejects invalid or non-object JSON payloads", async () => {
    const tempDir = await createTempDir("harness-adopt-shared-json-");
    const validPath = path.join(tempDir, "valid.json");
    const invalidPath = path.join(tempDir, "invalid.json");
    const arrayPath = path.join(tempDir, "array.json");
    await writeFile(validPath, `${JSON.stringify({ ok: true })}\n`, "utf8");
    await writeFile(invalidPath, "{not json\n", "utf8");
    await writeFile(arrayPath, `${JSON.stringify(["not", "object"])}\n`, "utf8");

    await expect(readJsonObject(validPath)).resolves.toEqual({ ok: true });
    await expect(readJsonObject(invalidPath)).rejects.toMatchObject({
      code: "ADOPT_INVALID_JSON"
    } satisfies Partial<HarnessError>);
    await expect(readJsonObject(arrayPath)).rejects.toMatchObject({
      code: "ADOPT_INVALID_JSON"
    } satisfies Partial<HarnessError>);
  });

  it("collects only top-level markdown files and honors allowMissing / skipHidden", async () => {
    const tempDir = await createTempDir("harness-adopt-shared-top-level-");
    await writeFile(path.join(tempDir, "README.md"), "# readme\n", "utf8");
    await writeFile(path.join(tempDir, ".hidden.md"), "# hidden\n", "utf8");
    await writeFile(path.join(tempDir, "notes.txt"), "ignore\n", "utf8");
    await mkdir(path.join(tempDir, "nested"));
    await writeFile(path.join(tempDir, "nested", "inner.md"), "# inner\n", "utf8");

    await expect(collectTopLevelMarkdownFiles(path.join(tempDir, "missing"), "docs", { allowMissing: true })).resolves.toEqual([]);
    await expect(collectTopLevelMarkdownFiles(path.join(tempDir, "missing"), "docs")).rejects.toMatchObject({
      code: "ENOENT"
    });

    await expect(collectTopLevelMarkdownFiles(tempDir, "docs")).resolves.toMatchObject([
      {
        targetPath: "docs/README.md"
      }
    ]);

    const withHidden = await collectTopLevelMarkdownFiles(tempDir, "docs", { skipHidden: false });
    expect(withHidden.map((file) => file.targetPath)).toEqual(["docs/.hidden.md", "docs/README.md"]);
  });

  it("collects recursive files, filters paths, and warns on symlinks", async () => {
    const tempDir = await createTempDir("harness-adopt-shared-recursive-");
    await mkdir(path.join(tempDir, "nested"), { recursive: true });
    await writeFile(path.join(tempDir, "root.md"), "# root\n", "utf8");
    await writeFile(path.join(tempDir, ".hidden.md"), "# hidden\n", "utf8");
    await writeFile(path.join(tempDir, "nested", "keep.txt"), "keep\n", "utf8");
    await writeFile(path.join(tempDir, "nested", "drop.txt"), "drop\n", "utf8");
    await symlink(path.join(tempDir, "nested", "keep.txt"), path.join(tempDir, "linked.txt"));

    const warnings: string[] = [];
    const files = await collectRecursiveFiles(tempDir, "docs", {
      onWarning: (message) => warnings.push(message),
      shouldIncludeFile: (relativePath) => !relativePath.endsWith("drop.txt")
    });

    expect(files.map((file) => file.targetPath)).toEqual(["docs/nested/keep.txt", "docs/root.md"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("skip symlink");

    const includeHidden = await collectRecursiveFiles(tempDir, "docs", { skipHidden: false });
    expect(includeHidden.map((file) => file.targetPath)).toContain("docs/.hidden.md");

    await expect(collectRecursiveFiles(path.join(tempDir, "missing"), "docs", { allowMissing: true })).resolves.toEqual([]);
    await expect(collectRecursiveFiles(path.join(tempDir, "missing"), "docs")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

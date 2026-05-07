import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { HarnessError } from "../../errors.js";
import type { AdoptFile } from "../types.js";

export interface ReadOptions {
  readonly allowMissing?: boolean;
  readonly skipHidden?: boolean;
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

export async function readFileWithMode(absolutePath: string): Promise<AdoptFile> {
  const [content, fileStat] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  return {
    sourcePath: absolutePath,
    targetPath: "",
    content,
    mode: fileStat.mode & 0o777
  };
}

export async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const source = await readFile(filePath, "utf8");
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HarnessError(`Expected ${filePath} to contain a top-level JSON object.`, "ADOPT_INVALID_JSON");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw error;
    }

    if (error instanceof HarnessError) {
      throw error;
    }

    throw new HarnessError(`Failed to parse JSON from ${filePath}`, "ADOPT_INVALID_JSON");
  }
}

export async function collectTopLevelMarkdownFiles(
  sourceDir: string,
  targetDirName: string,
  options: ReadOptions = {}
): Promise<AdoptFile[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (options.allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const adoptedFiles: AdoptFile[] = [];

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || (options.skipHidden !== false && isHiddenName(entry.name))) {
      continue;
    }

    const absolutePath = path.join(sourceDir, entry.name);
    const source = await readFileWithMode(absolutePath);
    adoptedFiles.push({
      ...source,
      targetPath: path.posix.join(targetDirName, entry.name)
    });
  }

  return adoptedFiles;
}

export async function collectRecursiveFiles(
  sourceDir: string,
  targetDirName: string,
  options: {
    readonly allowMissing?: boolean;
    readonly onWarning?: (message: string) => void;
    readonly shouldIncludeFile?: (relativePath: string) => boolean;
    readonly skipHidden?: boolean;
  } = {}
): Promise<AdoptFile[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (options.allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const adoptedFiles: AdoptFile[] = [];

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (options.skipHidden !== false && isHiddenName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(sourceDir, entry.name);
    if (entry.isSymbolicLink()) {
      options.onWarning?.(`Warning: adopt skip symlink: ${absolutePath}`);
      continue;
    }

    if (entry.isDirectory()) {
      adoptedFiles.push(
        ...(await collectRecursiveFiles(absolutePath, path.posix.join(targetDirName, entry.name), options))
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.posix.join(targetDirName, entry.name);
    if (options.shouldIncludeFile && !options.shouldIncludeFile(relativePath)) {
      continue;
    }

    const source = await readFileWithMode(absolutePath);
    adoptedFiles.push({
      ...source,
      targetPath: relativePath
    });
  }

  return adoptedFiles;
}

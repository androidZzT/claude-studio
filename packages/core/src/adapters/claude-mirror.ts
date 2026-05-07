import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { HarnessError } from "../errors.js";
import type { PlannedFile } from "../sync-types.js";

import { buildGeneratedMarkdown, createPlannedFile, toPortablePath } from "./shared.js";

interface MirrorClaudeDirectoryOptions {
  readonly injectMarkdownMarkers?: boolean;
  readonly maxDepthWarning?: number;
  readonly onWarning?: (message: string) => void;
  readonly outputRoot: string;
  readonly shouldIncludeFile?: (relativePathFromSourceRoot: string) => boolean;
  readonly shouldIncludeSourcePath?: (relativeSourcePath: string) => boolean;
  readonly skipDirectoryNames?: ReadonlySet<string>;
  readonly unreadableErrorCode?: string;
  readonly unreadableErrorMessage?: (relativeSourcePath: string) => string;
  readonly warningLabel?: string;
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

function isMarkdownFile(name: string): boolean {
  return name.endsWith(".md");
}

function countPathSegments(relativePath: string): number {
  return relativePath.split("/").filter(Boolean).length;
}

function warnPathDepth(relativePath: string, options: MirrorClaudeDirectoryOptions): void {
  if (options.maxDepthWarning === undefined || options.warningLabel === undefined) {
    return;
  }

  if (countPathSegments(relativePath) > options.maxDepthWarning) {
    options.onWarning?.(
      `Warning: claude-code adapter detected deep ${options.warningLabel} path (>${options.maxDepthWarning}): ${relativePath}`
    );
  }
}

async function readSourceFileWithMode(
  absolutePath: string,
  relativeSourcePath: string,
  options: MirrorClaudeDirectoryOptions
): Promise<{ readonly mode: number; readonly sourceBytes: Uint8Array }> {
  try {
    const [sourceBytes, sourceStat] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);

    return {
      sourceBytes,
      mode: sourceStat.mode & 0o777
    };
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;

    if (errorCode === "EACCES" || errorCode === "EPERM") {
      throw new HarnessError(
        options.unreadableErrorMessage?.(relativeSourcePath) ?? `Adapter \`claude-code\` could not read source file: ${relativeSourcePath}`,
        options.unreadableErrorCode ?? "ADAPTER_SOURCE_READ_FAILED"
      );
    }

    throw error;
  }
}

export async function mirrorClaudeDirectoryTree(
  rootDir: string,
  targetRoot: string,
  sourceRootPath: string,
  directoryPath: string,
  options: MirrorClaudeDirectoryOptions
): Promise<PlannedFile[]> {
  const entries: Dirent[] = await readdir(directoryPath, { withFileTypes: true });
  const plannedFiles: PlannedFile[] = [];

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (isHiddenName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    const relativeSourcePath = toPortablePath(path.relative(rootDir, absolutePath));

    if (entry.isSymbolicLink()) {
      options.onWarning?.(`Warning: claude-code adapter skip symlink: ${relativeSourcePath}`);
      continue;
    }

    if (entry.isDirectory()) {
      if (options.skipDirectoryNames?.has(entry.name)) {
        continue;
      }

      if (options.shouldIncludeSourcePath && !options.shouldIncludeSourcePath(relativeSourcePath)) {
        continue;
      }

      plannedFiles.push(...(await mirrorClaudeDirectoryTree(rootDir, targetRoot, sourceRootPath, absolutePath, options)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePathFromSourceRoot = toPortablePath(path.relative(sourceRootPath, absolutePath));
    warnPathDepth(relativePathFromSourceRoot, options);
    if (options.shouldIncludeSourcePath && !options.shouldIncludeSourcePath(relativeSourcePath)) {
      continue;
    }

    if (options.shouldIncludeFile && !options.shouldIncludeFile(relativePathFromSourceRoot)) {
      continue;
    }

    const { sourceBytes, mode } = await readSourceFileWithMode(absolutePath, relativeSourcePath, options);
    const content =
      options.injectMarkdownMarkers === false || !isMarkdownFile(entry.name)
        ? sourceBytes
        : buildGeneratedMarkdown(Buffer.from(sourceBytes).toString("utf8"), relativeSourcePath);
    const outputRelativePath = path.posix.join(options.outputRoot, relativePathFromSourceRoot);

    plannedFiles.push(createPlannedFile(rootDir, targetRoot, outputRelativePath, content, mode));
  }

  return plannedFiles;
}

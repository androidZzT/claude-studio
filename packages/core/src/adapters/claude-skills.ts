import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type { PlannedFile } from "../sync-types.js";

import { mirrorClaudeDirectoryTree } from "./claude-mirror.js";
import { toPortablePath } from "./shared.js";
import type { AdapterPlanOptions } from "./types.js";

const SKILLS_OUTPUT_ROOT = ".claude/skills";
const SKIP_SKILL_DIRECTORY_NAMES = new Set(["node_modules"]);
const MAX_SKILL_PATH_DEPTH_WARNING = 6;

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

function isMarkdownFile(name: string): boolean {
  return name.endsWith(".md");
}

export async function planClaudeSkillsDirectory(
  rootDir: string,
  targetRoot: string,
  sourcePath: string,
  options?: AdapterPlanOptions
): Promise<PlannedFile[]> {
  const absoluteSourcePath = path.resolve(rootDir, sourcePath);
  let entries: Dirent[];

  try {
    entries = await readdir(absoluteSourcePath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const plannedFiles: PlannedFile[] = [];

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (isHiddenName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(absoluteSourcePath, entry.name);
    const relativeSourcePath = toPortablePath(path.relative(rootDir, absolutePath));

    if (entry.isSymbolicLink()) {
      options?.onWarning?.(`Warning: claude-code adapter skip symlink: ${relativeSourcePath}`);
      continue;
    }

    if (!entry.isDirectory()) {
      if (entry.isFile() && isMarkdownFile(entry.name)) {
        options?.onWarning?.(`Warning: claude-code adapter skill must be a directory: ${relativeSourcePath}`);
      }

      continue;
    }

    if (SKIP_SKILL_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

    plannedFiles.push(
      ...(await mirrorClaudeDirectoryTree(rootDir, targetRoot, absoluteSourcePath, absolutePath, {
        maxDepthWarning: MAX_SKILL_PATH_DEPTH_WARNING,
        outputRoot: SKILLS_OUTPUT_ROOT,
        skipDirectoryNames: SKIP_SKILL_DIRECTORY_NAMES,
        unreadableErrorCode: "ADAPTER_SOURCE_READ_FAILED",
        unreadableErrorMessage: (relativeSourcePath) => `Adapter \`claude-code\` could not read source file: ${relativeSourcePath}`,
        warningLabel: "skill",
        ...(options?.onWarning ? { onWarning: options.onWarning } : {})
      }))
    );
  }

  return plannedFiles;
}

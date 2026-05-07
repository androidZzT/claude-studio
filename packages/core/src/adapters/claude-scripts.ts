import { readdir } from "node:fs/promises";
import path from "node:path";

import type { PlannedFile } from "../sync-types.js";

import { mirrorClaudeDirectoryTree } from "./claude-mirror.js";
import type { AdapterPlanOptions } from "./types.js";

const SCRIPTS_OUTPUT_ROOT = ".claude/scripts";

export async function planClaudeScriptsDirectory(
  rootDir: string,
  targetRoot: string,
  sourcePath: string,
  options?: AdapterPlanOptions
): Promise<PlannedFile[]> {
  const absoluteSourcePath = path.resolve(rootDir, sourcePath);

  try {
    await readdir(absoluteSourcePath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return mirrorClaudeDirectoryTree(rootDir, targetRoot, absoluteSourcePath, absoluteSourcePath, {
    outputRoot: SCRIPTS_OUTPUT_ROOT,
    unreadableErrorCode: "ADAPTER_SOURCE_READ_FAILED",
    unreadableErrorMessage: (relativeSourcePath) => `Adapter \`claude-code\` could not read source file: ${relativeSourcePath}`,
    ...(options?.onWarning ? { onWarning: options.onWarning } : {})
  });
}

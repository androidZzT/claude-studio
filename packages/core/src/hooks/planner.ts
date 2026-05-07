import { stat } from "node:fs/promises";
import path from "node:path";

import { GENERATED_HOOK_HEADER, PRE_COMMIT_HOOK_PATH } from "../constants.js";
import type { HarnessConfig } from "../harness-config.js";
import type { PlannedFile } from "../sync-types.js";

interface HookPlannerOptions {
  readonly onWarning?: (message: string) => void;
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function createPlannedHook(rootDir: string, relativePath: string, content: string, mode: number): PlannedFile {
  const absolutePath = path.resolve(rootDir, relativePath);

  return {
    rootDir,
    path: toPortablePath(path.relative(rootDir, absolutePath)),
    absolutePath,
    content,
    mode
  };
}

function ensureTrailingNewline(source: string): string {
  return source.endsWith("\n") ? source : `${source}\n`;
}

function renderPreCommitHook(runScript: string): string {
  return [
    "#!/usr/bin/env bash",
    GENERATED_HOOK_HEADER,
    "# source: harness.yaml hooks.pre-commit",
    ensureTrailingNewline(runScript).replace(/\n$/, "")
  ].join("\n") + "\n";
}

async function hasWorkspaceGitDirectory(rootDir: string): Promise<boolean> {
  try {
    const gitPath = path.resolve(rootDir, ".git");
    const gitStat = await stat(gitPath);
    return gitStat.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function planHooks(
  config: HarnessConfig,
  rootDir: string,
  options: HookPlannerOptions = {}
): Promise<PlannedFile[]> {
  const preCommitHook = config.hooks["pre-commit"];
  if (!preCommitHook || preCommitHook.enabled === false) {
    return [];
  }

  if (!(await hasWorkspaceGitDirectory(rootDir))) {
    options.onWarning?.(`Warning: skip hook \`pre-commit\`: not a git repository at ${rootDir}`);
    return [];
  }

  return [createPlannedHook(rootDir, PRE_COMMIT_HOOK_PATH, renderPreCommitHook(preCommitHook.run), 0o755)];
}

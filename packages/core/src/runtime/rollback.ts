import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { PhaseSpec } from "./phase-executor.js";
import type { RunStorePaths } from "./run-store.js";

const execFileAsync = promisify(execFile);

export interface RollbackBaseline {
  readonly baseline_diff_path?: string;
  readonly cwd: string;
  readonly phase_id: string;
  readonly status: "captured" | "unavailable";
}

function phaseRollbackDir(paths: RunStorePaths, phaseId: string): string {
  return path.join(paths.rollbackDir, phaseId);
}

async function tryGitDiff(cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["diff", "--binary", "--", "."], {
      cwd,
      maxBuffer: 12 * 1024 * 1024,
      shell: false,
    });
    return result.stdout;
  } catch {
    return undefined;
  }
}

export async function captureRollbackBaseline(options: {
  readonly cwd: string;
  readonly paths: RunStorePaths;
  readonly phase: PhaseSpec;
}): Promise<RollbackBaseline> {
  const rollbackDir = phaseRollbackDir(options.paths, options.phase.phase_id);
  await mkdir(rollbackDir, { recursive: true });

  const diff = await tryGitDiff(options.cwd);
  const baselinePath = path.join(rollbackDir, "baseline.diff");
  if (diff === undefined) {
    const baseline: RollbackBaseline = {
      cwd: options.cwd,
      phase_id: options.phase.phase_id,
      status: "unavailable",
    };
    await writeFile(
      path.join(rollbackDir, "baseline.json"),
      `${JSON.stringify(baseline, null, 2)}\n`,
      "utf8",
    );
    return baseline;
  }

  await writeFile(baselinePath, diff, "utf8");
  const baseline: RollbackBaseline = {
    baseline_diff_path: baselinePath,
    cwd: options.cwd,
    phase_id: options.phase.phase_id,
    status: "captured",
  };
  await writeFile(
    path.join(rollbackDir, "baseline.json"),
    `${JSON.stringify(baseline, null, 2)}\n`,
    "utf8",
  );
  return baseline;
}

export async function writeRollbackRecommendation(options: {
  readonly cwd: string;
  readonly phase: PhaseSpec;
  readonly reason: string;
  readonly paths: RunStorePaths;
}): Promise<string> {
  const rollbackDir = phaseRollbackDir(options.paths, options.phase.phase_id);
  await mkdir(rollbackDir, { recursive: true });
  const rollbackPath = path.join(rollbackDir, "rollback.md");
  const baselinePath = path.join(rollbackDir, "baseline.diff");

  await writeFile(
    rollbackPath,
    [
      "# Rollback Recommendation",
      "",
      `phase_id: ${options.phase.phase_id}`,
      `reason: ${options.reason}`,
      `cwd: ${options.cwd}`,
      "",
      "Harness did not execute any destructive rollback command.",
      "",
      "## Inspect",
      "",
      "```sh",
      `cd ${JSON.stringify(options.cwd)}`,
      "git status --short",
      "git diff --stat",
      "```",
      "",
      "## Baseline",
      "",
      `Baseline diff, if captured, is stored at: ${baselinePath}`,
      "",
      "Use your normal VCS recovery process after human review. Do not run destructive reset commands without explicit approval.",
      "",
    ].join("\n"),
    "utf8",
  );

  return rollbackPath;
}

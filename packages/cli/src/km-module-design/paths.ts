import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { HarnessError } from "@harness/core";

import { requireBusinessModule } from "./args.js";
import type { KmModuleDesignArgs, WorkflowPaths } from "./types.js";

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/@%+=:,.-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function normalizeRunId(value: string | undefined): string {
  if (value) {
    return value.replaceAll(/[^A-Za-z0-9_-]/g, "-");
  }

  const now = new Date();
  const pad = (part: number): string => String(part).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export function relativeTo(root: string, target: string): string {
  const relative = path.relative(root, target);
  return relative.length === 0 ? "." : relative.split(path.sep).join("/");
}

export function resolveHarnessRepo(rawPath: string): string {
  return path.resolve(process.cwd(), rawPath);
}

export function resolveFromHarness(
  harnessRepo: string,
  rawPath: string | undefined,
): string | undefined {
  if (!rawPath) {
    return undefined;
  }

  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(harnessRepo, rawPath);
}

export function workflowPrefix(
  args: Required<Pick<KmModuleDesignArgs, "business" | "module">>,
): string {
  return `${args.business}-${args.module}-`;
}

export function buildPaths(args: KmModuleDesignArgs, runId: string): WorkflowPaths {
  const required = requireBusinessModule(args);
  const harnessRepo = resolveHarnessRepo(args.harnessRepo);
  const runDir = path.join(
    harnessRepo,
    ".harness",
    "runs",
    "km-module-design",
    `${workflowPrefix(required)}${runId}`,
  );

  return {
    harnessRepo,
    logsDir: path.join(runDir, "logs"),
    promptDir: path.join(runDir, "prompts"),
    runDir,
    specPackDir: path.join(
      harnessRepo,
      "spec-package",
      required.business,
      required.module,
      "spec-pack",
    ),
    statusDir: path.join(runDir, "status"),
  };
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExistingPaths(
  args: KmModuleDesignArgs,
): Promise<WorkflowPaths> {
  const runId = args.runId ?? (await findLatestRunId(args));
  if (!runId) {
    throw new HarnessError(
      "No km-module-design run found. Pass --run-id or run prepare first.",
      "KM_MODULE_DESIGN_RUN_NOT_FOUND",
    );
  }

  const paths = buildPaths(args, runId);
  if (!(await pathExists(paths.runDir))) {
    throw new HarnessError(
      `Run dir not found: ${paths.runDir}`,
      "KM_MODULE_DESIGN_RUN_NOT_FOUND",
    );
  }
  return paths;
}

async function findLatestRunId(
  args: KmModuleDesignArgs,
): Promise<string | undefined> {
  const required = requireBusinessModule(args);
  const harnessRepo = resolveHarnessRepo(args.harnessRepo);
  const runsDir = path.join(harnessRepo, ".harness", "runs", "km-module-design");
  if (!(await pathExists(runsDir))) {
    return undefined;
  }

  const prefix = workflowPrefix(required);
  const entries = await readdir(runsDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map(async (entry) => ({
        name: entry.name,
        stats: await stat(path.join(runsDir, entry.name)),
      })),
  );
  candidates.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  const latest = candidates[0]?.name;
  return latest ? latest.slice(prefix.length) : undefined;
}

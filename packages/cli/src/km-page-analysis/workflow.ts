import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { HarnessError } from "@harness/core";

import { requireBusinessPage } from "./args.js";
import {
  buildPaths,
  normalizeRunId,
  pathExists,
  relativeTo,
  resolveFromHarness,
} from "./paths.js";
import { buildPrompt } from "./prompts.js";
import { runProcess } from "../km-module-design/process.js";
import {
  PAGE_ANALYSIS_AGENT,
  type KmPageAnalysisArgs,
  type PageAnalysisPaths,
} from "./types.js";

export async function prepareWorkflow(
  args: KmPageAnalysisArgs,
): Promise<PageAnalysisPaths> {
  const paths = buildPaths(args, normalizeRunId(args.runId));
  await ensureCleanRun(paths.runDir, args.force);
  await ensureOutputFilesWritable(paths, args.force);
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.promptDir, { recursive: true });
  await mkdir(paths.statusDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await writeFile(
    path.join(paths.promptDir, `${PAGE_ANALYSIS_AGENT}.md`),
    buildPrompt(args, paths),
    "utf8",
  );
  await writeFile(
    path.join(paths.runDir, "workflow.yaml"),
    await workflowText(args, paths),
    "utf8",
  );
  return paths;
}

export function renderPrepareResult(paths: PageAnalysisPaths): string[] {
  return [
    `Prepared km-page-analysis workflow: ${relativeTo(paths.harnessRepo, paths.runDir)}`,
    `Output dir: ${relativeTo(paths.harnessRepo, paths.outputDir)}`,
    `Architect prompt: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, `${PAGE_ANALYSIS_AGENT}.md`))}`,
    `Expected outputs:`,
    `  - ${relativeTo(paths.harnessRepo, paths.pageAnalysisPath)}`,
    `  - ${relativeTo(paths.harnessRepo, paths.dependencyPath)}`,
  ];
}

async function ensureCleanRun(runDir: string, force: boolean): Promise<void> {
  if (!(await pathExists(runDir))) {
    return;
  }

  const entries = await readdir(runDir);
  if (entries.length === 0) {
    return;
  }

  if (!force) {
    throw new HarnessError(
      `${runDir} already exists and is not empty. Pass --force to replace this km-page-analysis run.`,
      "KM_PAGE_ANALYSIS_RUN_EXISTS",
    );
  }

  await rm(runDir, { force: true, recursive: true });
}

async function ensureOutputFilesWritable(
  paths: PageAnalysisPaths,
  force: boolean,
): Promise<void> {
  const existing = (
    await Promise.all(
      [paths.pageAnalysisPath, paths.dependencyPath].map(async (targetPath) =>
        (await pathExists(targetPath)) ? targetPath : undefined,
      ),
    )
  ).filter((targetPath): targetPath is string => Boolean(targetPath));

  if (existing.length === 0 || force) {
    return;
  }

  throw new HarnessError(
    `Page analysis output already exists: ${existing.map((targetPath) => relativeTo(paths.harnessRepo, targetPath)).join(", ")}. Pass --force to replace these files.`,
    "KM_PAGE_ANALYSIS_OUTPUT_EXISTS",
  );
}

async function workflowText(
  args: KmPageAnalysisArgs,
  paths: PageAnalysisPaths,
): Promise<string> {
  const required = requireBusinessPage(args);
  const commit = await gitCommit(args.machproRepo, paths.harnessRepo);
  return `workflow_id: km-page-analysis
business_id: ${required.business}
page_id: ${required.page}
run_dir: ${relativeTo(paths.harnessRepo, paths.runDir)}
output_dir: ${relativeTo(paths.harnessRepo, paths.outputDir)}
machpro:
  source_repo: ${args.machproRepo ?? "unresolved"}
  source_path: ${args.machproPath ?? "unresolved"}
  commit: ${commit}
agent:
  name: ${PAGE_ANALYSIS_AGENT}
  prompt: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, `${PAGE_ANALYSIS_AGENT}.md`))}
outputs:
  page_analysis: ${relativeTo(paths.harnessRepo, paths.pageAnalysisPath)}
  module_dependency: ${relativeTo(paths.harnessRepo, paths.dependencyPath)}
validation:
  - harness km-page-analysis validate --business ${required.business} --page ${required.page}
`;
}

async function gitCommit(
  repo: string | undefined,
  harnessRepo: string,
): Promise<string> {
  const repoPath = resolveFromHarness(harnessRepo, repo);
  if (!repoPath || !(await pathExists(repoPath))) {
    return "unresolved";
  }

  const result = await runProcess(
    "git",
    ["-C", repoPath, "rev-parse", "--short", "HEAD"],
    process.cwd(),
  );
  return result.exitCode === 0 ? result.stdout.trim() : "unresolved";
}

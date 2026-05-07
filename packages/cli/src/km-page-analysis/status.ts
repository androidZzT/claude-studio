import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { pathExists, relativeTo, resolveExistingPaths } from "./paths.js";
import { PAGE_ANALYSIS_AGENT, type KmPageAnalysisArgs } from "./types.js";

export async function renderStatus(args: KmPageAnalysisArgs): Promise<string[]> {
  const paths = await resolveExistingPaths(args);
  const statusPath = path.join(paths.statusDir, `${PAGE_ANALYSIS_AGENT}.md`);
  const statusLine = (await pathExists(statusPath))
    ? ((await readFile(statusPath, "utf8")).split(/\r?\n/)[0] ?? "").trim() ||
      "present"
    : "missing";

  return [
    "km-page-analysis status",
    `Run dir: ${relativeTo(paths.harnessRepo, paths.runDir)}`,
    `Output dir: ${relativeTo(paths.harnessRepo, paths.outputDir)}`,
    `Page analysis: ${await presentLine(paths.harnessRepo, paths.pageAnalysisPath)}`,
    `Module dependency: ${await presentLine(paths.harnessRepo, paths.dependencyPath)}`,
    `Agent status: ${PAGE_ANALYSIS_AGENT}: ${statusLine}`,
  ];
}

export async function cleanWorkflow(
  args: KmPageAnalysisArgs,
): Promise<string[]> {
  const paths = await resolveExistingPaths(args);
  await rm(paths.runDir, { force: true, recursive: true });
  const removed = [
    `Removed run dir: ${relativeTo(paths.harnessRepo, paths.runDir)}`,
  ];

  if (args.includeOutput) {
    await rm(paths.pageAnalysisPath, { force: true });
    await rm(paths.dependencyPath, { force: true });
    removed.push(
      `Removed page-analysis output: ${relativeTo(paths.harnessRepo, paths.pageAnalysisPath)}`,
      `Removed module-dependency output: ${relativeTo(paths.harnessRepo, paths.dependencyPath)}`,
    );
  }

  return removed;
}

async function presentLine(root: string, targetPath: string): Promise<string> {
  return `${relativeTo(root, targetPath)} (${(await pathExists(targetPath)) ? "present" : "missing"})`;
}

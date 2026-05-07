import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { pathExists, relativeTo, resolveExistingPaths } from "./paths.js";
import { ALL_PROMPT_AGENTS, type KmModuleDesignArgs } from "./types.js";

export async function renderStatus(args: KmModuleDesignArgs): Promise<string[]> {
  const paths = await resolveExistingPaths(args);
  const manifestPath = path.join(paths.specPackDir, "manifest.yaml");
  const manifest = (await pathExists(manifestPath))
    ? await readFile(manifestPath, "utf8")
    : "";
  const manifestStatus =
    /^status:\s*(.+)$/m.exec(manifest)?.[1]?.trim() ?? "missing";
  const contributorFiles = await Promise.all(
    [...ALL_PROMPT_AGENTS].map(async (agent) => {
      const statusPath = path.join(paths.statusDir, `${agent}.md`);
      if (!(await pathExists(statusPath))) {
        return `  - ${agent}: missing`;
      }
      const firstLine =
        (await readFile(statusPath, "utf8")).split(/\r?\n/)[0] ?? "";
      return `  - ${agent}: ${firstLine.trim() || "present"}`;
    }),
  );

  return [
    "km-module-design status",
    `Run dir: ${relativeTo(paths.harnessRepo, paths.runDir)}`,
    `Spec-pack: ${relativeTo(paths.harnessRepo, paths.specPackDir)}`,
    `Manifest status: ${manifestStatus}`,
    "Contributor status:",
    ...contributorFiles,
  ];
}

export async function cleanWorkflow(args: KmModuleDesignArgs): Promise<string[]> {
  const paths = await resolveExistingPaths(args);
  await rm(paths.runDir, { force: true, recursive: true });
  const removed = [
    `Removed run dir: ${relativeTo(paths.harnessRepo, paths.runDir)}`,
  ];

  if (args.includeSpecPack) {
    const moduleDir = path.dirname(paths.specPackDir);
    await rm(moduleDir, { force: true, recursive: true });
    removed.push(
      `Removed module spec-package: ${relativeTo(paths.harnessRepo, moduleDir)}`,
    );
  }

  return removed;
}

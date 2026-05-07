import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { HarnessError } from "@harness/core";

import { requireBusinessModule } from "./args.js";
import {
  buildPaths,
  normalizeRunId,
  pathExists,
  relativeTo,
  resolveFromHarness,
} from "./paths.js";
import { runProcess } from "./process.js";
import { buildPrompt } from "./prompts.js";
import {
  ALL_PROMPT_AGENTS,
  INTEGRATOR_AGENT,
  PARALLEL_AGENTS,
  type KmModuleDesignArgs,
  type WorkflowPaths,
} from "./types.js";

export async function prepareWorkflow(
  args: KmModuleDesignArgs,
): Promise<WorkflowPaths> {
  const paths = buildPaths(args, normalizeRunId(args.runId));
  await ensureCleanOutput(paths.specPackDir, args.force);
  await ensureCleanOutput(paths.runDir, args.force);
  await mkdir(paths.specPackDir, { recursive: true });
  await mkdir(paths.promptDir, { recursive: true });
  await mkdir(paths.statusDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await writeFile(
    path.join(paths.specPackDir, "manifest.yaml"),
    await manifestText(args, paths),
    "utf8",
  );

  for (const agent of ALL_PROMPT_AGENTS) {
    await writeFile(
      path.join(paths.promptDir, `${agent}.md`),
      buildPrompt(agent, args, paths),
      "utf8",
    );
  }

  await writeFile(
    path.join(paths.runDir, "workflow.yaml"),
    workflowText(args, paths),
    "utf8",
  );
  return paths;
}

export function renderPrepareResult(paths: WorkflowPaths): string[] {
  return [
    `Prepared km-module-design workflow: ${relativeTo(paths.harnessRepo, paths.runDir)}`,
    `Draft spec-pack manifest: ${relativeTo(paths.harnessRepo, path.join(paths.specPackDir, "manifest.yaml"))}`,
    "Parallel prompts:",
    ...PARALLEL_AGENTS.map(
      (agent) =>
        `  - ${agent}: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, `${agent}.md`))}`,
    ),
    `Integrator prompt: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, `${INTEGRATOR_AGENT}.md`))}`,
  ];
}

async function ensureCleanOutput(
  targetPath: string,
  force: boolean,
): Promise<void> {
  if (!(await pathExists(targetPath))) {
    return;
  }

  const entries = await readdir(targetPath);
  if (entries.length === 0) {
    return;
  }

  if (!force) {
    throw new HarnessError(
      `${targetPath} already exists and is not empty. Pass --force only when replacing a draft spec-pack.`,
      "KM_MODULE_DESIGN_OUTPUT_EXISTS",
    );
  }

  await rm(targetPath, { force: true, recursive: true });
}

async function manifestText(
  args: KmModuleDesignArgs,
  paths: WorkflowPaths,
): Promise<string> {
  const required = requireBusinessModule(args);
  const commit = await gitCommit(args.machproRepo, paths.harnessRepo);
  const architecturePath = relativeTo(
    paths.harnessRepo,
    path.join(paths.specPackDir, "architecture_design.md"),
  );

  return `business_id: ${required.business}
module_id: ${required.module}
spec_version: 1
status: draft
owner: architect
updated_at: ${new Date().toISOString().slice(0, 10)}

machpro:
  source_repo: ${args.machproRepo ?? "unresolved"}
  source_path: ${args.machproPath ?? "unresolved"}
  commit: ${commit}

design:
  architecture_design_path: ${architecturePath}
  design_status: draft

contributors:
  architect:
    agent: architect
    status: blocked
    responsibilities:
${yamlList(["architecture_design", "state_data_ui_navigation_contracts", "final_integration"])}
  machpro_parity:
    agent: machpro-parity
    status: blocked
    responsibilities:
${yamlList(["machpro_inventory", "traceability", "functional_and_analytics_facts"])}
  tester:
    agent: tester
    status: blocked
    responsibilities:
${yamlList(["acceptance_tests", "p0_p1_p2_coverage"])}

targets:
  android: ${args.androidRepo ?? "unresolved"}
  ios: ${args.iosRepo ?? "unresolved"}

workflow:
  runner: harness km-module-design
  run_dir: ${relativeTo(paths.harnessRepo, paths.runDir)}
  parallel_agents:
    - architect
    - machpro-parity
    - tester
`;
}

function workflowText(args: KmModuleDesignArgs, paths: WorkflowPaths): string {
  const required = requireBusinessModule(args);
  return `workflow_id: km-module-design
business_id: ${required.business}
module_id: ${required.module}
run_dir: ${relativeTo(paths.harnessRepo, paths.runDir)}
spec_pack_dir: ${relativeTo(paths.harnessRepo, paths.specPackDir)}
parallel_phase:
  - agent: architect
    prompt: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, "architect.md"))}
  - agent: machpro-parity
    prompt: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, "machpro-parity.md"))}
  - agent: tester
    prompt: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, "tester.md"))}
sequential_phase:
  - agent: architect
    prompt: ${relativeTo(paths.harnessRepo, path.join(paths.promptDir, "architect-integrator.md"))}
validation:
  - python3 scripts/validate-machpro-spec-pack.py ${relativeTo(paths.harnessRepo, paths.specPackDir)}
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

function yamlList(values: readonly string[], indent = 6): string {
  const padding = " ".repeat(indent);
  return values.map((value) => `${padding}- ${value}`).join("\n");
}

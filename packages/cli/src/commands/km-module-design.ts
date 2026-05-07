import { KM_MODULE_DESIGN_HELP_TEXT } from "../constants.js";
import { parseKmModuleDesignArgs } from "../km-module-design/args.js";
import { resolveExistingPaths, relativeTo } from "../km-module-design/paths.js";
import {
  assertAllSucceeded,
  launchIntegrator,
  launchParallelContributors,
  renderAgentResult,
  validateSpecPack,
} from "../km-module-design/runner.js";
import { cleanWorkflow, renderStatus } from "../km-module-design/status.js";
import type { AgentResult, CommandIo } from "../km-module-design/types.js";
import { INTEGRATOR_AGENT } from "../km-module-design/types.js";
import { prepareWorkflow, renderPrepareResult } from "../km-module-design/workflow.js";

export async function runKmModuleDesignCommand(
  argv: readonly string[],
  io: CommandIo,
): Promise<number> {
  const args = parseKmModuleDesignArgs(argv);

  if (args.command === "help") {
    io.stdout(KM_MODULE_DESIGN_HELP_TEXT);
    return 0;
  }

  if (args.command === "prepare") {
    const paths = await prepareWorkflow(args);
    writeJsonOrLines(io, args.json, paths, renderPrepareResult(paths));
    return 0;
  }

  if (args.command === "contributors") {
    const paths = await resolveExistingPaths(args);
    const results = await launchParallelContributors(paths, args);
    assertAllSucceeded(results);
    const lines = results.map((result) => renderAgentResult(paths, result));
    writeJsonOrLines(io, args.json, results, lines);
    return 0;
  }

  if (args.command === "integrate") {
    const paths = await resolveExistingPaths(args);
    const result = await launchIntegrator(paths, args);
    assertAllSucceeded([result]);
    writeJsonOrLines(io, args.json, result, [
      `${INTEGRATOR_AGENT} completed: ${relativeTo(paths.harnessRepo, result.logPath)}`,
    ]);
    return 0;
  }

  if (args.command === "run") {
    const paths = await prepareWorkflow(args);
    const contributorResults = await launchParallelContributors(paths, args);
    assertAllSucceeded(contributorResults);
    const results = await maybeIntegrate(contributorResults, paths, args);
    const lines = [
      ...renderPrepareResult(paths),
      "Agent results:",
      ...results.map(
        (result) =>
          `  - ${result.agent}: ${result.exitCode} (${relativeTo(paths.harnessRepo, result.logPath)})`,
      ),
    ];
    writeJsonOrLines(io, args.json, { paths, results }, lines);
    return 0;
  }

  if (args.command === "validate") {
    const validation = await validateSpecPack(args);
    writeJsonOrLines(io, args.json, validation, validation.lines);
    return validation.exitCode;
  }

  if (args.command === "status") {
    const lines = await renderStatus(args);
    writeJsonOrLines(io, args.json, { lines }, lines);
    return 0;
  }

  const lines = await cleanWorkflow(args);
  writeJsonOrLines(io, args.json, { lines }, lines);
  return 0;
}

async function maybeIntegrate(
  contributorResults: readonly AgentResult[],
  paths: Parameters<typeof launchIntegrator>[0],
  args: Parameters<typeof launchIntegrator>[1],
): Promise<readonly AgentResult[]> {
  const results = args.runIntegrator
    ? [...contributorResults, await launchIntegrator(paths, args)]
    : contributorResults;
  assertAllSucceeded(results);
  return results;
}

function writeJsonOrLines(
  io: CommandIo,
  json: boolean,
  value: unknown,
  lines: readonly string[],
): void {
  if (json) {
    io.stdout(JSON.stringify(value, null, 2));
    return;
  }

  for (const line of lines) {
    io.stdout(line);
  }
}

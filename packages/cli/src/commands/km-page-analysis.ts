import { KM_PAGE_ANALYSIS_HELP_TEXT } from "../constants.js";
import { parseKmPageAnalysisArgs } from "../km-page-analysis/args.js";
import { relativeTo, resolveExistingPaths } from "../km-page-analysis/paths.js";
import {
  assertSucceeded,
  launchArchitect,
  renderAgentResult,
  validatePageAnalysis,
} from "../km-page-analysis/runner.js";
import { cleanWorkflow, renderStatus } from "../km-page-analysis/status.js";
import type { CommandIo } from "../km-page-analysis/types.js";
import { prepareWorkflow, renderPrepareResult } from "../km-page-analysis/workflow.js";

export async function runKmPageAnalysisCommand(
  argv: readonly string[],
  io: CommandIo,
): Promise<number> {
  const args = parseKmPageAnalysisArgs(argv);

  if (args.command === "help") {
    io.stdout(KM_PAGE_ANALYSIS_HELP_TEXT);
    return 0;
  }

  if (args.command === "prepare") {
    const paths = await prepareWorkflow(args);
    writeJsonOrLines(io, args.json, paths, renderPrepareResult(paths));
    return 0;
  }

  if (args.command === "run") {
    const paths = await prepareWorkflow(args);
    const result = await launchArchitect(paths, args);
    assertSucceeded(result);
    const validation = await validatePageAnalysis(args);
    const lines = [
      ...renderPrepareResult(paths),
      "Agent results:",
      `  - ${renderAgentResult(paths, result)}`,
      "Validation:",
      ...validation.lines.map((line) => `  - ${line}`),
    ];
    writeJsonOrLines(io, args.json, { paths, result, validation }, lines);
    return validation.exitCode;
  }

  if (args.command === "validate") {
    const validation = await validatePageAnalysis(args);
    writeJsonOrLines(io, args.json, validation, validation.lines);
    return validation.exitCode;
  }

  if (args.command === "status") {
    const lines = await renderStatus(args);
    writeJsonOrLines(io, args.json, { lines }, lines);
    return 0;
  }

  const paths = await resolveExistingPaths(args);
  const lines = await cleanWorkflow(args);
  writeJsonOrLines(io, args.json, { lines }, [
    ...lines,
    `Output dir preserved: ${relativeTo(paths.harnessRepo, paths.outputDir)}`,
  ]);
  return 0;
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

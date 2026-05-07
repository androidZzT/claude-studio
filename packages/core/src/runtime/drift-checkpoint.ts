import { writeFile } from "node:fs/promises";
import path from "node:path";

import { runCheckpoint } from "./checkpoint.js";
import type { CheckpointJudge, RunCheckpointResult } from "./checkpoint.js";
import type { RunStorePaths } from "./run-store.js";

export interface DriftPhaseOutput {
  readonly output_md: string;
  readonly phase_id: string;
}

export interface BuildDriftPromptOptions {
  readonly briefMd: string;
  readonly maxInputChars?: number;
  readonly phaseGraphSummary: string;
  readonly phaseOutputs: readonly DriftPhaseOutput[];
}

export interface RunDriftCheckpointOptions extends BuildDriftPromptOptions {
  readonly checkpointId: string;
  readonly judge: CheckpointJudge;
  readonly model?: string;
  readonly paths: RunStorePaths;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_INPUT_CHARS = 50_000;
const MAX_PHASE_OUTPUT_CHARS = 10_000;

function truncatePhaseOutput(source: string): string {
  if (source.length <= MAX_PHASE_OUTPUT_CHARS) {
    return source;
  }

  return `${source.slice(0, MAX_PHASE_OUTPUT_CHARS)}\n\n[truncated by harness drift checkpoint]\n`;
}

function summarizeMarkdown(source: string): string {
  const headings = source
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .join("\n");
  const prefix = source.slice(0, 2000);

  return [headings ? `Headings:\n${headings}` : "Headings: none", "", `Prefix:\n${prefix}`].join("\n");
}

function renderPrompt(options: BuildDriftPromptOptions, summarizeOutputs: boolean): string {
  const phaseOutputSections = options.phaseOutputs.map((phaseOutput) => {
    const content = summarizeOutputs ? summarizeMarkdown(phaseOutput.output_md) : truncatePhaseOutput(phaseOutput.output_md);
    return [`## Phase Output: ${phaseOutput.phase_id}`, "", content].join("\n");
  });

  return [
    "# Drift Checkpoint",
    "",
    "Decide whether the completed phases still match the original brief and phase graph. Return only JSON.",
    "",
    "Allowed decisions: go, escalate. Do not return revise.",
    "",
    "## Original Brief",
    "",
    options.briefMd,
    "",
    "## Phase Graph",
    "",
    options.phaseGraphSummary,
    "",
    ...phaseOutputSections
  ].join("\n");
}

export function buildDriftCheckpointPrompt(options: BuildDriftPromptOptions): string {
  const maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  const fullPrompt = renderPrompt(options, false);

  if (fullPrompt.length <= maxInputChars) {
    return fullPrompt;
  }

  const summarizedPrompt = renderPrompt(options, true);
  if (summarizedPrompt.length <= maxInputChars) {
    return summarizedPrompt;
  }

  return `${summarizedPrompt.slice(0, maxInputChars)}\n\n[truncated by harness drift checkpoint budget]\n`;
}

export async function runDriftCheckpoint(options: RunDriftCheckpointOptions): Promise<RunCheckpointResult> {
  const prompt = buildDriftCheckpointPrompt(options);
  const result = await runCheckpoint({
    checkpointId: options.checkpointId,
    deterministicSignals: {
      compile_pass: true,
      test_pass: true,
      lint_pass: true,
      diff_check_pass: true,
      reviewer_critical_count: 0,
      drift_check_pass: true
    },
    judge: options.judge,
    ...(options.model !== undefined ? { model: options.model } : {}),
    paths: options.paths,
    previousPhaseModelClass: "drift",
    prompt,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });

  if (result.decision.decision !== "revise") {
    return result;
  }

  const driftDecision: RunCheckpointResult = {
    ...result,
    decision: {
      decision: "escalate",
      confidence: result.decision.confidence,
      reasoning: "Drift checkpoint returned revise, which is not allowed.",
      semantic_findings: result.decision.semantic_findings,
      escalate_question_md: "Drift checkpoint returned revise. Please decide whether the run should continue or stop."
    }
  };

  await writeFile(path.join(options.paths.checkpointsDir, options.checkpointId, "decision.json"), `${JSON.stringify(driftDecision, null, 2)}\n`, "utf8");
  return driftDecision;
}

import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { HarnessError } from "../errors.js";
import { getRunStorePaths } from "../runtime/run-store.js";
import { inspectRunStore } from "../runtime/run-report.js";
import { runAutonomousExecution } from "../runtime/autonomous-run.js";

const evalScenarioSchema = z
  .object({
    compound: z.string().trim().min(1).optional(),
    deterministic_assertions: z.array(z.record(z.unknown())).default([]),
    expected_artifacts: z.array(z.string().trim().min(1)).default([]),
    prompt: z.string().trim().min(1).optional(),
    scenario_id: z.string().trim().min(1).optional(),
    skill: z.string().trim().min(1).optional(),
    task_card: z.string().trim().min(1),
    thread_id: z.string().trim().min(1).optional(),
  })
  .strict();

export type EvalScenario = z.infer<typeof evalScenarioSchema>;

export interface EvalScenarioRunOptions {
  readonly harnessRepoPath?: string;
  readonly scenarioId: string;
}

export interface EvalScenarioRunResult {
  readonly run_root: string;
  readonly scenario_id: string;
  readonly status: string;
  readonly thread_id: string;
}

export interface EvalCompareMetrics {
  readonly checkpoint_recovery_rate: number;
  readonly estimated_cost_usd: number;
  readonly off_policy_edit_rate: number;
  readonly p50_latency_ms: number;
  readonly p95_latency_ms: number;
  readonly task_success_rate: number;
  readonly tests_green_rate: number;
  readonly total_tokens: number;
  readonly trace_completeness: number;
}

export interface EvalCompareResult {
  readonly base: EvalCompareMetrics;
  readonly head: EvalCompareMetrics;
  readonly regression: boolean;
  readonly verdict: "pass" | "regression";
}

function scenarioPathFor(harnessRepoPath: string, scenarioId: string): string {
  if (scenarioId.endsWith(".yaml") || scenarioId.endsWith(".yml")) {
    return path.resolve(harnessRepoPath, scenarioId);
  }

  return path.join(harnessRepoPath, "evals", "scenarios", `${scenarioId}.yaml`);
}

async function loadScenario(
  harnessRepoPath: string,
  scenarioId: string,
): Promise<{ readonly path: string; readonly scenario: EvalScenario }> {
  const scenarioPath = scenarioPathFor(harnessRepoPath, scenarioId);
  const source = await readFile(scenarioPath, "utf8");
  const scenario = evalScenarioSchema.parse(YAML.parse(source));
  if (!scenario.compound && !scenario.skill) {
    throw new HarnessError(
      "Eval scenario must declare either compound or skill.",
      "EVAL_SCENARIO_SKILL_MISSING",
    );
  }

  return { path: scenarioPath, scenario };
}

export async function runEvalScenario(
  cwd: string,
  options: EvalScenarioRunOptions,
): Promise<EvalScenarioRunResult> {
  const harnessRepoPath = path.resolve(cwd, options.harnessRepoPath ?? ".");
  const loaded = await loadScenario(harnessRepoPath, options.scenarioId);
  const taskCardPath = path.resolve(
    path.dirname(loaded.path),
    loaded.scenario.task_card,
  );
  const report = await runAutonomousExecution(cwd, {
    ...(loaded.scenario.compound
      ? { compoundName: loaded.scenario.compound }
      : {}),
    harnessRepoPath,
    ...(loaded.scenario.prompt ? { prompt: loaded.scenario.prompt } : {}),
    ...(loaded.scenario.skill ? { skillPath: loaded.scenario.skill } : {}),
    taskCardPath,
    ...(loaded.scenario.thread_id
      ? { threadId: loaded.scenario.thread_id }
      : {}),
  });

  return {
    run_root: report.run_root,
    scenario_id: loaded.scenario.scenario_id ?? options.scenarioId,
    status: report.status,
    thread_id: report.thread_id,
  };
}

async function readEstimatedCost(runRoot: string): Promise<number> {
  try {
    const state = JSON.parse(
      await readFile(path.join(runRoot, "state.json"), "utf8"),
    ) as { readonly estimated_dollars?: number };
    return state.estimated_dollars ?? 0;
  } catch {
    return 0;
  }
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[index] ?? 0;
}

async function metricsForRun(runRoot: string): Promise<EvalCompareMetrics> {
  const report = await inspectRunStore(getRunStorePaths(runRoot));
  const phaseCount = report.phases.length;
  const completedCount = report.phases.filter(
    (phase) => phase.status === "completed",
  ).length;
  const traceCount = report.phases.filter(
    (phase) => phase.trajectory?.status === "captured",
  ).length;
  const offPolicyCount = report.phases.filter(
    (phase) => phase.validation?.result_status === "critical",
  ).length;
  const durations = report.phases
    .map((phase) => phase.duration_ms ?? 0)
    .filter((duration) => duration > 0);
  const totalTokens = report.phases.reduce(
    (total, phase) => total + (phase.trajectory?.total_tokens ?? 0),
    0,
  );

  return {
    checkpoint_recovery_rate: report.liveness === "terminal" ? 1 : 0,
    estimated_cost_usd: await readEstimatedCost(runRoot),
    off_policy_edit_rate: phaseCount === 0 ? 0 : offPolicyCount / phaseCount,
    p50_latency_ms: percentile(durations, 50),
    p95_latency_ms: percentile(durations, 95),
    task_success_rate: completedCount === phaseCount && phaseCount > 0 ? 1 : 0,
    tests_green_rate: phaseCount === 0 ? 0 : completedCount / phaseCount,
    total_tokens: totalTokens,
    trace_completeness: phaseCount === 0 ? 0 : traceCount / phaseCount,
  };
}

export async function compareEvalRuns(options: {
  readonly baseRunRoot: string;
  readonly headRunRoot: string;
}): Promise<EvalCompareResult> {
  const [base, head] = await Promise.all([
    metricsForRun(path.resolve(options.baseRunRoot)),
    metricsForRun(path.resolve(options.headRunRoot)),
  ]);
  const regression =
    head.task_success_rate < base.task_success_rate ||
    head.tests_green_rate < base.tests_green_rate ||
    head.off_policy_edit_rate > base.off_policy_edit_rate;

  return {
    base,
    head,
    regression,
    verdict: regression ? "regression" : "pass",
  };
}

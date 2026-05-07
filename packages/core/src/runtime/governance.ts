import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TaskCard } from "./task-card.js";
import { isPathAllowedByTaskCard } from "./task-card.js";
import type { PhaseResultArtifact } from "./phase-result.js";
import { phaseResultArtifactSchema } from "./phase-result.js";
import type { PhaseExecutionResult, PhaseSpec } from "./phase-executor.js";
import type { RunStorePaths } from "./run-store.js";

export interface GovernanceFinding {
  readonly code: string;
  readonly message: string;
  readonly severity: "critical" | "warning";
}

export interface BudgetReport {
  readonly critical_count: number;
  readonly findings: readonly GovernanceFinding[];
  readonly phase_id: string;
  readonly status: "pass" | "critical";
}

export interface RiskReport {
  readonly critical_count: number;
  readonly findings: readonly GovernanceFinding[];
  readonly phase_id: string;
  readonly status: "pass" | "escalate";
}

const DEPENDENCY_OR_CI_PATH_PATTERN =
  /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Podfile|Podfile\.lock|Gemfile|Gemfile\.lock|build\.gradle|build\.gradle\.kts|settings\.gradle|settings\.gradle\.kts|\.github\/workflows\/|ci\/|scripts\/release|release\/)/i;

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readPhaseResultArtifact(
  paths: RunStorePaths,
  phaseId: string,
): Promise<PhaseResultArtifact | undefined> {
  const raw = await readJsonIfExists(
    path.join(paths.phasesDir, phaseId, "result.json"),
  );
  return raw === undefined
    ? undefined
    : phaseResultArtifactSchema.parse(raw);
}

async function readPhaseCost(
  paths: RunStorePaths,
  phaseId: string,
): Promise<number> {
  const raw = (await readJsonIfExists(
    path.join(paths.phasesDir, phaseId, "cost.json"),
  )) as { readonly dollars?: number } | undefined;
  return raw?.dollars ?? 0;
}

function budgetPath(paths: RunStorePaths, phaseId: string): string {
  return path.join(paths.validationDir, phaseId, "budget.json");
}

function riskPath(paths: RunStorePaths, phaseId: string): string {
  return path.join(paths.validationDir, phaseId, "risk.json");
}

export function applyTaskCardTimeout(
  phase: PhaseSpec,
  taskCard: TaskCard | undefined,
): PhaseSpec {
  const timeoutSeconds = taskCard?.budget.timeout_seconds;
  if (timeoutSeconds === undefined) {
    return phase;
  }

  const existing = phase.provider_stall_timeout_seconds;
  return {
    ...phase,
    provider_stall_timeout_seconds:
      existing === undefined ? timeoutSeconds : Math.min(existing, timeoutSeconds),
  };
}

export async function evaluateBudget(options: {
  readonly paths: RunStorePaths;
  readonly phaseResult: PhaseExecutionResult;
  readonly taskCard?: TaskCard;
}): Promise<BudgetReport> {
  const budget = options.taskCard?.budget;
  const findings: GovernanceFinding[] = [];
  if (budget) {
    const dollars = await readPhaseCost(
      options.paths,
      options.phaseResult.phase_id,
    );
    const totalTokens = options.phaseResult.trajectory_summary?.total_tokens ?? 0;
    const toolCalls =
      options.phaseResult.trajectory_summary?.tool_call_count ?? 0;

    if (
      budget.max_cost_usd !== undefined &&
      dollars > budget.max_cost_usd
    ) {
      findings.push({
        code: "max_cost_usd_exceeded",
        message: `phase cost ${dollars} exceeded max_cost_usd ${budget.max_cost_usd}`,
        severity: "critical",
      });
    }

    if (budget.max_tokens !== undefined && totalTokens > budget.max_tokens) {
      findings.push({
        code: "max_tokens_exceeded",
        message: `phase tokens ${totalTokens} exceeded max_tokens ${budget.max_tokens}`,
        severity: "critical",
      });
    }

    if (
      budget.max_tool_calls !== undefined &&
      toolCalls > budget.max_tool_calls
    ) {
      findings.push({
        code: "max_tool_calls_exceeded",
        message: `phase tool calls ${toolCalls} exceeded max_tool_calls ${budget.max_tool_calls}`,
        severity: "critical",
      });
    }
  }

  const criticalCount = findings.filter(
    (finding) => finding.severity === "critical",
  ).length;
  const report: BudgetReport = {
    critical_count: criticalCount,
    findings,
    phase_id: options.phaseResult.phase_id,
    status: criticalCount > 0 ? "critical" : "pass",
  };
  await writeJson(budgetPath(options.paths, options.phaseResult.phase_id), report);
  return report;
}

export async function evaluateRisk(options: {
  readonly paths: RunStorePaths;
  readonly phaseResult: PhaseExecutionResult;
  readonly taskCard?: TaskCard;
}): Promise<RiskReport> {
  const artifact = await readPhaseResultArtifact(
    options.paths,
    options.phaseResult.phase_id,
  );
  const findings: GovernanceFinding[] = [];

  if (options.taskCard && artifact) {
    for (const changedFile of artifact.changed_files) {
      if (!isPathAllowedByTaskCard(options.taskCard, changedFile)) {
        findings.push({
          code: "off_policy_edit",
          message: `changed file is outside allowed_paths: ${changedFile}`,
          severity: "critical",
        });
      }

      if (DEPENDENCY_OR_CI_PATH_PATTERN.test(changedFile)) {
        findings.push({
          code: "dependency_or_ci_change",
          message: `dependency, CI, or release path changed: ${changedFile}`,
          severity: "critical",
        });
      }
    }
  }

  if (artifact) {
    for (const riskFlag of artifact.risk_flags) {
      const normalized = riskFlag.toLowerCase();
      if (
        normalized.includes("network") ||
        normalized.includes("dependency") ||
        normalized.includes("ci") ||
        normalized.includes("test_failed") ||
        normalized.includes("tests_red") ||
        normalized.includes("retry")
      ) {
        findings.push({
          code: "risk_flag_requires_review",
          message: `risk flag requires escalation: ${riskFlag}`,
          severity: "critical",
        });
      }
    }
  }

  const criticalCount = findings.filter(
    (finding) => finding.severity === "critical",
  ).length;
  const report: RiskReport = {
    critical_count: criticalCount,
    findings,
    phase_id: options.phaseResult.phase_id,
    status: criticalCount > 0 ? "escalate" : "pass",
  };
  await writeJson(riskPath(options.paths, options.phaseResult.phase_id), report);
  return report;
}

export function renderRiskEscalationQuestion(report: RiskReport): string {
  return [
    "# Risk Gate Escalation",
    "",
    `Phase \`${report.phase_id}\` triggered a risk gate.`,
    "",
    "## Findings",
    "",
    ...report.findings.map(
      (finding) =>
        `- ${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`,
    ),
    "",
    "Please decide whether the run should continue, revise, or stop.",
    "",
  ].join("\n");
}

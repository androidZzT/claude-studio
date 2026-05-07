import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { HarnessError } from "../errors.js";

import type { DeterministicGateResult } from "./deterministic-gates.js";
import type { PhaseExecutionResult, PhaseSpec } from "./phase-executor.js";
import type { RunStorePaths } from "./run-store.js";
import type { PhaseTrajectorySummary } from "./trajectory.js";

export const auditBlockingPolicySchema = z.enum([
  "advisory",
  "critical_only",
  "threshold",
]);

export const phaseAuditSpecSchema = z
  .object({
    audit_id: z.string().trim().min(1),
    context_paths: z.array(z.string().trim().min(1)).optional(),
    diff_refs: z.array(z.string().trim().min(1)).optional(),
    required_output_paths: z.array(z.string().trim().min(1)).optional(),
    threshold: z.number().min(0).max(1).optional(),
  })
  .strict();

export const phaseAuditReportSchema = z
  .object({
    audit_id: z.string().min(1),
    blocked: z.boolean(),
    blocking_policy: auditBlockingPolicySchema,
    critical_count: z.number().int().nonnegative(),
    deterministic_gate_failed: z.boolean(),
    findings: z.array(
      z
        .object({
          message: z.string(),
          severity: z.enum(["info", "warning", "critical"]),
        })
        .strict(),
    ),
    next_phase_risk: z.string(),
    phase_id: z.string().min(1),
    recommendation: z.enum(["go", "revise", "escalate"]),
    score: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1).optional(),
    judge_model: z.string().min(1).optional(),
    judge_used: z.boolean(),
    trajectory_missing: z.boolean(),
  })
  .strict();

export const phaseAuditJudgeOutputSchema = z
  .object({
    findings: z.array(
      z
        .object({
          message: z.string(),
          severity: z.enum(["info", "warning", "critical"]),
        })
        .strict(),
    ),
    next_phase_risk: z.string().optional(),
    recommendation: z.enum(["go", "revise", "escalate"]),
    score: z.number().min(0).max(1),
  })
  .strict();

export type AuditBlockingPolicy = z.infer<typeof auditBlockingPolicySchema>;
export type PhaseAuditJudgeOutput = z.infer<typeof phaseAuditJudgeOutputSchema>;
export type PhaseAuditSpec = z.infer<typeof phaseAuditSpecSchema>;
export type PhaseAuditReport = z.infer<typeof phaseAuditReportSchema>;

export interface PhaseAuditJudgeInput {
  readonly audit_id: string;
  readonly context_artifacts: readonly PhaseAuditContextArtifact[];
  readonly deterministic_findings: readonly Finding[];
  readonly model: string;
  readonly output_md: string;
  readonly partial_output_md?: string;
  readonly phase: PhaseSpec;
  readonly phase_result: PhaseExecutionResult;
  readonly prompt: string;
  readonly trajectory_summary?: PhaseTrajectorySummary;
}

export type PhaseAuditJudge = (
  input: PhaseAuditJudgeInput,
) => Promise<PhaseAuditJudgeOutput>;

export interface RunPhaseAuditsOptions {
  readonly auditJudge?: PhaseAuditJudge;
  readonly contextRoot?: string;
  readonly deterministicGateResult?: DeterministicGateResult;
  readonly outputMd?: string;
  readonly partialOutputMd?: string;
  readonly paths: RunStorePaths;
  readonly phase: PhaseSpec;
  readonly phaseResult: PhaseExecutionResult;
  readonly prompt: string;
  readonly trajectorySummary?: PhaseTrajectorySummary;
}

export interface RunPhaseGroupAuditOptions {
  readonly groupId: string;
  readonly paths: RunStorePaths;
  readonly phases: readonly PhaseSpec[];
  readonly results: readonly PhaseExecutionResult[];
}

export interface Finding {
  readonly message: string;
  readonly severity: "info" | "warning" | "critical";
}

export interface PhaseAuditContextArtifact {
  readonly content: string;
  readonly path: string;
  readonly truncated: boolean;
}

const MAX_CONTEXT_FILE_BYTES = 16 * 1024;
const MAX_DIFF_SUMMARY_BYTES = 24 * 1024;
const execFileAsync = promisify(execFile);

function assertSafeArtifactSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new HarnessError(
      `${label} must be a single safe path segment: ${value}`,
      "AUDIT_ARTIFACT_SEGMENT_INVALID",
    );
  }
}

function auditDirectory(paths: RunStorePaths, phaseId: string): string {
  assertSafeArtifactSegment(phaseId, "phase_id");
  return path.join(paths.auditsDir, phaseId);
}

async function readOutputIfNeeded(
  outputMd: string | undefined,
  outputPath: string,
): Promise<string> {
  if (outputMd !== undefined) {
    return outputMd;
  }

  try {
    return await readFile(outputPath, "utf8");
  } catch {
    return "";
  }
}

async function readBoundedContextFile(
  contextRoot: string,
  contextPath: string,
): Promise<PhaseAuditContextArtifact> {
  const resolvedPath = path.resolve(contextRoot, contextPath);
  const source = await readFile(resolvedPath, "utf8");
  const truncated = Buffer.byteLength(source, "utf8") > MAX_CONTEXT_FILE_BYTES;
  return {
    content: truncated ? source.slice(0, MAX_CONTEXT_FILE_BYTES) : source,
    path: resolvedPath,
    truncated,
  };
}

async function readDiffSummary(
  contextRoot: string,
  diffRef: string,
): Promise<PhaseAuditContextArtifact> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      [
        "-C",
        contextRoot,
        "diff",
        "--stat",
        "--name-status",
        diffRef,
        "--",
        ".",
      ],
      {
        maxBuffer: MAX_DIFF_SUMMARY_BYTES + 4096,
        timeout: 30_000,
      },
    );
    const content = [stdout, stderr].filter(Boolean).join("\n").trim();
    const truncated =
      Buffer.byteLength(content, "utf8") > MAX_DIFF_SUMMARY_BYTES;
    return {
      content: truncated ? content.slice(0, MAX_DIFF_SUMMARY_BYTES) : content,
      path: `git diff ${diffRef}`,
      truncated,
    };
  } catch (error) {
    return {
      content: `Failed to read diff summary: ${error instanceof Error ? error.message : "unknown error"}`,
      path: `git diff ${diffRef}`,
      truncated: false,
    };
  }
}

async function loadContextArtifacts(
  options: RunPhaseAuditsOptions,
  spec: PhaseAuditSpec,
): Promise<readonly PhaseAuditContextArtifact[]> {
  const contextRoot = options.contextRoot;
  if (
    !contextRoot ||
    ((!spec.context_paths || spec.context_paths.length === 0) &&
      (!spec.diff_refs || spec.diff_refs.length === 0))
  ) {
    return [];
  }

  const artifacts: PhaseAuditContextArtifact[] = [];
  for (const contextPath of spec.context_paths ?? []) {
    try {
      artifacts.push(await readBoundedContextFile(contextRoot, contextPath));
    } catch (error) {
      artifacts.push({
        content: `Failed to read context: ${error instanceof Error ? error.message : "unknown error"}`,
        path: path.resolve(contextRoot, contextPath),
        truncated: false,
      });
    }
  }
  for (const diffRef of spec.diff_refs ?? []) {
    artifacts.push(await readDiffSummary(contextRoot, diffRef));
  }

  return artifacts;
}

function auditSpecsForPhase(phase: PhaseSpec): readonly PhaseAuditSpec[] {
  if (phase.post_phase_audits && phase.post_phase_audits.length > 0) {
    return phase.post_phase_audits;
  }

  return [{ audit_id: "default" }];
}

function resolveBlockingPolicy(phase: PhaseSpec): AuditBlockingPolicy {
  return phase.audit_blocking_policy ?? "critical_only";
}

function buildFindings(
  options: RunPhaseAuditsOptions,
  outputMd: string,
): readonly Finding[] {
  const findings: Finding[] = [];

  if (options.phaseResult.status !== "completed") {
    findings.push({
      severity: "critical",
      message: `Phase failed: ${options.phaseResult.reason ?? "unknown failure"}.`,
    });
  }

  if (options.deterministicGateResult?.status === "fail") {
    findings.push({
      severity: "critical",
      message: `Deterministic gate failed: ${options.deterministicGateResult.failed_signals.join(", ")}.`,
    });
  }

  if ((options.trajectorySummary?.status ?? "missing") !== "captured") {
    findings.push({
      severity: "warning",
      message: `Trajectory ${options.trajectorySummary?.status ?? "missing"}: ${options.trajectorySummary?.reason ?? "no parsed trajectory attached"}.`,
    });
  }

  if (options.prompt.trim().length === 0) {
    findings.push({
      severity: "warning",
      message: "Phase prompt is empty.",
    });
  }

  if (outputMd.trim().length === 0) {
    findings.push({
      severity: "critical",
      message: "Phase output is empty.",
    });
  }

  return findings;
}

async function buildSpecFindings(
  options: RunPhaseAuditsOptions,
  spec: PhaseAuditSpec,
): Promise<readonly Finding[]> {
  if (
    !options.contextRoot ||
    !spec.required_output_paths ||
    spec.required_output_paths.length === 0
  ) {
    return [];
  }

  const findings: Finding[] = [];
  for (const requiredOutputPath of spec.required_output_paths) {
    const resolvedPath = path.resolve(options.contextRoot, requiredOutputPath);
    try {
      const fileStat = await stat(resolvedPath);
      if (!fileStat.isFile() || fileStat.size === 0) {
        findings.push({
          severity: "critical",
          message: `Required output is missing or empty: ${requiredOutputPath}.`,
        });
      }
    } catch {
      findings.push({
        severity: "critical",
        message: `Required output is missing or empty: ${requiredOutputPath}.`,
      });
    }
  }
  return findings;
}

function scoreFindings(findings: readonly Finding[]): number {
  const penalty = findings.reduce((total, finding) => {
    if (finding.severity === "critical") {
      return total + 0.45;
    }

    if (finding.severity === "warning") {
      return total + 0.1;
    }

    return total;
  }, 0);

  return Math.max(0, Math.round((1 - penalty) * 100) / 100);
}

function isBlocked(
  policy: AuditBlockingPolicy,
  score: number,
  criticalCount: number,
  threshold: number | undefined,
): boolean {
  if (policy === "advisory") {
    return false;
  }

  if (policy === "threshold") {
    return score < (threshold ?? 0.8);
  }

  return criticalCount > 0;
}

function recommendationFor(
  score: number,
  criticalCount: number,
): PhaseAuditReport["recommendation"] {
  if (criticalCount > 0) {
    return "revise";
  }

  return score < 0.6 ? "escalate" : "go";
}

function renderAuditMarkdown(report: PhaseAuditReport): string {
  return [
    `# Phase Audit: ${report.phase_id}`,
    "",
    `- audit_id: ${report.audit_id}`,
    `- score: ${report.score}`,
    `- critical_count: ${report.critical_count}`,
    `- blocked: ${report.blocked}`,
    `- recommendation: ${report.recommendation}`,
    `- judge_used: ${report.judge_used}`,
    ...(report.judge_model ? [`- judge_model: ${report.judge_model}`] : []),
    `- next_phase_risk: ${report.next_phase_risk}`,
    "",
    "## Findings",
    "",
    ...(report.findings.length === 0
      ? ["- No findings."]
      : report.findings.map(
          (finding) => `- [${finding.severity}] ${finding.message}`,
        )),
    "",
  ].join("\n");
}

async function writeAuditReport(
  paths: RunStorePaths,
  phaseId: string,
  report: PhaseAuditReport,
): Promise<void> {
  const directory = auditDirectory(paths, phaseId);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(directory, `${report.audit_id}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(directory, `${report.audit_id}.md`),
      renderAuditMarkdown(report),
      "utf8",
    ),
  ]);
}

async function runJudgeIfAvailable(
  options: RunPhaseAuditsOptions,
  spec: PhaseAuditSpec,
  outputMd: string,
  contextArtifacts: readonly PhaseAuditContextArtifact[],
  deterministicFindings: readonly Finding[],
): Promise<PhaseAuditJudgeOutput | undefined> {
  if (!options.auditJudge) {
    return undefined;
  }

  try {
    return phaseAuditJudgeOutputSchema.parse(
      await options.auditJudge({
        audit_id: spec.audit_id,
        context_artifacts: contextArtifacts,
        deterministic_findings: deterministicFindings,
        model:
          options.phase.audit_model ??
          options.phase.checkpoint_model ??
          "default",
        output_md: outputMd,
        ...(options.partialOutputMd
          ? { partial_output_md: options.partialOutputMd }
          : {}),
        phase: options.phase,
        phase_result: options.phaseResult,
        prompt: options.prompt,
        ...(options.trajectorySummary
          ? { trajectory_summary: options.trajectorySummary }
          : {}),
      }),
    );
  } catch (error) {
    return {
      findings: [
        {
          severity: "warning",
          message: `Audit judge failed: ${error instanceof Error ? error.message : "unknown failure"}.`,
        },
      ],
      next_phase_risk: "audit judge failed; deterministic audit only",
      recommendation: "go",
      score: Math.max(0, scoreFindings(deterministicFindings) - 0.1),
    };
  }
}

async function buildAuditReport(
  options: RunPhaseAuditsOptions,
  spec: PhaseAuditSpec,
  outputMd: string,
  contextArtifacts: readonly PhaseAuditContextArtifact[],
  deterministicFindings: readonly Finding[],
  policy: AuditBlockingPolicy,
): Promise<PhaseAuditReport> {
  const judgeOutput = await runJudgeIfAvailable(
    options,
    spec,
    outputMd,
    contextArtifacts,
    deterministicFindings,
  );
  const judgeFindings = judgeOutput?.findings ?? [];
  const findings = [...deterministicFindings, ...judgeFindings];
  const criticalCount = findings.filter(
    (finding) => finding.severity === "critical",
  ).length;
  const deterministicScore = scoreFindings(deterministicFindings);
  const score = Math.max(
    0,
    Math.min(deterministicScore, judgeOutput?.score ?? deterministicScore),
  );

  return phaseAuditReportSchema.parse({
    audit_id: spec.audit_id,
    blocked: isBlocked(policy, score, criticalCount, spec.threshold),
    blocking_policy: policy,
    critical_count: criticalCount,
    deterministic_gate_failed:
      options.deterministicGateResult?.status === "fail",
    findings,
    judge_used: Boolean(options.auditJudge),
    ...(options.auditJudge
      ? {
          judge_model:
            options.phase.audit_model ??
            options.phase.checkpoint_model ??
            "default",
        }
      : {}),
    next_phase_risk:
      judgeOutput?.next_phase_risk ??
      (criticalCount > 0
        ? "critical phase or gate issue must be fixed before continuing"
        : score < 0.8
          ? "non-blocking quality risk should be reviewed"
          : "low"),
    phase_id: options.phase.phase_id,
    recommendation:
      criticalCount > 0
        ? "revise"
        : (judgeOutput?.recommendation ??
          recommendationFor(score, criticalCount)),
    score,
    ...(spec.threshold !== undefined ? { threshold: spec.threshold } : {}),
    trajectory_missing:
      (options.trajectorySummary?.status ?? "missing") !== "captured",
  });
}

export async function runPhaseAudits(
  options: RunPhaseAuditsOptions,
): Promise<readonly PhaseAuditReport[]> {
  const outputMd = await readOutputIfNeeded(
    options.outputMd,
    options.phaseResult.output_path,
  );
  const findings = buildFindings(options, outputMd);
  const policy = resolveBlockingPolicy(options.phase);
  const reports = await Promise.all(
    auditSpecsForPhase(options.phase).map(async (spec) => {
      const contextArtifacts = await loadContextArtifacts(options, spec);
      const specFindings = await buildSpecFindings(options, spec);
      return buildAuditReport(
        options,
        spec,
        outputMd,
        contextArtifacts,
        [...findings, ...specFindings],
        policy,
      );
    }),
  );

  await Promise.all(
    reports.map((report) =>
      writeAuditReport(options.paths, options.phase.phase_id, report),
    ),
  );
  return reports;
}

export async function runPhaseGroupAudit(
  options: RunPhaseGroupAuditOptions,
): Promise<PhaseAuditReport> {
  assertSafeArtifactSegment(options.groupId, "parallel_group");
  const criticalResults = options.results.filter(
    (result) => result.status !== "completed",
  );
  const findings: Finding[] = criticalResults.map((result) => ({
    severity: "critical",
    message: `Parallel group phase ${result.phase_id} ended with status ${result.status}.`,
  }));
  const completedPhaseIds = new Set(
    options.results
      .filter((result) => result.status === "completed")
      .map((result) => result.phase_id),
  );
  const expectedPhaseIds = options.phases.map((phase) => phase.phase_id);
  const missingCompleted = expectedPhaseIds.filter(
    (phaseId) => !completedPhaseIds.has(phaseId),
  );
  if (missingCompleted.length > 0 && criticalResults.length === 0) {
    findings.push({
      severity: "critical",
      message: `Parallel group is missing completed phase artifacts: ${missingCompleted.join(", ")}.`,
    });
  }
  const score = scoreFindings(findings);
  const report = phaseAuditReportSchema.parse({
    audit_id: "group-consistency",
    blocked: findings.some((finding) => finding.severity === "critical"),
    blocking_policy: "critical_only",
    critical_count: findings.filter(
      (finding) => finding.severity === "critical",
    ).length,
    deterministic_gate_failed: false,
    findings,
    judge_used: false,
    next_phase_risk:
      criticalResults.length > 0
        ? "parallel group has failed sibling phases"
        : "low",
    phase_id: `_group_${options.groupId}`,
    recommendation: criticalResults.length > 0 ? "revise" : "go",
    score,
    trajectory_missing: false,
  });

  const directory = path.join(
    options.paths.auditsDir,
    "_groups",
    options.groupId,
  );
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(directory, "group-consistency.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(directory, "group-consistency.md"),
      renderAuditMarkdown(report),
      "utf8",
    ),
  ]);
  return report;
}

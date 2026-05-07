import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { HarnessError } from "../errors.js";
import { resolveToolModelProfile } from "../agent-routing.js";
import { loadHarnessConfig, toolNameSchema } from "../harness-config.js";
import type { HarnessConfig } from "../harness-config.js";

import type { PhaseAuditJudge } from "./audit.js";
import { auditBlockingPolicySchema, phaseAuditSpecSchema } from "./audit.js";
import type { PhaseAuditReport } from "./audit.js";
import { runCheckpoint } from "./checkpoint.js";
import type {
  CheckpointJudge,
  PreviousPhaseModelClass,
  RunCheckpointResult,
} from "./checkpoint.js";
import type {
  DeterministicGateOptions,
  DeterministicSignals,
} from "./deterministic-gates.js";
import type {
  PhaseExecutionResult,
  PhaseSpawn,
  PhaseSpec,
} from "./phase-executor.js";
import { resolveCwdRef, runPhase, runPhaseGroup } from "./phase-executor.js";
import {
  applyTaskCardTimeout,
  evaluateBudget,
  evaluateRisk,
  renderRiskEscalationQuestion,
} from "./governance.js";
import type { BudgetReport, RiskReport } from "./governance.js";
import {
  loadRunState,
  resumeRunFromDecision,
  saveRunState,
  writeEscalationRequest,
} from "./pause-resume.js";
import type { RunState } from "./pause-resume.js";
import {
  acquireRunLock,
  appendRunEvent,
  getDefaultRunRoot,
  getRunStorePaths,
  initializeRunStore,
  inspectRunLiveness,
  repairInterruptedPhaseArtifacts,
  recomputeEstimatedDollars,
} from "./run-store.js";
import type { RunStorePaths, RunStoreProcessInfo } from "./run-store.js";
import {
  captureRollbackBaseline,
  writeRollbackRecommendation,
} from "./rollback.js";
import { validatePhaseResultArtifact } from "./phase-result.js";
import type { PhaseResultValidationReport } from "./phase-result.js";
import {
  loadTaskCard,
  readTaskCardFromRunStore,
  renderTaskCardPromptSection,
  writeTaskCardArtifacts,
} from "./task-card.js";
import type { LoadedTaskCard } from "./task-card.js";
import { resolveRunFamily, writeRunFamily } from "./run-family.js";
import { GATE_COMMAND_KINDS, runGateCommand } from "./safe-command-runner.js";
import type {
  GateCommand,
  GateCommandResult,
  GateCommandSpawn,
} from "./safe-command-runner.js";
import { generateRunVisualization } from "./run-report.js";

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const gateCommandSchema = z
  .object({
    allowed_write_roots: z.array(z.string().trim().min(1)).optional(),
    argv: z.array(z.string().trim().min(1)).min(1),
    cwd_ref: z.string().trim().min(1),
    id: z.string().trim().min(1),
    kind: z.enum(GATE_COMMAND_KINDS),
    timeout_seconds: z.number().int().positive(),
  })
  .strict();

const phaseSpecSchema = z
  .object({
    agent: z.string().trim().min(1),
    audit_blocking_policy: auditBlockingPolicySchema.optional(),
    audit_model: z.string().trim().min(1).optional(),
    allowed_write_roots: z.array(z.string().trim().min(1)).optional(),
    checkpoint_model: z.string().trim().min(1).optional(),
    cwd_ref: z.string().trim().min(1),
    gate_commands: z.array(gateCommandSchema).optional(),
    instructions: z
      .union([
        z.string().trim().min(1),
        z.array(z.string().trim().min(1)).min(1),
      ])
      .optional(),
    mode: z.string().trim().min(1).optional(),
    output_schema: z.unknown().optional(),
    parallel_group: z.string().trim().min(1).optional(),
    phase_id: z.string().trim().min(1),
    post_phase_audits: z.array(phaseAuditSpecSchema).optional(),
    pre_phase_gate_commands: z.array(gateCommandSchema).optional(),
    profile: z.string().trim().min(1).optional(),
    provider_stall_timeout_seconds: z.number().int().positive().optional(),
    required_artifacts: z.array(z.string().trim().min(1)).optional(),
    tool: toolNameSchema,
    trajectory_raw_capture: z.enum(["redacted", "off"]).optional(),
    trajectory_capture: z.boolean().optional(),
  })
  .strict();

const skillFrontmatterSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    phases: z.array(phaseSpecSchema).min(1),
    stop_conditions: z
      .object({
        require_acceptance_matrix: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type ParsedGateCommand = z.infer<typeof gateCommandSchema>;
type ParsedPhaseSpec = z.infer<typeof phaseSpecSchema>;

export interface AutonomousRunOptions {
  readonly auditJudge?: PhaseAuditJudge;
  readonly brief?: string;
  readonly briefPath?: string;
  readonly checkpointJudge?: CheckpointJudge;
  readonly checkpointTimeoutMs?: number;
  readonly compoundName?: string;
  readonly configPath?: string;
  readonly gateMaxOutputBytes?: number;
  readonly gateSpawnImpl?: GateCommandSpawn;
  readonly harnessRepoPath?: string;
  readonly noLocal?: boolean;
  readonly onWarning?: (message: string) => void;
  readonly processInfo?: RunStoreProcessInfo;
  readonly prompt?: string;
  readonly resume?: boolean;
  readonly runId?: string;
  readonly runRoot?: string;
  readonly skillPath?: string;
  readonly spawnImpl?: PhaseSpawn;
  readonly stderrMirror?: NodeJS.WritableStream;
  readonly stdoutMirror?: NodeJS.WritableStream;
  readonly taskCardPath?: string;
  readonly threadId?: string;
  readonly trajectoryHomeDir?: string;
}

export interface AutonomousRunGateReport {
  readonly command: GateCommandResult;
  readonly phase_id: string;
  readonly status: "pass" | "fail";
}

export interface AutonomousRunPhaseReport {
  readonly audits_blocked: boolean;
  readonly budget_report?: BudgetReport;
  readonly gate_reports: readonly AutonomousRunGateReport[];
  readonly phase_id: string;
  readonly result_validation?: PhaseResultValidationReport;
  readonly result: PhaseExecutionResult;
  readonly risk_report?: RiskReport;
  readonly rollback_path?: string;
}

export interface AutonomousRunCheckpointReport {
  readonly checkpoint_id: string;
  readonly phase_ids: readonly string[];
  readonly result: RunCheckpointResult;
  readonly status: "go" | "revise" | "escalate";
  readonly notification_path?: string;
}

export interface AutonomousRunReport {
  readonly checkpoint_reports: readonly AutonomousRunCheckpointReport[];
  readonly completed_phase_count: number;
  readonly failed_reason?: string;
  readonly gate_reports: readonly AutonomousRunGateReport[];
  readonly harness_repo_path: string;
  readonly phase_reports: readonly AutonomousRunPhaseReport[];
  readonly run_id: string;
  readonly run_root: string;
  readonly skill_name?: string;
  readonly skill_path: string;
  readonly status: "completed" | "failed" | "paused";
  readonly summary_path: string;
  readonly task_card_hash?: string;
  readonly thread_id: string;
  readonly visualization_html_path?: string;
}

interface SkillDefinition {
  readonly deterministicGateOptions?: DeterministicGateOptions;
  readonly name?: string;
  readonly phases: readonly PhaseSpec[];
  readonly skillPath: string;
}

interface RunMetadata {
  readonly compound_name?: string;
  readonly harness_repo_path: string;
  readonly run_id: string;
  readonly skill_name?: string;
  readonly skill_path: string;
  readonly task_card_hash?: string;
  readonly thread_id: string;
}

function assertSafePathSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new HarnessError(
      `${label} must be a single safe path segment: ${value}`,
      "RUN_SEGMENT_INVALID",
    );
  }
}

function resolveHarnessRepoPath(cwd: string, harnessRepoPath?: string): string {
  return path.resolve(cwd, harnessRepoPath ?? ".");
}

function resolveSkillPath(
  harnessRepoPath: string,
  options: Pick<AutonomousRunOptions, "compoundName" | "skillPath">,
): string {
  if (options.skillPath && options.compoundName) {
    throw new HarnessError(
      "Use either --skill or --compound, not both.",
      "RUN_SKILL_AMBIGUOUS",
    );
  }

  if (options.skillPath) {
    return path.resolve(harnessRepoPath, options.skillPath);
  }

  if (options.compoundName) {
    assertSafePathSegment(options.compoundName, "compound name");
    return path.join(
      harnessRepoPath,
      "skills",
      "compound",
      options.compoundName,
      "SKILL.md",
    );
  }

  throw new HarnessError(
    "Missing --skill or --compound for run execution.",
    "RUN_SKILL_MISSING",
  );
}

function normalizeGateCommand(command: ParsedGateCommand): GateCommand {
  return {
    argv: command.argv,
    cwd_ref: command.cwd_ref,
    id: command.id,
    kind: command.kind,
    timeout_seconds: command.timeout_seconds,
    ...(command.allowed_write_roots
      ? { allowed_write_roots: command.allowed_write_roots }
      : {}),
  };
}

function normalizePhaseSpec(phase: ParsedPhaseSpec): PhaseSpec {
  return {
    agent: phase.agent,
    cwd_ref: phase.cwd_ref,
    phase_id: phase.phase_id,
    tool: phase.tool,
    ...(phase.audit_blocking_policy
      ? { audit_blocking_policy: phase.audit_blocking_policy }
      : {}),
    ...(phase.audit_model ? { audit_model: phase.audit_model } : {}),
    ...(phase.allowed_write_roots
      ? { allowed_write_roots: phase.allowed_write_roots }
      : {}),
    ...(phase.checkpoint_model
      ? { checkpoint_model: phase.checkpoint_model }
      : {}),
    ...(phase.gate_commands
      ? { gate_commands: phase.gate_commands.map(normalizeGateCommand) }
      : {}),
    ...(phase.instructions ? { instructions: phase.instructions } : {}),
    ...(phase.mode ? { mode: phase.mode } : {}),
    ...(phase.output_schema !== undefined
      ? { output_schema: phase.output_schema }
      : {}),
    ...(phase.parallel_group ? { parallel_group: phase.parallel_group } : {}),
    ...(phase.post_phase_audits
      ? { post_phase_audits: phase.post_phase_audits }
      : {}),
    ...(phase.pre_phase_gate_commands
      ? {
          pre_phase_gate_commands:
            phase.pre_phase_gate_commands.map(normalizeGateCommand),
        }
      : {}),
    ...(phase.profile ? { profile: phase.profile } : {}),
    ...(phase.provider_stall_timeout_seconds !== undefined
      ? {
          provider_stall_timeout_seconds: phase.provider_stall_timeout_seconds,
        }
      : {}),
    ...(phase.required_artifacts
      ? { required_artifacts: phase.required_artifacts }
      : {}),
    ...(phase.trajectory_raw_capture
      ? { trajectory_raw_capture: phase.trajectory_raw_capture }
      : {}),
    ...(phase.trajectory_capture !== undefined
      ? { trajectory_capture: phase.trajectory_capture }
      : {}),
  };
}

async function loadSkillDefinition(
  harnessRepoPath: string,
  options: Pick<AutonomousRunOptions, "compoundName" | "skillPath">,
): Promise<SkillDefinition> {
  const skillPath = resolveSkillPath(harnessRepoPath, options);
  const skillSource = await readFile(skillPath, "utf8");
  const match = skillSource.match(frontmatterPattern);
  if (!match) {
    throw new HarnessError(
      `Skill must have YAML frontmatter with phases: ${skillPath}`,
      "RUN_SKILL_FRONTMATTER_MISSING",
    );
  }

  const parsed = skillFrontmatterSchema.parse(YAML.parse(match[1] ?? ""));
  return {
    ...(parsed.stop_conditions?.require_acceptance_matrix !== undefined
      ? {
          deterministicGateOptions: {
            require_acceptance_matrix:
              parsed.stop_conditions.require_acceptance_matrix,
          },
        }
      : {}),
    ...(parsed.name ? { name: parsed.name } : {}),
    phases: parsed.phases.map(normalizePhaseSpec),
    skillPath,
  };
}

function metadataPath(paths: RunStorePaths): string {
  return path.join(paths.rootDir, "run.json");
}

function phaseGraphPath(paths: RunStorePaths): string {
  return path.join(paths.rootDir, "phase_graph.json");
}

async function writePhaseGraph(
  paths: RunStorePaths,
  phases: readonly PhaseSpec[],
): Promise<void> {
  await writeFile(
    phaseGraphPath(paths),
    `${JSON.stringify(
      phases.map((phase, index) => ({
        agent: phase.agent,
        cwd_ref: phase.cwd_ref,
        gate_command_count: phase.gate_commands?.length ?? 0,
        index,
        mode: phase.mode,
        output_schema_declared: phase.output_schema !== undefined,
        parallel_group: phase.parallel_group,
        phase_id: phase.phase_id,
        pre_phase_gate_command_count:
          phase.pre_phase_gate_commands?.length ?? 0,
        profile: phase.profile,
        provider_stall_timeout_seconds: phase.provider_stall_timeout_seconds,
        required_artifacts: phase.required_artifacts ?? [],
        tool: phase.tool,
        trajectory_raw_capture: phase.trajectory_raw_capture ?? "off",
        trajectory_capture: phase.trajectory_capture ?? true,
      })),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeRunMetadata(
  paths: RunStorePaths,
  metadata: RunMetadata,
): Promise<void> {
  await writeFile(
    metadataPath(paths),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

async function readRunMetadata(
  paths: RunStorePaths,
): Promise<RunMetadata | undefined> {
  try {
    return JSON.parse(
      await readFile(metadataPath(paths), "utf8"),
    ) as RunMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function createThreadId(): string {
  return `thread-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

async function resolveBrief(options: AutonomousRunOptions): Promise<string> {
  if (options.taskCardPath && (options.brief || options.briefPath || options.prompt)) {
    throw new HarnessError(
      "Use --task-card as the execution input, or use --brief/--prompt without --task-card.",
      "RUN_TASK_CARD_INPUT_AMBIGUOUS",
    );
  }

  if (options.brief && options.briefPath) {
    throw new HarnessError(
      "Use either --prompt/brief or --brief, not both.",
      "RUN_BRIEF_AMBIGUOUS",
    );
  }

  if (options.brief !== undefined) {
    return options.brief;
  }

  if (options.prompt !== undefined) {
    return options.prompt;
  }

  if (options.briefPath) {
    return readFile(path.resolve(options.briefPath), "utf8");
  }

  return "No external brief was provided. Execute the phase using the compound skill instructions and repository context.";
}

function buildPhasePrompt(options: {
  readonly brief: string;
  readonly phase: PhaseSpec;
  readonly previousReports: readonly AutonomousRunPhaseReport[];
  readonly skillName?: string;
  readonly taskCard?: LoadedTaskCard;
}): string {
  const previousSummary =
    options.previousReports.length === 0
      ? "No previous phase has completed."
      : options.previousReports
          .map(
            (report) =>
              `- ${report.phase_id}: ${report.result.status}, output=${report.result.output_path}`,
          )
          .join("\n");
  const phaseInstructions = Array.isArray(options.phase.instructions)
    ? options.phase.instructions.map((item) => `- ${item}`).join("\n")
    : options.phase.instructions;

  return [
    "# Harness Autonomous Phase",
    "",
    `Skill: ${options.skillName ?? "unknown"}`,
    `Phase: ${options.phase.phase_id}`,
    `Agent: ${options.phase.agent}`,
    `Tool: ${options.phase.tool}`,
    ...(options.phase.mode ? [`Mode: ${options.phase.mode}`] : []),
    `cwd_ref: ${options.phase.cwd_ref}`,
    ...(options.phase.parallel_group
      ? [`parallel_group: ${options.phase.parallel_group}`]
      : []),
    "",
    ...(phaseInstructions
      ? ["## Phase Instructions", "", phaseInstructions, ""]
      : []),
    "",
    "## User Brief",
    "",
    options.brief,
    "",
    ...renderTaskCardPromptSection(options.taskCard),
    "## Previous Phase Outputs",
    "",
    previousSummary,
    "",
    ...(options.phase.required_artifacts &&
    options.phase.required_artifacts.length > 0
      ? [
          "## Required Artifacts",
          "",
          ...options.phase.required_artifacts.map((artifact) => `- ${artifact}`),
          "",
        ]
      : []),
    "## Required Output",
    "",
    "Complete only this phase. Return a concise Markdown artifact describing what you did, evidence gathered, files changed or checked, and any blockers. Harness will persist stdout as this phase output.",
    "",
    "If your execution environment can write to the phase run store, also write `result.json` with exactly these fields: status, summary, changed_files, commands_run, tests, risk_flags, next_action. If not, include the same facts clearly in Markdown so Harness can synthesize a minimal result artifact.",
    "",
  ].join("\n");
}

function collectNextPhaseBatch(
  phases: readonly PhaseSpec[],
  startIndex: number,
): readonly PhaseSpec[] {
  const first = phases[startIndex]!;
  if (!first.parallel_group) {
    return [first];
  }

  const batch: PhaseSpec[] = [first];
  for (let index = startIndex + 1; index < phases.length; index += 1) {
    const candidate = phases[index]!;
    if (candidate.parallel_group !== first.parallel_group) {
      break;
    }

    batch.push(candidate);
  }

  return batch;
}

function checkpointSafeSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "-");
  return sanitized.length === 0 ? "checkpoint" : sanitized;
}

function checkpointIdForBatch(
  checkpointIndex: number,
  batch: readonly PhaseSpec[],
): string {
  const groupId = batch.find((phase) => phase.parallel_group)?.parallel_group;
  const label = groupId ?? batch.map((phase) => phase.phase_id).join("-");
  return `checkpoint-${checkpointIndex}-${checkpointSafeSegment(label)}`;
}

async function appendPhaseStartEvents(
  paths: RunStorePaths,
  runId: string,
  phases: readonly PhaseSpec[],
  processInfo?: RunStoreProcessInfo,
): Promise<void> {
  for (const phase of phases) {
    await appendRunEvent(
      paths,
      runId,
      {
        ts: new Date().toISOString(),
        kind: "phase_start",
        phase_id: phase.phase_id,
        payload: {
          agent: phase.agent,
          cwd_ref: phase.cwd_ref,
          tool: phase.tool,
        },
      },
      processInfo,
    );
  }
}

async function appendPhaseEndEvents(
  paths: RunStorePaths,
  runId: string,
  results: readonly PhaseExecutionResult[],
  processInfo?: RunStoreProcessInfo,
): Promise<void> {
  for (const result of results) {
    await appendRunEvent(
      paths,
      runId,
      {
        ts: new Date().toISOString(),
        kind: "phase_end",
        phase_id: result.phase_id,
        payload: {
          audit_blocked: result.audit_blocked ?? false,
          duration_ms: result.duration_ms,
          exit_code: result.exit_code,
          reason: result.reason,
          status: result.status,
          trajectory_status: result.trajectory_summary?.status,
        },
      },
      processInfo,
    );
  }
}

async function runGateCommandsForPhase(
  config: HarnessConfig,
  harnessRepoPath: string,
  paths: RunStorePaths,
  phase: PhaseSpec,
  options: Pick<AutonomousRunOptions, "gateMaxOutputBytes" | "gateSpawnImpl">,
  commandsOverride?: readonly GateCommand[],
): Promise<readonly AutonomousRunGateReport[]> {
  const commands = commandsOverride ?? phase.gate_commands ?? [];
  const reports: AutonomousRunGateReport[] = [];
  if (commands.length === 0) {
    return reports;
  }

  const phaseGateDir = path.join(paths.gatesDir, phase.phase_id);
  await mkdir(phaseGateDir, { recursive: true });

  for (const command of commands) {
    const cwd = resolveCwdRef(config, harnessRepoPath, command.cwd_ref);
    const result = await runGateCommand(command, {
      cwd,
      ...(options.gateMaxOutputBytes !== undefined
        ? { max_output_bytes: options.gateMaxOutputBytes }
        : {}),
      ...(options.gateSpawnImpl ? { spawnImpl: options.gateSpawnImpl } : {}),
    });
    const report: AutonomousRunGateReport = {
      command: result,
      phase_id: phase.phase_id,
      status: result.exit_code === 0 && !result.timed_out ? "pass" : "fail",
    };
    await writeFile(
      path.join(phaseGateDir, `${command.id}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    reports.push(report);
  }

  return reports;
}

function hasBlockingPhaseResult(
  results: readonly PhaseExecutionResult[],
): boolean {
  return results.some(
    (result) => result.status !== "completed" || result.audit_blocked === true,
  );
}

function countAuditCriticals(results: readonly PhaseExecutionResult[]): number {
  return results.reduce(
    (total, result) =>
      total +
      (result.audits ?? []).reduce(
        (auditTotal, audit) => auditTotal + audit.critical_count,
        0,
      ),
    0,
  );
}

function gateKindPass(
  reports: readonly AutonomousRunGateReport[],
  kind: GateCommand["kind"],
): boolean {
  const relevantReports = reports.filter(
    (report) => report.command.kind === kind,
  );
  return (
    relevantReports.length === 0 ||
    relevantReports.every((report) => report.status === "pass")
  );
}

function deterministicSignalsForBatch(
  results: readonly PhaseExecutionResult[],
  gateReports: readonly AutonomousRunGateReport[],
): DeterministicSignals {
  const failedReviewGateCount = gateReports.filter(
    (report) => report.command.kind === "review" && report.status === "fail",
  ).length;
  return {
    compile_pass: gateKindPass(gateReports, "compile"),
    test_pass: gateKindPass(gateReports, "test"),
    lint_pass: gateKindPass(gateReports, "lint"),
    diff_check_pass: gateKindPass(gateReports, "diff"),
    drift_check_pass: gateKindPass(gateReports, "drift"),
    reviewer_critical_count:
      countAuditCriticals(results) + failedReviewGateCount,
  };
}

function inferPreviousPhaseModelClass(
  config: HarnessConfig,
  phase: PhaseSpec,
): PreviousPhaseModelClass {
  const profile = resolveToolModelProfile(config, phase.tool, phase.agent);
  const modelText =
    `${profile.model ?? ""} ${phase.tool} ${phase.agent}`.toLowerCase();

  if (modelText.includes("opus")) {
    return "opus";
  }

  if (modelText.includes("sonnet")) {
    return "sonnet";
  }

  if (
    phase.tool === "codex" ||
    modelText.includes("codex") ||
    modelText.includes("gpt")
  ) {
    return "codex";
  }

  return "sonnet";
}

async function readPhaseOutputForCheckpoint(
  result: PhaseExecutionResult,
): Promise<string> {
  try {
    const source = await readFile(result.output_path, "utf8");
    return source.trim().length > 0
      ? source.slice(0, 12_000)
      : "(empty output)";
  } catch {
    return "(missing output)";
  }
}

function renderAuditSummary(audits: readonly PhaseAuditReport[]): string {
  if (audits.length === 0) {
    return "- No post-phase audits were recorded.";
  }

  return audits
    .map(
      (audit) =>
        `- ${audit.phase_id}/${audit.audit_id}: score=${audit.score}, critical=${audit.critical_count}, recommendation=${audit.recommendation}, blocked=${audit.blocked}`,
    )
    .join("\n");
}

function renderGateSummary(
  gateReports: readonly AutonomousRunGateReport[],
): string {
  if (gateReports.length === 0) {
    return "- No gate commands declared for this checkpoint.";
  }

  return gateReports
    .map(
      (report) =>
        `- ${report.phase_id}/${report.command.id}: kind=${report.command.kind}, status=${report.status}, exit_code=${report.command.exit_code}, timed_out=${report.command.timed_out}`,
    )
    .join("\n");
}

async function buildCheckpointPrompt(options: {
  readonly batch: readonly PhaseSpec[];
  readonly brief: string;
  readonly checkpointId: string;
  readonly gateReports: readonly AutonomousRunGateReport[];
  readonly results: readonly PhaseExecutionResult[];
}): Promise<string> {
  const phaseOutputs = await Promise.all(
    options.results.map(async (result) =>
      [
        `### ${result.phase_id}`,
        "",
        `status: ${result.status}`,
        result.reason ? `reason: ${result.reason}` : undefined,
        "",
        await readPhaseOutputForCheckpoint(result),
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
    ),
  );
  const audits = options.results.flatMap((result) => result.audits ?? []);

  return [
    "# Harness Checkpoint Judge",
    "",
    `Checkpoint: ${options.checkpointId}`,
    `Phases: ${options.batch.map((phase) => phase.phase_id).join(", ")}`,
    "",
    "Return exactly one JSON object matching this shape:",
    "",
    "```json",
    '{"decision":"go|revise|escalate","confidence":0.0,"reasoning":"...","semantic_findings":[],"revise_target_phase":"required for revise","revise_feedback_md":"required for revise","escalate_question_md":"required for escalate"}',
    "```",
    "",
    "## User Brief",
    "",
    options.brief,
    "",
    "## Gate Results",
    "",
    renderGateSummary(options.gateReports),
    "",
    "## Audit Results",
    "",
    renderAuditSummary(audits),
    "",
    "## Phase Outputs",
    "",
    ...phaseOutputs,
    "",
  ].join("\n");
}

async function appendCheckpointEvent(
  paths: RunStorePaths,
  runId: string,
  report: AutonomousRunCheckpointReport,
  processInfo?: RunStoreProcessInfo,
): Promise<void> {
  await appendRunEvent(
    paths,
    runId,
    {
      ts: new Date().toISOString(),
      kind: "checkpoint",
      phase_id: report.phase_ids.at(-1) ?? report.checkpoint_id,
      payload: {
        checkpoint_id: report.checkpoint_id,
        decision: report.result.decision.decision,
        model: report.result.model,
        attempts: report.result.attempts,
      },
    },
    processInfo,
  );
}

async function saveFinalRunState(
  paths: RunStorePaths,
  status: "completed" | "failed" | "paused",
): Promise<RunState> {
  const state = await loadRunState(paths);
  const nextState: RunState = {
    ...state,
    estimated_dollars: await recomputeEstimatedDollars(paths),
    status,
  };
  await saveRunState(paths, nextState);
  return nextState;
}

async function writeRunSummary(
  paths: RunStorePaths,
  report: Omit<AutonomousRunReport, "summary_path">,
): Promise<string> {
  const summaryPath = path.join(paths.rootDir, "summary.md");
  await writeFile(
    summaryPath,
    [
      "# Harness Autonomous Run Summary",
      "",
      `- status: ${report.status}`,
      `- run_id: ${report.run_id}`,
      `- thread_id: ${report.thread_id}`,
      ...(report.task_card_hash
        ? [`- task_card_hash: ${report.task_card_hash}`]
        : []),
      `- completed_phase_count: ${report.completed_phase_count}`,
      ...(report.failed_reason
        ? [`- failed_reason: ${report.failed_reason}`]
        : []),
      "",
      "## Phases",
      "",
      ...report.phase_reports.map(
        (phaseReport) =>
          `- ${phaseReport.phase_id}: ${phaseReport.result.status}, audit_blocked=${phaseReport.audits_blocked}, result_validation=${phaseReport.result_validation?.status ?? "n/a"}, budget=${phaseReport.budget_report?.status ?? "n/a"}, risk=${phaseReport.risk_report?.status ?? "n/a"}, gates=${phaseReport.gate_reports.length}`,
      ),
      "",
      "## Checkpoints",
      "",
      ...(report.checkpoint_reports.length === 0
        ? ["- No checkpoints ran."]
        : report.checkpoint_reports.map(
            (checkpointReport) =>
              `- ${checkpointReport.checkpoint_id}: ${checkpointReport.status}, phases=${checkpointReport.phase_ids.join(", ")}`,
          )),
      "",
    ].join("\n"),
    "utf8",
  );
  return summaryPath;
}

async function readExistingPhaseResult(
  paths: RunStorePaths,
  phase: PhaseSpec,
): Promise<PhaseExecutionResult | undefined> {
  try {
    const result = JSON.parse(
      await readFile(
        path.join(paths.phasesDir, phase.phase_id, "exit_code.json"),
        "utf8",
      ),
    ) as PhaseExecutionResult;
    return result.status === "completed" ? result : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function readExistingGateReports(
  paths: RunStorePaths,
  phaseId: string,
): Promise<readonly AutonomousRunGateReport[]> {
  const phaseGateDir = path.join(paths.gatesDir, phaseId);
  let entries: string[];

  try {
    entries = await readdir(phaseGateDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const reports: AutonomousRunGateReport[] = [];
  for (const entry of entries.filter((value) => value.endsWith(".json"))) {
    reports.push(
      JSON.parse(
        await readFile(path.join(phaseGateDir, entry), "utf8"),
      ) as AutonomousRunGateReport,
    );
  }

  return reports;
}

async function loadCompletedPhaseReports(
  paths: RunStorePaths,
  phases: readonly PhaseSpec[],
): Promise<readonly AutonomousRunPhaseReport[]> {
  const reports: AutonomousRunPhaseReport[] = [];

  for (const phase of phases) {
    const result = await readExistingPhaseResult(paths, phase);
    if (!result) {
      break;
    }

    reports.push({
      audits_blocked: result.audit_blocked === true,
      gate_reports: await readExistingGateReports(paths, phase.phase_id),
      phase_id: phase.phase_id,
      result,
    });
  }

  return reports;
}

async function loadTaskCardForRun(options: {
  readonly cwd: string;
  readonly paths?: RunStorePaths;
  readonly taskCardPath?: string;
}): Promise<LoadedTaskCard | undefined> {
  if (options.taskCardPath) {
    return loadTaskCard(options.cwd, options.taskCardPath);
  }

  return options.paths ? readTaskCardFromRunStore(options.paths) : undefined;
}

function applyTaskCardToPhases(
  phases: readonly PhaseSpec[],
  taskCard: LoadedTaskCard | undefined,
): readonly PhaseSpec[] {
  return phases.map((phase) => applyTaskCardTimeout(phase, taskCard?.taskCard));
}

async function validateAndGovernPhase(options: {
  readonly config: HarnessConfig;
  readonly harnessRepoPath: string;
  readonly paths: RunStorePaths;
  readonly phase: PhaseSpec;
  readonly result: PhaseExecutionResult;
  readonly taskCard?: LoadedTaskCard;
}): Promise<{
  readonly budgetReport: BudgetReport;
  readonly resultValidation: PhaseResultValidationReport;
  readonly riskReport: RiskReport;
}> {
  const cwd = resolveCwdRef(
    options.config,
    options.harnessRepoPath,
    options.phase.cwd_ref,
  );
  const resultValidation = await validatePhaseResultArtifact({
    cwd,
    paths: options.paths,
    phase: options.phase,
    phaseResult: options.result,
    ...(options.taskCard ? { taskCard: options.taskCard.taskCard } : {}),
  });
  const budgetReport = await evaluateBudget({
    paths: options.paths,
    phaseResult: options.result,
    ...(options.taskCard ? { taskCard: options.taskCard.taskCard } : {}),
  });
  const riskReport = await evaluateRisk({
    paths: options.paths,
    phaseResult: options.result,
    ...(options.taskCard ? { taskCard: options.taskCard.taskCard } : {}),
  });

  return { budgetReport, resultValidation, riskReport };
}

async function writeRollbackRecommendationsForBatch(options: {
  readonly config: HarnessConfig;
  readonly harnessRepoPath: string;
  readonly paths: RunStorePaths;
  readonly phases: readonly PhaseSpec[];
  readonly reason: string;
}): Promise<Readonly<Record<string, string>>> {
  const entries = await Promise.all(
    options.phases.map(async (phase) => {
      const cwd = resolveCwdRef(
        options.config,
        options.harnessRepoPath,
        phase.cwd_ref,
      );
      const rollbackPath = await writeRollbackRecommendation({
        cwd,
        paths: options.paths,
        phase,
        reason: options.reason,
      });
      return [phase.phase_id, rollbackPath] as const;
    }),
  );

  return Object.fromEntries(entries);
}

function nextPhaseIndexFromReports(
  phases: readonly PhaseSpec[],
  phaseReports: readonly AutonomousRunPhaseReport[],
): number {
  const completedPhaseIds = new Set(
    phaseReports
      .filter((report) => report.result.status === "completed")
      .map((report) => report.phase_id),
  );
  const nextIndex = phases.findIndex(
    (phase) => !completedPhaseIds.has(phase.phase_id),
  );
  return nextIndex === -1 ? phases.length : nextIndex;
}

export async function runAutonomousExecution(
  cwd: string,
  options: AutonomousRunOptions,
): Promise<AutonomousRunReport> {
  const harnessRepoPath = resolveHarnessRepoPath(cwd, options.harnessRepoPath);
  const loadedConfig = await loadHarnessConfig(
    harnessRepoPath,
    options.configPath,
    {
      ...(options.noLocal !== undefined ? { noLocal: options.noLocal } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    },
  );
  let skill: SkillDefinition;
  let threadId: string;
  let runId: string;
  let brief: string;
  let paths: RunStorePaths;
  let taskCard: LoadedTaskCard | undefined;
  const phaseReports: AutonomousRunPhaseReport[] = [];
  const allGateReports: AutonomousRunGateReport[] = [];
  const checkpointReports: AutonomousRunCheckpointReport[] = [];
  let failedReason: string | undefined;
  let paused = false;
  let startPhaseIndex = 0;

  if (options.resume) {
    if (!options.threadId) {
      throw new HarnessError(
        "Resume requires --thread-id or --resume <thread-id>.",
        "RUN_RESUME_THREAD_MISSING",
      );
    }

    threadId = options.threadId;
    paths = getRunStorePaths(
      path.resolve(
        options.runRoot ?? getDefaultRunRoot(harnessRepoPath, threadId),
      ),
    );
    const existingState = await loadRunState(paths);
    runId = existingState.run_id;
    const livenessBeforeLock = await inspectRunLiveness(
      paths,
      options.processInfo,
    );
    await acquireRunLock(paths, runId, options.processInfo);
    if (existingState.status === "paused") {
      await resumeRunFromDecision(paths);
    } else if (
      existingState.status !== "running" ||
      livenessBeforeLock.liveness !== "stale"
    ) {
      await resumeRunFromDecision(paths);
    }
    const repairedInterruptedPhases =
      await repairInterruptedPhaseArtifacts(paths);
    await appendRunEvent(
      paths,
      runId,
      {
        ts: new Date().toISOString(),
        kind: "resume",
        phase_id: "run-store",
        payload: {
          status: "resumed",
          ...(livenessBeforeLock.liveness === "stale"
            ? { stale_lock_recovered: true }
            : {}),
          ...(repairedInterruptedPhases.length > 0
            ? { repaired_interrupted_phases: repairedInterruptedPhases }
            : {}),
        },
      },
      options.processInfo,
    );

    const metadata = await readRunMetadata(paths);
    const resumedSkillPath = options.skillPath ?? metadata?.skill_path;
    const resumedCompoundName =
      resumedSkillPath === undefined
        ? (options.compoundName ?? metadata?.compound_name)
        : undefined;
    skill = await loadSkillDefinition(harnessRepoPath, {
      ...(resumedCompoundName ? { compoundName: resumedCompoundName } : {}),
      ...(resumedSkillPath ? { skillPath: resumedSkillPath } : {}),
    });
    taskCard = await loadTaskCardForRun({
      cwd,
      paths,
      ...(options.taskCardPath ? { taskCardPath: options.taskCardPath } : {}),
    });
    skill = {
      ...skill,
      phases: applyTaskCardToPhases(skill.phases, taskCard),
    };
    await writePhaseGraph(paths, skill.phases);
    try {
      brief = await readFile(path.join(paths.rootDir, "brief.md"), "utf8");
    } catch {
      brief = await resolveBrief(options);
    }

    phaseReports.push(
      ...(await loadCompletedPhaseReports(paths, skill.phases)),
    );
    allGateReports.push(
      ...phaseReports.flatMap((report) => report.gate_reports),
    );
    startPhaseIndex = nextPhaseIndexFromReports(skill.phases, phaseReports);
  } else {
    skill = await loadSkillDefinition(harnessRepoPath, options);
    taskCard = await loadTaskCardForRun({
      cwd,
      ...(options.taskCardPath ? { taskCardPath: options.taskCardPath } : {}),
    });
    skill = {
      ...skill,
      phases: applyTaskCardToPhases(skill.phases, taskCard),
    };
    threadId = options.threadId ?? createThreadId();
    runId = options.runId ?? threadId;
    brief = await resolveBrief(options);
    ({ paths } = await initializeRunStore({
      brief,
      harnessRepoPath,
      ...(options.processInfo ? { processInfo: options.processInfo } : {}),
      runId,
      ...(options.runRoot ? { runRoot: options.runRoot } : {}),
      threadId,
    }));
    if (taskCard) {
      await writeTaskCardArtifacts(paths, taskCard);
    }
    await writeRunMetadata(paths, {
      ...(options.compoundName ? { compound_name: options.compoundName } : {}),
      harness_repo_path: harnessRepoPath,
      run_id: runId,
      ...(skill.name ? { skill_name: skill.name } : {}),
      skill_path: skill.skillPath,
      ...(taskCard ? { task_card_hash: taskCard.hash } : {}),
      thread_id: threadId,
    });
    await writeRunFamily(
      paths,
      await resolveRunFamily({
        paths,
        ...(taskCard ? { taskCardHash: taskCard.hash } : {}),
      }),
    );
    await writePhaseGraph(paths, skill.phases);
  }

  let checkpointIndex = 1;

  for (
    let phaseIndex = startPhaseIndex;
    phaseIndex < skill.phases.length && failedReason === undefined && !paused;
  ) {
    const batch = collectNextPhaseBatch(skill.phases, phaseIndex);
    await appendPhaseStartEvents(paths, runId, batch, options.processInfo);
    await Promise.all(
      batch.map((phase) =>
        captureRollbackBaseline({
          cwd: resolveCwdRef(loadedConfig.config, harnessRepoPath, phase.cwd_ref),
          paths,
          phase,
        }),
      ),
    );
    const preflightGateReportsByPhase = new Map<
      string,
      readonly AutonomousRunGateReport[]
    >();
    for (const phase of batch) {
      const preflightGateReports = await runGateCommandsForPhase(
        loadedConfig.config,
        harnessRepoPath,
        paths,
        phase,
        options,
        phase.pre_phase_gate_commands ?? [],
      );
      if (preflightGateReports.length > 0) {
        preflightGateReportsByPhase.set(phase.phase_id, preflightGateReports);
        allGateReports.push(...preflightGateReports);
      }
    }

    const promptByPhase = Object.fromEntries(
      batch.map((phase) => [
        phase.phase_id,
        buildPhasePrompt({
          brief,
          phase,
          previousReports: phaseReports,
          ...(skill.name ? { skillName: skill.name } : {}),
          ...(taskCard ? { taskCard } : {}),
        }),
      ]),
    );
    const preflightFailedPhases = batch.filter((phase) =>
      (preflightGateReportsByPhase.get(phase.phase_id) ?? []).some(
        (report) => report.status === "fail",
      ),
    );
    const results =
      preflightFailedPhases.length > 0
        ? await Promise.all(
            preflightFailedPhases.map((phase) =>
              runPhase({
                ...(options.auditJudge
                  ? { auditJudge: options.auditJudge }
                  : {}),
                config: loadedConfig.config,
                harnessRepoPath,
                paths,
                phase,
                preflightGateFailures: (
                  preflightGateReportsByPhase.get(phase.phase_id) ?? []
                )
                  .filter((report) => report.status === "fail")
                  .map((report) => report.command),
                prompt: promptByPhase[phase.phase_id] ?? "",
                ...(taskCard ? { taskCardHash: taskCard.hash } : {}),
                ...(options.trajectoryHomeDir
                  ? { trajectoryHomeDir: options.trajectoryHomeDir }
                  : {}),
              }),
            ),
          )
        : batch.length > 1
          ? await runPhaseGroup({
              ...(options.auditJudge ? { auditJudge: options.auditJudge } : {}),
              config: loadedConfig.config,
              harnessRepoPath,
              paths,
              phases: batch,
              promptByPhase,
              ...(taskCard ? { taskCardHash: taskCard.hash } : {}),
              ...(options.spawnImpl ? { spawnImpl: options.spawnImpl } : {}),
              ...(options.stderrMirror
                ? { stderrMirror: options.stderrMirror }
                : {}),
              ...(options.stdoutMirror
                ? { stdoutMirror: options.stdoutMirror }
                : {}),
              ...(options.trajectoryHomeDir
                ? { trajectoryHomeDir: options.trajectoryHomeDir }
                : {}),
            })
          : [
              await runPhase({
                ...(options.auditJudge
                  ? { auditJudge: options.auditJudge }
                  : {}),
                config: loadedConfig.config,
                harnessRepoPath,
                paths,
                phase: batch[0]!,
                prompt: promptByPhase[batch[0]!.phase_id] ?? "",
                ...(taskCard ? { taskCardHash: taskCard.hash } : {}),
                ...(options.spawnImpl ? { spawnImpl: options.spawnImpl } : {}),
                ...(options.stderrMirror
                  ? { stderrMirror: options.stderrMirror }
                  : {}),
                ...(options.stdoutMirror
                  ? { stdoutMirror: options.stdoutMirror }
                  : {}),
                ...(options.trajectoryHomeDir
                  ? { trajectoryHomeDir: options.trajectoryHomeDir }
                  : {}),
              }),
            ];

    await appendPhaseEndEvents(paths, runId, results, options.processInfo);

    const governanceByPhase = new Map<
      string,
      {
        readonly budgetReport: BudgetReport;
        readonly resultValidation: PhaseResultValidationReport;
        readonly riskReport: RiskReport;
      }
    >();
    for (const result of results) {
      const phase = batch.find((candidate) => candidate.phase_id === result.phase_id);
      if (!phase) {
        continue;
      }
      governanceByPhase.set(
        result.phase_id,
        await validateAndGovernPhase({
          config: loadedConfig.config,
          harnessRepoPath,
          paths,
          phase,
          result,
          ...(taskCard ? { taskCard } : {}),
        }),
      );
    }

    const validationFailure = [...governanceByPhase.entries()].find(
      ([, report]) => report.resultValidation.status === "critical",
    );
    const budgetFailure = [...governanceByPhase.entries()].find(
      ([, report]) => report.budgetReport.status === "critical",
    );
    const riskFailure = [...governanceByPhase.entries()].find(
      ([, report]) => report.riskReport.status === "escalate",
    );
    const rollbackReason =
      validationFailure !== undefined
        ? `result_validation_failed:${validationFailure[0]}`
        : budgetFailure !== undefined
          ? `budget_exceeded:${budgetFailure[0]}`
          : undefined;
    const rollbackPaths =
      rollbackReason !== undefined
        ? await writeRollbackRecommendationsForBatch({
            config: loadedConfig.config,
            harnessRepoPath,
            paths,
            phases: batch,
            reason: rollbackReason,
          })
        : {};

    for (const result of results) {
      const governance = governanceByPhase.get(result.phase_id);
      phaseReports.push({
        audits_blocked: result.audit_blocked === true,
        ...(governance ? { budget_report: governance.budgetReport } : {}),
        gate_reports: preflightGateReportsByPhase.get(result.phase_id) ?? [],
        phase_id: result.phase_id,
        ...(governance
          ? { result_validation: governance.resultValidation }
          : {}),
        result,
        ...(governance ? { risk_report: governance.riskReport } : {}),
        ...(rollbackPaths[result.phase_id]
          ? { rollback_path: rollbackPaths[result.phase_id] }
          : {}),
      });
    }

    if (validationFailure !== undefined) {
      failedReason = `result_validation_failed:${validationFailure[0]}`;
      break;
    }

    if (budgetFailure !== undefined) {
      failedReason = `budget_exceeded:${budgetFailure[0]}`;
      break;
    }

    if (riskFailure !== undefined) {
      const phase = batch.find((candidate) => candidate.phase_id === riskFailure[0]);
      const escalation = await writeEscalationRequest(
        paths,
        `risk-${riskFailure[0]}`,
        renderRiskEscalationQuestion(riskFailure[1].riskReport),
      );
      await appendRunEvent(
        paths,
        runId,
        {
          ts: new Date().toISOString(),
          kind: "escalate",
          phase_id: phase?.phase_id ?? riskFailure[0],
          payload: {
            request_path: escalation.requestPath,
            status: escalation.status,
            type: "risk_gate",
          },
        },
        options.processInfo,
      );
      if (escalation.status === "paused") {
        paused = true;
      } else {
        failedReason = `risk_escalated_twice:${riskFailure[0]}`;
      }
      break;
    }

    if (hasBlockingPhaseResult(results)) {
      const preflightEnvironmentBlocked = results.some((result) =>
        (preflightGateReportsByPhase.get(result.phase_id) ?? []).some(
          (report) =>
            report.status === "fail" &&
            report.command.failure_category === "environment_blocked",
        ),
      );
      failedReason = preflightEnvironmentBlocked
        ? "environment_blocked"
        : results.some((result) => result.reason === "provider_stalled")
          ? "provider_stalled"
          : results.some((result) => result.audit_blocked)
            ? "audit_blocked"
            : results.some((result) => result.reason === "interrupted")
              ? "interrupted"
              : "phase_failed";
      const rollbackPathsForFailure = await writeRollbackRecommendationsForBatch({
        config: loadedConfig.config,
        harnessRepoPath,
        paths,
        phases: batch,
        reason: failedReason,
      });
      for (const [phaseId, rollbackPath] of Object.entries(rollbackPathsForFailure)) {
        const phaseReport = phaseReports.find((report) => report.phase_id === phaseId);
        if (phaseReport) {
          phaseReports.splice(phaseReports.indexOf(phaseReport), 1, {
            ...phaseReport,
            rollback_path: rollbackPath,
          });
        }
      }
      break;
    }

    const batchGateReports: AutonomousRunGateReport[] = [];
    for (const phase of batch) {
      const gateReports = await runGateCommandsForPhase(
        loadedConfig.config,
        harnessRepoPath,
        paths,
        phase,
        options,
      );
      allGateReports.push(...gateReports);
      batchGateReports.push(...gateReports);
      const phaseReport = phaseReports.find(
        (report) => report.phase_id === phase.phase_id,
      );
      if (phaseReport) {
        phaseReports.splice(phaseReports.indexOf(phaseReport), 1, {
          ...phaseReport,
          gate_reports: [...phaseReport.gate_reports, ...gateReports],
        });
      }

      if (gateReports.some((report) => report.status === "fail")) {
        failedReason = gateReports.some(
          (report) =>
            report.status === "fail" &&
            report.command.failure_category === "environment_blocked",
        )
          ? `environment_blocked:${phase.phase_id}`
          : `gate_failed:${phase.phase_id}`;
        const rollbackPath = await writeRollbackRecommendation({
          cwd: resolveCwdRef(
            loadedConfig.config,
            harnessRepoPath,
            phase.cwd_ref,
          ),
          paths,
          phase,
          reason: failedReason,
        });
        const phaseReport = phaseReports.find(
          (report) => report.phase_id === phase.phase_id,
        );
        if (phaseReport) {
          phaseReports.splice(phaseReports.indexOf(phaseReport), 1, {
            ...phaseReport,
            rollback_path: rollbackPath,
          });
        }
        await appendRunEvent(
          paths,
          runId,
          {
            ts: new Date().toISOString(),
            kind: "gate_fail",
            phase_id: phase.phase_id,
            payload: {
              failed_gates: gateReports
                .filter((report) => report.status === "fail")
                .map((report) => report.command.id),
            },
          },
          options.processInfo,
        );
        break;
      }
    }

    if (failedReason === undefined) {
      const checkpointId = checkpointIdForBatch(checkpointIndex, batch);
      checkpointIndex += 1;
      const lastPhase = batch[batch.length - 1]!;
      const checkpointPrompt = await buildCheckpointPrompt({
        batch,
        brief,
        gateReports: batchGateReports,
        checkpointId,
        results,
      });
      const checkpoint = await runCheckpoint({
        checkpointId,
        ...(skill.deterministicGateOptions
          ? { deterministicGateOptions: skill.deterministicGateOptions }
          : {}),
        deterministicSignals: deterministicSignalsForBatch(
          results,
          batchGateReports,
        ),
        ...(options.checkpointJudge ? { judge: options.checkpointJudge } : {}),
        ...(lastPhase.checkpoint_model
          ? { model: lastPhase.checkpoint_model }
          : {}),
        paths,
        previousPhaseModelClass: inferPreviousPhaseModelClass(
          loadedConfig.config,
          lastPhase,
        ),
        prompt: checkpointPrompt,
        ...(options.checkpointTimeoutMs !== undefined
          ? { timeoutMs: options.checkpointTimeoutMs }
          : {}),
      });
      let checkpointReport: AutonomousRunCheckpointReport = {
        checkpoint_id: checkpointId,
        phase_ids: batch.map((phase) => phase.phase_id),
        result: checkpoint,
        status: checkpoint.decision.decision,
      };
      checkpointReports.push(checkpointReport);
      await appendCheckpointEvent(
        paths,
        runId,
        checkpointReport,
        options.processInfo,
      );

      if (checkpoint.decision.decision === "revise") {
        failedReason = `checkpoint_revise:${checkpointId}`;
      } else if (checkpoint.decision.decision === "escalate") {
        const escalation = await writeEscalationRequest(
          paths,
          checkpointId,
          String(
            checkpoint.decision.escalate_question_md ??
              "Checkpoint requested escalation.",
          ),
        );
        checkpointReport = {
          ...checkpointReport,
          ...(escalation.requestPath
            ? { notification_path: escalation.requestPath }
            : {}),
        };
        checkpointReports.splice(
          checkpointReports.length - 1,
          1,
          checkpointReport,
        );
        await appendRunEvent(
          paths,
          runId,
          {
            ts: new Date().toISOString(),
            kind: "escalate",
            phase_id: lastPhase.phase_id,
            payload: {
              checkpoint_id: checkpointId,
              request_path: escalation.requestPath,
              status: escalation.status,
            },
          },
          options.processInfo,
        );
        if (escalation.status === "paused") {
          paused = true;
        } else {
          failedReason = `checkpoint_escalated_twice:${checkpointId}`;
        }
      }
    }

    phaseIndex += batch.length;
  }

  const status = paused
    ? "paused"
    : failedReason === undefined
      ? "completed"
      : "failed";
  await saveFinalRunState(paths, status);
  const partialReport: Omit<AutonomousRunReport, "summary_path"> = {
    checkpoint_reports: checkpointReports,
    completed_phase_count: phaseReports.filter(
      (report) => report.result.status === "completed",
    ).length,
    ...(failedReason ? { failed_reason: failedReason } : {}),
    gate_reports: allGateReports,
    harness_repo_path: harnessRepoPath,
    phase_reports: phaseReports,
    run_id: runId,
    run_root: paths.rootDir,
    ...(skill.name ? { skill_name: skill.name } : {}),
    skill_path: skill.skillPath,
    status,
    ...(taskCard ? { task_card_hash: taskCard.hash } : {}),
    thread_id: threadId,
  };
  const summaryPath = await writeRunSummary(paths, partialReport);
  await writeRunFamily(
    paths,
    await resolveRunFamily({
      paths,
      ...(taskCard ? { taskCardHash: taskCard.hash } : {}),
    }),
  );
  const visualization = await generateRunVisualization(paths);

  return {
    ...partialReport,
    summary_path: summaryPath,
    visualization_html_path: visualization.html_path,
  };
}

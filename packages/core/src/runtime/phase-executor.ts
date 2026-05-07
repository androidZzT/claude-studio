import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import { HarnessError } from "../errors.js";
import {
  hasResolvedModelProfileFields,
  resolveToolModelProfile,
} from "../agent-routing.js";
import type { ResolvedModelProfile } from "../agent-routing.js";
import type { GateCommand, GateCommandResult } from "./safe-command-runner.js";
import type { HarnessConfig, ToolName } from "../harness-config.js";
import type { RunStorePaths } from "./run-store.js";
import { runPhaseAudits, runPhaseGroupAudit } from "./audit.js";
import type {
  AuditBlockingPolicy,
  PhaseAuditJudge,
  PhaseAuditReport,
  PhaseAuditSpec,
} from "./audit.js";
import type { DeterministicGateResult } from "./deterministic-gates.js";
import { capturePhaseTrajectory } from "./trajectory.js";
import type { PhaseTrajectorySummary } from "./trajectory.js";

export interface PhaseCost {
  readonly dollars: number;
  readonly model?: string;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
}

export interface PhaseSpec {
  readonly agent: string;
  readonly audit_blocking_policy?: AuditBlockingPolicy;
  readonly audit_model?: string;
  readonly allowed_write_roots?: readonly string[];
  readonly checkpoint_model?: string;
  readonly cwd_ref: string;
  readonly gate_commands?: readonly GateCommand[];
  readonly instructions?: string | readonly string[];
  readonly mode?: string;
  readonly output_schema?: unknown;
  readonly parallel_group?: string;
  readonly phase_id: string;
  readonly post_phase_audits?: readonly PhaseAuditSpec[];
  readonly pre_phase_gate_commands?: readonly GateCommand[];
  readonly profile?: string;
  readonly provider_stall_timeout_seconds?: number;
  readonly required_artifacts?: readonly string[];
  readonly tool: ToolName;
  readonly trajectory_raw_capture?: "redacted" | "off";
  readonly trajectory_capture?: boolean;
}

export interface PhaseExecutionResult {
  readonly audit_blocked?: boolean;
  readonly audits?: readonly PhaseAuditReport[];
  readonly cwd: string;
  readonly duration_ms: number;
  readonly exit_code: number | null;
  readonly output_path: string;
  readonly partial_output_path?: string;
  readonly prompt_sha256?: string;
  readonly provider_stall_detail?: string;
  readonly phase_id: string;
  readonly reason?: string;
  readonly session_id?: string;
  readonly signal: NodeJS.Signals | null;
  readonly status: "completed" | "failed";
  readonly trajectory_summary?: PhaseTrajectorySummary;
}

export interface PhaseExecutionOptions {
  readonly auditJudge?: PhaseAuditJudge;
  readonly config: HarnessConfig;
  readonly cost?: PhaseCost;
  readonly deterministicGateResult?: DeterministicGateResult;
  readonly harnessRepoPath: string;
  readonly outputMd?: string;
  readonly paths: RunStorePaths;
  readonly phase: PhaseSpec;
  readonly preflightGateFailures?: readonly GateCommandResult[];
  readonly prompt: string;
  readonly spawnImpl?: PhaseSpawn;
  readonly stderrMirror?: NodeJS.WritableStream;
  readonly stdoutMirror?: NodeJS.WritableStream;
  readonly taskCardHash?: string;
  readonly trajectoryHomeDir?: string;
  readonly trajectoryPath?: string;
}

export interface PhaseGroupExecutionOptions extends Omit<
  PhaseExecutionOptions,
  "cost" | "outputMd" | "phase" | "prompt"
> {
  readonly costs?: Readonly<Record<string, PhaseCost>>;
  readonly outputMdByPhase?: Readonly<Record<string, string>>;
  readonly phases: readonly PhaseSpec[];
  readonly promptByPhase: Readonly<Record<string, string>>;
}

export type PhaseSpawn = (
  file: string,
  args: string[],
  options: {
    readonly cwd: string;
    readonly shell: false;
    readonly stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildProcess;

interface SpawnPlan {
  readonly args: string[];
  readonly file: string;
}

const DEFAULT_PROVIDER_STALL_TIMEOUT_MS = 15 * 60 * 1000;
const PROVIDER_RECONNECT_EXHAUSTED_PATTERN =
  /(?:ERROR:\s*)?Reconnecting\.\.\.\s*(?:5\/5|[6-9]\d*\/\d+)/i;

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
      "PHASE_ARTIFACT_SEGMENT_INVALID",
    );
  }
}

function resolveProjectPath(
  harnessRepoPath: string,
  projectPath: string,
): string {
  return path.resolve(harnessRepoPath, projectPath);
}

function parseNamedCwdRef(
  cwdRef: string,
  prefix: "target" | "reference",
): string | undefined {
  const expectedPrefix = `${prefix}:`;
  return cwdRef.startsWith(expectedPrefix)
    ? cwdRef.slice(expectedPrefix.length)
    : undefined;
}

function inferSessionIdFromText(source: string): string | undefined {
  const match = source.match(
    /\b(?:session[_ -]?id|session)\s*[:=]\s*([A-Za-z0-9_-]+)/i,
  );
  return match?.[1];
}

export function createPhasePromptSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function injectPhaseFingerprint(
  prompt: string,
  phase: PhaseSpec,
  promptSha256: string,
): string {
  return [
    `Harness-Phase-Fingerprint: ${promptSha256}`,
    `Harness-Phase-Id: ${phase.phase_id}`,
    ...(phase.mode ? [`Harness-Phase-Mode: ${phase.mode}`] : []),
    "",
    prompt,
  ].join("\n");
}

function phaseDirectory(paths: RunStorePaths, phaseId: string): string {
  assertSafeArtifactSegment(phaseId, "phase_id");
  return path.join(paths.phasesDir, phaseId);
}

function renderTomlString(value: string): string {
  return JSON.stringify(value);
}

function renderCodexConfigArgs(profile: ResolvedModelProfile): string[] {
  const entries: string[] = [];
  if (profile.model !== undefined) {
    entries.push(`model=${renderTomlString(profile.model)}`);
  }
  if (profile.effort !== undefined) {
    entries.push(`model_reasoning_effort=${renderTomlString(profile.effort)}`);
  }
  if (profile.sandbox_mode !== undefined) {
    entries.push(`sandbox_mode=${renderTomlString(profile.sandbox_mode)}`);
  }
  if (profile.approval_policy !== undefined) {
    entries.push(
      `approval_policy=${renderTomlString(profile.approval_policy)}`,
    );
  }

  return entries.flatMap((entry) => ["--config", entry]);
}

function resolveClaudeModeArgs(phase: PhaseSpec): string[] {
  return phase.mode ? ["--permission-mode", phase.mode] : [];
}

function resolveCodexModePlan(phase: PhaseSpec): {
  readonly args: string[];
  readonly fullAuto: boolean;
} {
  if (!phase.mode) {
    return { args: [], fullAuto: true };
  }

  switch (phase.mode) {
    case "auto":
    case "full-auto":
      return { args: [], fullAuto: true };
    case "default":
      return { args: [], fullAuto: false };
    case "plan":
      return {
        args: [
          "--config",
          'sandbox_mode="read-only"',
          "--config",
          'approval_policy="never"',
        ],
        fullAuto: false,
      };
    case "read-only":
      return {
        args: ["--config", 'sandbox_mode="read-only"'],
        fullAuto: false,
      };
    case "workspace-write":
      return {
        args: ["--config", 'sandbox_mode="workspace-write"'],
        fullAuto: false,
      };
    default:
      throw new HarnessError(
        `Unsupported Codex phase mode "${phase.mode}" for phase "${phase.phase_id}". Supported modes: plan, default, auto, full-auto, read-only, workspace-write.`,
        "PHASE_CODEX_MODE_UNSUPPORTED",
      );
  }
}

function resolveCodexProfileArgs(
  config: HarnessConfig,
  phase: PhaseSpec,
): string[] {
  const configuredProfile = resolveToolModelProfile(
    config,
    phase.tool,
    phase.profile ?? phase.agent,
  );
  if (hasResolvedModelProfileFields(configuredProfile)) {
    return renderCodexConfigArgs(configuredProfile);
  }

  throw new HarnessError(
    `Codex phase "${phase.phase_id}" must resolve model config from harness.yaml models.codex for agent/profile "${phase.profile ?? phase.agent}".`,
    "PHASE_CODEX_PROFILE_MISSING",
  );
}

function buildSpawnPlan(
  config: HarnessConfig,
  phase: PhaseSpec,
  prompt: string,
  outputPath: string,
): SpawnPlan {
  if (phase.tool === "claude-code") {
    return {
      file: "claude",
      args: ["-p", ...resolveClaudeModeArgs(phase), prompt],
    };
  }

  if (phase.tool === "codex") {
    const modePlan = resolveCodexModePlan(phase);
    return {
      file: "codex",
      args: [
        "exec",
        ...resolveCodexProfileArgs(config, phase),
        ...modePlan.args,
        "--output-last-message",
        outputPath,
        ...(modePlan.fullAuto ? ["--full-auto"] : []),
        prompt,
      ],
    };
  }

  throw new HarnessError(
    `Unsupported phase tool: ${phase.tool}`,
    "PHASE_TOOL_UNSUPPORTED",
  );
}

async function hasNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function tailText(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : value.slice(value.length - maxChars);
}

function renderPartialOutput(options: {
  readonly reason: string;
  readonly stderr: string;
  readonly stdout: string;
}): string {
  const stdoutTail = tailText(options.stdout.trim(), 8_000);
  const stderrTail = tailText(options.stderr.trim(), 8_000);
  return [
    "# Partial Phase Output",
    "",
    `reason: ${options.reason}`,
    "",
    "## stdout tail",
    "",
    stdoutTail.length > 0 ? "```text" : "_empty_",
    ...(stdoutTail.length > 0 ? [stdoutTail, "```"] : []),
    "",
    "## stderr tail",
    "",
    stderrTail.length > 0 ? "```text" : "_empty_",
    ...(stderrTail.length > 0 ? [stderrTail, "```"] : []),
    "",
  ].join("\n");
}

function writeMirror(
  mirror: NodeJS.WritableStream | undefined,
  chunk: unknown,
): void {
  if (mirror) {
    mirror.write(String(chunk));
  }
}

function providerStallTimeoutMs(phase: PhaseSpec): number {
  return (
    (phase.provider_stall_timeout_seconds ?? 0) * 1000 ||
    DEFAULT_PROVIDER_STALL_TIMEOUT_MS
  );
}

export function resolveCwdRef(
  config: HarnessConfig,
  harnessRepoPath: string,
  cwdRef: string,
): string {
  if (cwdRef === "harness") {
    return path.resolve(harnessRepoPath);
  }

  const targetName = parseNamedCwdRef(cwdRef, "target");
  if (targetName !== undefined) {
    const target = config.projects?.targets[targetName];
    if (!target) {
      throw new HarnessError(
        `Missing target cwd_ref: ${cwdRef}`,
        "PHASE_CWD_REF_MISSING",
      );
    }

    return resolveProjectPath(harnessRepoPath, target.path);
  }

  const referenceName = parseNamedCwdRef(cwdRef, "reference");
  if (referenceName !== undefined) {
    const reference = config.projects?.references[referenceName];
    if (!reference) {
      throw new HarnessError(
        `Missing reference cwd_ref: ${cwdRef}`,
        "PHASE_CWD_REF_MISSING",
      );
    }

    return resolveProjectPath(harnessRepoPath, reference.path);
  }

  throw new HarnessError(
    `Unsupported cwd_ref: ${cwdRef}`,
    "PHASE_CWD_REF_UNSUPPORTED",
  );
}

export async function runPhase(
  options: PhaseExecutionOptions,
): Promise<PhaseExecutionResult> {
  const cwd = resolveCwdRef(
    options.config,
    options.harnessRepoPath,
    options.phase.cwd_ref,
  );
  const currentPhaseDirectory = phaseDirectory(
    options.paths,
    options.phase.phase_id,
  );
  const stdoutPath = path.join(currentPhaseDirectory, "stdout.log");
  const stderrPath = path.join(currentPhaseDirectory, "stderr.log");
  const promptPath = path.join(currentPhaseDirectory, "prompt.md");
  const outputPath = path.join(currentPhaseDirectory, "output.md");
  const partialOutputPath = path.join(
    currentPhaseDirectory,
    "partial-output.md",
  );
  const exitCodePath = path.join(currentPhaseDirectory, "exit_code.json");
  const costPath = path.join(currentPhaseDirectory, "cost.json");
  const sessionPath = path.join(currentPhaseDirectory, "session.json");
  const promptSha256 = createPhasePromptSha256(options.prompt);
  const promptWithFingerprint = injectPhaseFingerprint(
    options.prompt,
    options.phase,
    promptSha256,
  );
  const spawnPlan = buildSpawnPlan(
    options.config,
    options.phase,
    promptWithFingerprint,
    outputPath,
  );
  const spawnImpl = options.spawnImpl ?? spawn;
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  let stdoutBuffer = "";
  let stderrBuffer = "";

  await mkdir(currentPhaseDirectory, { recursive: true });
  await Promise.all([
    writeFile(stdoutPath, "", "utf8"),
    writeFile(stderrPath, "", "utf8"),
    writeFile(promptPath, promptWithFingerprint, "utf8"),
  ]);

  if (
    options.preflightGateFailures !== undefined &&
    options.preflightGateFailures.length > 0
  ) {
    const reason = `preflight-gate-failed:${options.preflightGateFailures.map((failure) => failure.id).join(",")}`;
    const partialOutput = renderPartialOutput({
      reason,
      stderr: options.preflightGateFailures
        .map((failure) => failure.stderr)
        .filter((value) => value.trim().length > 0)
        .join("\n"),
      stdout: options.preflightGateFailures
        .map((failure) => failure.stdout)
        .filter((value) => value.trim().length > 0)
        .join("\n"),
    });
    await writeFile(partialOutputPath, partialOutput, "utf8");
    const completedAt = Date.now();
    const baseResult: PhaseExecutionResult = {
      cwd,
      duration_ms: completedAt - startedAt,
      exit_code: 1,
      output_path: outputPath,
      partial_output_path: partialOutputPath,
      phase_id: options.phase.phase_id,
      prompt_sha256: promptSha256,
      reason,
      signal: null,
      status: "failed",
    };
    const trajectorySummary = await capturePhaseTrajectory({
      completedAtMs: completedAt,
      cwd,
      ...(options.trajectoryHomeDir
        ? { homeDir: options.trajectoryHomeDir }
        : {}),
      paths: options.paths,
      phase: options.phase,
      promptSha256,
      startedAtIso,
      startedAtMs: startedAt,
    });
    const audits = await runPhaseAudits({
      ...(options.auditJudge ? { auditJudge: options.auditJudge } : {}),
      ...(options.deterministicGateResult
        ? { deterministicGateResult: options.deterministicGateResult }
        : {}),
      contextRoot: cwd,
      partialOutputMd: partialOutput,
      paths: options.paths,
      phase: options.phase,
      phaseResult: baseResult,
      prompt: promptWithFingerprint,
      trajectorySummary,
    });
    const auditBlocked = audits.some((audit) => audit.blocked);
    const result: PhaseExecutionResult = {
      ...baseResult,
      audit_blocked: auditBlocked,
      audits,
      trajectory_summary: trajectorySummary,
    };
    await writeFile(
      sessionPath,
      `${JSON.stringify(
        {
          agent: options.phase.agent,
          audit_blocked: auditBlocked,
          completed_at_iso: new Date().toISOString(),
          cwd,
          cwd_ref: options.phase.cwd_ref,
          phase_id: options.phase.phase_id,
          profile: options.phase.profile,
          mode: options.phase.mode,
        prompt_sha256: promptSha256,
        spawn_args: [],
        started_at_iso: startedAtIso,
        status: "failed",
        task_card_hash: options.taskCardHash,
        tool: options.phase.tool,
        trajectory_status: trajectorySummary.status,
      },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      exitCodePath,
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    return result;
  }

  const child = spawnImpl(spawnPlan.file, spawnPlan.args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let providerStallDetail: string | undefined;
  let providerStallTimer: NodeJS.Timeout | undefined;

  const clearProviderStallTimer = (): void => {
    if (providerStallTimer) {
      clearTimeout(providerStallTimer);
      providerStallTimer = undefined;
    }
  };
  const markProviderStalled = (detail: string): void => {
    if (providerStallDetail !== undefined) {
      return;
    }

    providerStallDetail = detail;
    const message = `[harness] provider stalled: ${detail}\n`;
    stderrBuffer = `${stderrBuffer}${stderrBuffer.endsWith("\n") || stderrBuffer.length === 0 ? "" : "\n"}${message}`;
    writeMirror(options.stderrMirror, message);
    void writeFile(stderrPath, stderrBuffer, "utf8");
    child.kill("SIGTERM");
  };
  const refreshProviderStallTimer = (): void => {
    clearProviderStallTimer();
    providerStallTimer = setTimeout(() => {
      markProviderStalled(
        `no provider output for ${providerStallTimeoutMs(options.phase) / 1000}s`,
      );
    }, providerStallTimeoutMs(options.phase));
    providerStallTimer.unref?.();
  };
  const inspectProviderOutput = (chunk: unknown): void => {
    const text = String(chunk);
    if (PROVIDER_RECONNECT_EXHAUSTED_PATTERN.test(text)) {
      markProviderStalled("reconnect exhausted");
      return;
    }

    refreshProviderStallTimer();
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  refreshProviderStallTimer();
  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    writeMirror(options.stdoutMirror, chunk);
    inspectProviderOutput(chunk);
    void writeFile(stdoutPath, stdoutBuffer, "utf8");
  });
  child.stderr?.on("data", (chunk) => {
    stderrBuffer += String(chunk);
    writeMirror(options.stderrMirror, chunk);
    inspectProviderOutput(chunk);
    void writeFile(stderrPath, stderrBuffer, "utf8");
  });

  const closeResult = await new Promise<{
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", (error) => {
      clearProviderStallTimer();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearProviderStallTimer();
      resolve({ exitCode, signal });
    });
  });
  await Promise.all([
    writeFile(stdoutPath, stdoutBuffer, "utf8"),
    writeFile(stderrPath, stderrBuffer, "utf8"),
  ]);

  const resolvedOutputMd =
    options.outputMd ??
    (stdoutBuffer.trim().length > 0 ? stdoutBuffer : undefined);
  if (resolvedOutputMd !== undefined) {
    await writeFile(outputPath, resolvedOutputMd, "utf8");
  }

  if (options.cost !== undefined) {
    await writeFile(
      costPath,
      `${JSON.stringify(options.cost, null, 2)}\n`,
      "utf8",
    );
  }

  const sessionId = inferSessionIdFromText(`${stdoutBuffer}\n${stderrBuffer}`);
  const completedAt = Date.now();
  const outputExists = await hasNonEmptyFile(outputPath);
  const status =
    providerStallDetail === undefined &&
    closeResult.exitCode === 0 &&
    outputExists
      ? "completed"
      : "failed";
  const reason =
    status === "completed"
      ? undefined
      : providerStallDetail !== undefined
        ? "provider_stalled"
        : closeResult.exitCode !== 0
          ? "non-zero-exit"
          : "phase-output-missing-or-empty";
  const partialOutput =
    status === "failed"
      ? renderPartialOutput({
          reason:
            providerStallDetail !== undefined
              ? `provider_stalled: ${providerStallDetail}`
              : (reason ?? "unknown failure"),
          stderr: stderrBuffer,
          stdout: stdoutBuffer,
        })
      : undefined;
  if (partialOutput !== undefined) {
    await writeFile(partialOutputPath, partialOutput, "utf8");
  }
  const baseResult: PhaseExecutionResult = {
    cwd,
    duration_ms: completedAt - startedAt,
    exit_code: closeResult.exitCode,
    output_path: outputPath,
    ...(partialOutput !== undefined
      ? { partial_output_path: partialOutputPath }
      : {}),
    phase_id: options.phase.phase_id,
    prompt_sha256: promptSha256,
    ...(providerStallDetail !== undefined
      ? { provider_stall_detail: providerStallDetail }
      : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(sessionId !== undefined ? { session_id: sessionId } : {}),
    signal: closeResult.signal,
    status,
  };

  const trajectorySummary = await capturePhaseTrajectory({
    completedAtMs: completedAt,
    cwd,
    ...(options.trajectoryHomeDir
      ? { homeDir: options.trajectoryHomeDir }
      : {}),
    paths: options.paths,
    phase: options.phase,
    ...(options.trajectoryPath
      ? { rawTrajectoryPath: options.trajectoryPath }
      : {}),
    ...(sessionId ? { sessionId } : {}),
    promptSha256,
    startedAtIso,
    startedAtMs: startedAt,
  });
  const resolvedSessionId = sessionId ?? trajectorySummary.session_id;
  const auditedBaseResult: PhaseExecutionResult = {
    ...baseResult,
    ...(resolvedSessionId ? { session_id: resolvedSessionId } : {}),
  };
  const audits = await runPhaseAudits({
    ...(options.auditJudge ? { auditJudge: options.auditJudge } : {}),
    ...(options.deterministicGateResult
      ? { deterministicGateResult: options.deterministicGateResult }
      : {}),
    contextRoot: cwd,
    ...(resolvedOutputMd !== undefined ? { outputMd: resolvedOutputMd } : {}),
    ...(partialOutput !== undefined ? { partialOutputMd: partialOutput } : {}),
    paths: options.paths,
    phase: options.phase,
    phaseResult: auditedBaseResult,
    prompt: promptWithFingerprint,
    trajectorySummary,
  });
  const auditBlocked = audits.some((audit) => audit.blocked);
  const result: PhaseExecutionResult = {
    ...auditedBaseResult,
    audit_blocked: auditBlocked,
    audits,
    trajectory_summary: trajectorySummary,
  };

  await writeFile(
    sessionPath,
    `${JSON.stringify(
      {
        agent: options.phase.agent,
        audit_blocked: auditBlocked,
        completed_at_iso: new Date().toISOString(),
        cwd,
        cwd_ref: options.phase.cwd_ref,
        phase_id: options.phase.phase_id,
        profile: options.phase.profile,
        mode: options.phase.mode,
        prompt_sha256: promptSha256,
        ...(providerStallDetail !== undefined
          ? { provider_stall_detail: providerStallDetail }
          : {}),
        session_id: resolvedSessionId,
        spawn_args: [spawnPlan.file, ...spawnPlan.args],
        started_at_iso: startedAtIso,
        status,
        task_card_hash: options.taskCardHash,
        tool: options.phase.tool,
        trajectory_status: trajectorySummary.status,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(exitCodePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function runPhaseGroup(
  options: PhaseGroupExecutionOptions,
): Promise<PhaseExecutionResult[]> {
  const results = await Promise.all(
    options.phases.map((phase) =>
      runPhase({
        config: options.config,
        harnessRepoPath: options.harnessRepoPath,
        paths: options.paths,
        phase,
        prompt: options.promptByPhase[phase.phase_id] ?? "",
        ...(options.costs?.[phase.phase_id] !== undefined
          ? { cost: options.costs[phase.phase_id] }
          : {}),
        ...(options.outputMdByPhase?.[phase.phase_id] !== undefined
          ? { outputMd: options.outputMdByPhase[phase.phase_id] }
          : {}),
        ...(options.spawnImpl ? { spawnImpl: options.spawnImpl } : {}),
        ...(options.stderrMirror ? { stderrMirror: options.stderrMirror } : {}),
        ...(options.stdoutMirror ? { stdoutMirror: options.stdoutMirror } : {}),
        ...(options.taskCardHash ? { taskCardHash: options.taskCardHash } : {}),
        ...(options.auditJudge ? { auditJudge: options.auditJudge } : {}),
        ...(options.trajectoryHomeDir
          ? { trajectoryHomeDir: options.trajectoryHomeDir }
          : {}),
      }),
    ),
  );
  const groupId = options.phases.find(
    (phase) => phase.parallel_group,
  )?.parallel_group;
  if (groupId) {
    await runPhaseGroupAudit({
      groupId,
      paths: options.paths,
      phases: options.phases,
      results,
    });
  }

  return results;
}

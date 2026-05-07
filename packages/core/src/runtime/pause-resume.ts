import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { HarnessError } from "../errors.js";
import type { RunStorePaths } from "./run-store.js";

export const runStateSchema = z
  .object({
    current_checkpoint_id: z.string().min(1).optional(),
    estimated_dollars: z.number().nonnegative(),
    escalation_counts: z.record(z.string().min(1), z.number().int().nonnegative()).default({}),
    pending_request_path: z.string().min(1).optional(),
    run_id: z.string().min(1),
    started_at_iso: z.string().datetime(),
    status: z.enum(["running", "paused", "completed", "failed", "needs_user_review"]),
    thread_id: z.string().min(1)
  })
  .strict();

export type RunState = z.infer<typeof runStateSchema>;

export interface PauseResumeClock {
  readonly nowIso?: () => string;
}

export interface EscalationRequestResult {
  readonly requestPath?: string;
  readonly state: RunState;
  readonly status: "paused" | "failed";
  readonly summaryPath?: string;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function getNowIso(clock: PauseResumeClock = {}): string {
  return clock.nowIso?.() ?? new Date().toISOString();
}

function requestPathFor(paths: RunStorePaths, nowIso: string): string {
  return path.join(paths.notificationsDir, `${safeTimestamp(nowIso)}.request.md`);
}

function decisionPathFor(requestPath: string): string {
  return requestPath.replace(/\.request\.md$/, ".decision.md");
}

async function scanPhaseIds(paths: RunStorePaths): Promise<string[]> {
  try {
    return (await readdir(paths.phasesDir)).sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function loadRunState(paths: RunStorePaths): Promise<RunState> {
  return runStateSchema.parse(await readJson(paths.statePath));
}

export async function saveRunState(paths: RunStorePaths, state: RunState): Promise<void> {
  await writeJson(paths.statePath, runStateSchema.parse(state));
}

export async function writeEscalationRequest(
  paths: RunStorePaths,
  checkpointId: string,
  questionMd: string,
  clock: PauseResumeClock = {}
): Promise<EscalationRequestResult> {
  const state = await loadRunState(paths);
  const escalationCount = state.escalation_counts[checkpointId] ?? 0;
  const nextEscalationCounts = {
    ...state.escalation_counts,
    [checkpointId]: escalationCount + 1
  };

  if (escalationCount >= 1) {
    const summaryPath = path.join(paths.rootDir, "summary.md");
    const failedState: RunState = {
      ...state,
      current_checkpoint_id: checkpointId,
      escalation_counts: nextEscalationCounts,
      status: "failed"
    };

    await saveRunState(paths, failedState);
    await writeFile(
      summaryPath,
      [`# Autonomous Run Failed`, "", `Checkpoint \`${checkpointId}\` escalated twice.`, ""].join("\n"),
      "utf8"
    );
    return {
      state: failedState,
      status: "failed",
      summaryPath
    };
  }

  const nowIso = getNowIso(clock);
  const requestPath = requestPathFor(paths, nowIso);
  const pausedState: RunState = {
    ...state,
    current_checkpoint_id: checkpointId,
    escalation_counts: nextEscalationCounts,
    pending_request_path: requestPath,
    status: "paused"
  };

  await mkdir(paths.notificationsDir, { recursive: true });
  await writeFile(requestPath, questionMd, "utf8");
  await saveRunState(paths, pausedState);

  return {
    requestPath,
    state: pausedState,
    status: "paused"
  };
}

export async function resumeRunFromDecision(paths: RunStorePaths): Promise<RunState> {
  const state = await loadRunState(paths);

  if (state.status !== "paused") {
    throw new HarnessError(`Cannot resume run with status "${state.status}".`, "RUN_RESUME_INVALID_STATUS");
  }

  if (!state.pending_request_path) {
    throw new HarnessError("Paused run is missing pending_request_path.", "RUN_RESUME_MISSING_REQUEST");
  }

  const decisionPath = decisionPathFor(state.pending_request_path);
  const decisionMd = await readFile(decisionPath, "utf8");
  if (decisionMd.trim().length === 0) {
    throw new HarnessError(`Resume decision is empty: ${decisionPath}`, "RUN_RESUME_EMPTY_DECISION");
  }

  const runningState: RunState = {
    ...state,
    pending_request_path: undefined,
    status: "running"
  };

  await saveRunState(paths, runningState);
  return runningState;
}

export async function recoverCorruptedRunState(paths: RunStorePaths, clock: PauseResumeClock = {}): Promise<EscalationRequestResult> {
  let existingState: RunState | undefined;

  try {
    existingState = await loadRunState(paths);
  } catch {
    existingState = undefined;
  }

  const nowIso = getNowIso(clock);
  const requestPath = requestPathFor(paths, nowIso);
  const recoveredState: RunState = {
    current_checkpoint_id: "state-recovery",
    estimated_dollars: existingState?.estimated_dollars ?? 0,
    escalation_counts: existingState?.escalation_counts ?? {},
    pending_request_path: requestPath,
    run_id: existingState?.run_id ?? path.basename(paths.rootDir),
    started_at_iso: existingState?.started_at_iso ?? nowIso,
    status: "needs_user_review",
    thread_id: existingState?.thread_id ?? path.basename(paths.rootDir)
  };
  const phaseIds = await scanPhaseIds(paths);

  await mkdir(paths.notificationsDir, { recursive: true });
  await writeFile(
    requestPath,
    [
      "# Run State Recovery Required",
      "",
      "The autonomous run state is missing or corrupted.",
      "",
      `Known phase artifact directories: ${phaseIds.length > 0 ? phaseIds.map((phaseId) => `\`${phaseId}\``).join(", ") : "none"}`,
      ""
    ].join("\n"),
    "utf8"
  );
  await saveRunState(paths, recoveredState);

  return {
    requestPath,
    state: recoveredState,
    status: "paused"
  };
}

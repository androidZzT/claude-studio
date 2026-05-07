import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { HarnessError } from "../errors.js";

export const RUN_EVENT_KINDS = [
  "phase_start",
  "phase_end",
  "checkpoint",
  "escalate",
  "resume",
  "gate_fail",
  "trajectory",
  "audit",
  "visualization",
] as const;

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export const runEventSchema = z
  .object({
    ts: z.string().datetime(),
    kind: z.enum(RUN_EVENT_KINDS),
    phase_id: z.string().min(1),
    payload: z.record(z.unknown()),
  })
  .strict();

export const runLockSchema = z
  .object({
    pid: z.number().int().positive(),
    hostname: z.string().min(1),
    started_at_iso: z.string().datetime(),
    run_id: z.string().min(1),
  })
  .strict();

const costFileSchema = z
  .object({
    tokens_in: z.number().nonnegative().optional(),
    tokens_out: z.number().nonnegative().optional(),
    model: z.string().min(1).optional(),
    dollars: z.number().nonnegative(),
  })
  .passthrough();

export type RunEvent = z.infer<typeof runEventSchema>;
export type RunLock = z.infer<typeof runLockSchema>;

export interface RunStorePaths {
  readonly auditsDir: string;
  readonly checkpointsDir: string;
  readonly eventsPath: string;
  readonly gatesDir: string;
  readonly lockPath: string;
  readonly notificationsDir: string;
  readonly phasesDir: string;
  readonly rollbackDir: string;
  readonly rootDir: string;
  readonly statePath: string;
  readonly taskCardHashPath: string;
  readonly taskCardPath: string;
  readonly trajectoryDir: string;
  readonly validationDir: string;
  readonly visualizationDir: string;
}

export interface RunStoreProcessInfo {
  readonly hostname?: string;
  readonly isPidAlive?: (pid: number) => boolean;
  readonly nowIso?: () => string;
  readonly pid?: number;
}

export type RunLiveness = "alive" | "stale" | "terminal" | "unlocked";

export interface RunLivenessReport {
  readonly liveness: RunLiveness;
  readonly lock?: RunLock;
  readonly state_status?: string;
}

export interface InitializeRunStoreOptions {
  readonly brief?: string;
  readonly harnessRepoPath: string;
  readonly processInfo?: RunStoreProcessInfo;
  readonly runId: string;
  readonly runRoot?: string;
  readonly threadId: string;
}

interface RunState {
  readonly estimated_dollars: number;
  readonly run_id: string;
  readonly started_at_iso: string;
  readonly status: "running";
  readonly thread_id: string;
}

const looseRunStateSchema = z
  .object({
    status: z.string().optional(),
  })
  .passthrough();

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function normalizeGitignorePattern(value: string): string | undefined {
  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("!")
  ) {
    return undefined;
  }

  return stripTrailingSlash(trimmed.replace(/^\//, "").replace(/\/\*\*$/, ""));
}

function isInsideOrEqual(parentDir: string, candidatePath: string): boolean {
  const relative = path.relative(parentDir, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function gitignorePatternMatches(
  pattern: string,
  relativePath: string,
): boolean {
  const normalizedPattern = normalizeGitignorePattern(pattern);
  const normalizedRelativePath = stripTrailingSlash(relativePath);

  if (!normalizedPattern) {
    return false;
  }

  return (
    normalizedRelativePath === normalizedPattern ||
    normalizedRelativePath.startsWith(`${normalizedPattern}/`)
  );
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function readJsonIfExists(
  filePath: string,
): Promise<unknown | undefined> {
  const source = await readTextIfExists(filePath);
  return source === undefined ? undefined : JSON.parse(source);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function getProcessInfo(
  processInfo: RunStoreProcessInfo = {},
): Required<RunStoreProcessInfo> {
  return {
    hostname: processInfo.hostname ?? os.hostname(),
    isPidAlive:
      processInfo.isPidAlive ??
      ((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }),
    nowIso: processInfo.nowIso ?? (() => new Date().toISOString()),
    pid: processInfo.pid ?? process.pid,
  };
}

function assertRunLockOwned(
  lock: RunLock,
  runId: string,
  processInfo: Required<RunStoreProcessInfo>,
): void {
  if (
    lock.hostname !== processInfo.hostname ||
    lock.pid !== processInfo.pid ||
    lock.run_id !== runId
  ) {
    throw new HarnessError(
      "Run lock is owned by another process.",
      "RUN_LOCK_NOT_OWNED",
    );
  }
}

export function getDefaultRunRoot(
  harnessRepoPath: string,
  threadId: string,
): string {
  return path.resolve(harnessRepoPath, ".harness", "runs", threadId);
}

export function getRunStorePaths(runRoot: string): RunStorePaths {
  return {
    auditsDir: path.join(runRoot, "audits"),
    checkpointsDir: path.join(runRoot, "checkpoints"),
    eventsPath: path.join(runRoot, "events.jsonl"),
    gatesDir: path.join(runRoot, "gates"),
    lockPath: path.join(runRoot, "lock"),
    notificationsDir: path.join(runRoot, "notifications"),
    phasesDir: path.join(runRoot, "phases"),
    rollbackDir: path.join(runRoot, "rollback"),
    rootDir: runRoot,
    statePath: path.join(runRoot, "state.json"),
    taskCardHashPath: path.join(runRoot, "task-card.sha256"),
    taskCardPath: path.join(runRoot, "task-card.json"),
    trajectoryDir: path.join(runRoot, "trajectory"),
    validationDir: path.join(runRoot, "validation"),
    visualizationDir: path.join(runRoot, "visualization"),
  };
}

export async function isPathIgnoredByGitignore(
  harnessRepoPath: string,
  candidatePath: string,
): Promise<boolean> {
  const resolvedRepo = path.resolve(harnessRepoPath);
  const resolvedCandidate = path.resolve(candidatePath);

  if (!isInsideOrEqual(resolvedRepo, resolvedCandidate)) {
    return true;
  }

  const relativePath = toPortablePath(
    path.relative(resolvedRepo, resolvedCandidate),
  );
  const gitignore = await readTextIfExists(
    path.join(resolvedRepo, ".gitignore"),
  );

  return (gitignore ?? "")
    .split(/\r?\n/)
    .some((line) => gitignorePatternMatches(line, relativePath));
}

export async function preflightRunRoot(
  harnessRepoPath: string,
  runRoot: string,
): Promise<void> {
  if (!(await isPathIgnoredByGitignore(harnessRepoPath, runRoot))) {
    throw new HarnessError(
      `Run root must be ignored before autonomous execution writes artifacts: ${runRoot}`,
      "RUN_ROOT_NOT_IGNORED",
    );
  }
}

export async function acquireRunLock(
  paths: RunStorePaths,
  runId: string,
  processInfoInput: RunStoreProcessInfo = {},
): Promise<RunLock> {
  const processInfo = getProcessInfo(processInfoInput);
  const existingSource = await readTextIfExists(paths.lockPath);

  if (existingSource) {
    const existingLock = runLockSchema.parse(JSON.parse(existingSource));
    const sameOwner =
      existingLock.hostname === processInfo.hostname &&
      existingLock.pid === processInfo.pid &&
      existingLock.run_id === runId;

    if (sameOwner) {
      return existingLock;
    }

    if (
      existingLock.hostname !== processInfo.hostname ||
      processInfo.isPidAlive(existingLock.pid)
    ) {
      throw new HarnessError(
        `Run ${existingLock.run_id} is locked by ${existingLock.hostname}:${existingLock.pid}.`,
        "RUN_LOCK_HELD",
      );
    }

    await rm(paths.lockPath, { force: true });
  }

  const nextLock: RunLock = {
    pid: processInfo.pid,
    hostname: processInfo.hostname,
    started_at_iso: processInfo.nowIso(),
    run_id: runId,
  };

  await writeJson(paths.lockPath, nextLock);
  return nextLock;
}

export async function inspectRunLiveness(
  paths: RunStorePaths,
  processInfoInput: RunStoreProcessInfo = {},
): Promise<RunLivenessReport> {
  const processInfo = getProcessInfo(processInfoInput);
  const state = looseRunStateSchema.parse(
    (await readJsonIfExists(paths.statePath)) ?? {},
  );
  const lock = runLockSchema.safeParse(await readJsonIfExists(paths.lockPath));

  if (state.status && state.status !== "running") {
    return {
      liveness: "terminal",
      ...(lock.success ? { lock: lock.data } : {}),
      state_status: state.status,
    };
  }

  if (!lock.success) {
    return {
      liveness: "unlocked",
      ...(state.status ? { state_status: state.status } : {}),
    };
  }

  const isAlive =
    lock.data.hostname === processInfo.hostname &&
    processInfo.isPidAlive(lock.data.pid);
  return {
    liveness: isAlive ? "alive" : "stale",
    lock: lock.data,
    ...(state.status ? { state_status: state.status } : {}),
  };
}

function renderInterruptedPartialOutput(options: {
  readonly phaseId: string;
  readonly stderr: string;
  readonly stdout: string;
}): string {
  return [
    "# Partial Phase Output",
    "",
    "reason: interrupted",
    "",
    `phase_id: ${options.phaseId}`,
    "",
    "## stdout tail",
    "",
    options.stdout.trim().length > 0 ? "```text" : "_empty_",
    ...(options.stdout.trim().length > 0
      ? [options.stdout.slice(-8_000), "```"]
      : []),
    "",
    "## stderr tail",
    "",
    options.stderr.trim().length > 0 ? "```text" : "_empty_",
    ...(options.stderr.trim().length > 0
      ? [options.stderr.slice(-8_000), "```"]
      : []),
    "",
  ].join("\n");
}

export async function repairInterruptedPhaseArtifacts(
  paths: RunStorePaths,
): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(paths.phasesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const repaired: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const phaseId = entry.name;
    const phaseDir = path.join(paths.phasesDir, phaseId);
    const exitCodePath = path.join(phaseDir, "exit_code.json");
    if (await pathExists(exitCodePath)) {
      continue;
    }

    const promptPath = path.join(phaseDir, "prompt.md");
    if (!(await pathExists(promptPath))) {
      continue;
    }

    const stdout =
      (await readTextIfExists(path.join(phaseDir, "stdout.log"))) ?? "";
    const stderr =
      (await readTextIfExists(path.join(phaseDir, "stderr.log"))) ?? "";
    const partialOutputPath = path.join(phaseDir, "partial-output.md");
    const outputPath = path.join(phaseDir, "output.md");
    const partialOutput = renderInterruptedPartialOutput({
      phaseId,
      stderr,
      stdout,
    });
    const result = {
      cwd: "",
      duration_ms: 0,
      exit_code: null,
      output_path: outputPath,
      partial_output_path: partialOutputPath,
      phase_id: phaseId,
      reason: "interrupted",
      signal: null,
      status: "failed",
    };
    await Promise.all([
      writeFile(partialOutputPath, partialOutput, "utf8"),
      writeJson(exitCodePath, result),
      writeJson(path.join(phaseDir, "session.json"), {
        phase_id: phaseId,
        status: "failed",
        trajectory_status: "missing",
      }),
    ]);
    repaired.push(phaseId);
  }

  return repaired;
}

export async function appendRunEvent(
  paths: RunStorePaths,
  runId: string,
  event: RunEvent,
  processInfoInput: RunStoreProcessInfo = {},
): Promise<void> {
  const processInfo = getProcessInfo(processInfoInput);
  const lock = runLockSchema.parse(await readJsonIfExists(paths.lockPath));
  assertRunLockOwned(lock, runId, processInfo);

  await mkdir(path.dirname(paths.eventsPath), { recursive: true });
  await appendFile(
    paths.eventsPath,
    `${JSON.stringify(runEventSchema.parse(event))}\n`,
    "utf8",
  );
}

async function readCostFiles(directoryPath: string): Promise<number[]> {
  let entries: string[];

  try {
    entries = await readdir(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const dollars: number[] = [];

  for (const entry of entries) {
    const costPath = path.join(directoryPath, entry, "cost.json");
    const parsed = await readJsonIfExists(costPath);
    if (parsed !== undefined) {
      dollars.push(costFileSchema.parse(parsed).dollars);
    }
  }

  return dollars;
}

export async function recomputeEstimatedDollars(
  paths: RunStorePaths,
): Promise<number> {
  const [phaseCosts, checkpointCosts] = await Promise.all([
    readCostFiles(paths.phasesDir),
    readCostFiles(paths.checkpointsDir),
  ]);
  return [...phaseCosts, ...checkpointCosts].reduce(
    (sum, dollars) => sum + dollars,
    0,
  );
}

export async function initializeRunStore(
  options: InitializeRunStoreOptions,
): Promise<{ readonly lock: RunLock; readonly paths: RunStorePaths }> {
  const runRoot = path.resolve(
    options.runRoot ??
      getDefaultRunRoot(options.harnessRepoPath, options.threadId),
  );
  await preflightRunRoot(options.harnessRepoPath, runRoot);

  const paths = getRunStorePaths(runRoot);
  await Promise.all([
    mkdir(paths.auditsDir, { recursive: true }),
    mkdir(paths.phasesDir, { recursive: true }),
    mkdir(paths.trajectoryDir, { recursive: true }),
    mkdir(paths.visualizationDir, { recursive: true }),
    mkdir(paths.gatesDir, { recursive: true }),
    mkdir(paths.checkpointsDir, { recursive: true }),
    mkdir(paths.notificationsDir, { recursive: true }),
    mkdir(paths.rollbackDir, { recursive: true }),
    mkdir(paths.validationDir, { recursive: true }),
  ]);

  const lock = await acquireRunLock(paths, options.runId, options.processInfo);
  const processInfo = getProcessInfo(options.processInfo);

  if (options.brief !== undefined) {
    await writeFile(
      path.join(paths.rootDir, "brief.md"),
      options.brief,
      "utf8",
    );
  }

  const state: RunState = {
    estimated_dollars: await recomputeEstimatedDollars(paths),
    run_id: options.runId,
    started_at_iso: lock.started_at_iso,
    status: "running",
    thread_id: options.threadId,
  };

  await writeJson(paths.statePath, state);
  await appendRunEvent(
    paths,
    options.runId,
    {
      ts: processInfo.nowIso(),
      kind: "resume",
      phase_id: "run-store",
      payload: {
        status: "initialized",
      },
    },
    options.processInfo,
  );

  return {
    lock,
    paths,
  };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

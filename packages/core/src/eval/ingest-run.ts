import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_EVAL_LOGS_PATH, EVAL_LOG_EXTENSION } from "../constants.js";
import { HarnessError } from "../errors.js";
import { getDefaultRunRoot, getRunStorePaths } from "../runtime/run-store.js";

import { commonEventSchema } from "./common-event.js";
import type { CommonEvent, CommonEventSource } from "./common-event.js";
import { validateEvalLog, writeEvalLog } from "./evallog-writer.js";
import type { EvalLogMeta } from "./evallog-writer.js";
import { scoreFunnel } from "./scorer/funnel.js";
import { createFunnelEvalLogScore } from "./scorer/types.js";

export interface IngestRunTrajectoryOptions {
  readonly harnessRepoPath?: string;
  readonly outDir?: string;
  readonly runRoot?: string;
  readonly scenarioId?: string;
  readonly threadId: string;
}

export interface IngestRunTrajectoryResult {
  readonly eventCount: number;
  readonly outPath: string;
  readonly phaseCount: number;
  readonly runRoot: string;
}

function createRunId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `run_${timestamp}_${randomUUID().split("-")[0]}`;
}

async function listPhaseTrajectoryFiles(
  trajectoryDir: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(trajectoryDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(trajectoryDir, entry.name, "common-events.jsonl"))
    .sort((left, right) => left.localeCompare(right));
}

async function readCommonEventsJsonl(
  filePath: string,
): Promise<readonly CommonEvent[]> {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => commonEventSchema.parse(JSON.parse(line)));
}

function firstSource(events: readonly CommonEvent[]): CommonEventSource {
  return events[0]?.source ?? "stub";
}

function createMeta(
  events: readonly CommonEvent[],
  scenarioId: string,
  threadId: string,
  runId: string,
): EvalLogMeta {
  const funnelScore = scoreFunnel({ events });
  return {
    runId,
    scenarioId,
    sessionId: threadId,
    source: firstSource(events),
    scores: [createFunnelEvalLogScore(funnelScore)],
  };
}

export async function ingestRunTrajectory(
  options: IngestRunTrajectoryOptions,
): Promise<IngestRunTrajectoryResult> {
  const harnessRepoPath = path.resolve(
    options.harnessRepoPath ?? process.cwd(),
  );
  const runRoot = path.resolve(
    options.runRoot ?? getDefaultRunRoot(harnessRepoPath, options.threadId),
  );
  const paths = getRunStorePaths(runRoot);
  const phaseTrajectoryFiles = await listPhaseTrajectoryFiles(
    paths.trajectoryDir,
  );
  const eventsByPhase = await Promise.all(
    phaseTrajectoryFiles.map((filePath) => readCommonEventsJsonl(filePath)),
  );
  const events = eventsByPhase.flat();

  if (events.length === 0) {
    throw new HarnessError(
      `No captured common trajectory events found under ${paths.trajectoryDir}.`,
      "EVAL_RUN_TRAJECTORY_EMPTY",
    );
  }

  const scenarioId = options.scenarioId ?? options.threadId;
  const runId = createRunId();
  const outDir = path.resolve(
    options.outDir ??
      path.join(harnessRepoPath, DEFAULT_EVAL_LOGS_PATH, scenarioId),
  );
  const outPath = path.join(outDir, `${runId}${EVAL_LOG_EXTENSION}`);
  await writeEvalLog(
    [...events],
    createMeta(events, scenarioId, options.threadId, runId),
    outPath,
  );
  const source = await readFile(outPath, "utf8");
  if (!validateEvalLog(JSON.parse(source))) {
    throw new HarnessError(
      `Eval log written from run ${options.threadId} failed validation.`,
      "EVAL_INVALID_LOG",
    );
  }

  return {
    eventCount: events.length,
    outPath,
    phaseCount: eventsByPhase.filter((phaseEvents) => phaseEvents.length > 0)
      .length,
    runRoot,
  };
}

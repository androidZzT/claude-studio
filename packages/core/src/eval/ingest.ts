import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_EVAL_LOGS_PATH, EVAL_LOG_EXTENSION } from "../constants.js";
import { HarnessError } from "../errors.js";

import { commonEventSchema } from "./common-event.js";
import type { CommonEventSource } from "./common-event.js";
import { validateEvalLog, writeEvalLog } from "./evallog-writer.js";
import type { EvalLogMeta } from "./evallog-writer.js";
import { scoreFunnel } from "./scorer/funnel.js";
import { createFunnelEvalLogScore } from "./scorer/types.js";
import type { CommonEvent } from "./common-event.js";
import type { QualityScoreInputs } from "./scorer/types.js";
import type { TrajectoryAdapter } from "./trajectory-adapter.js";

export interface IngestTrajectoryOptions {
  readonly adapter: TrajectoryAdapter;
  readonly jsonlPath: string;
  readonly outDir?: string;
  readonly qualityInputs?: QualityScoreInputs;
  readonly scenarioId: string;
  readonly sessionId?: string;
}

export interface IngestTrajectoryResult {
  readonly outPath: string;
  readonly eventCount: number;
}

export interface EvalLogListEntry {
  readonly created: string;
  readonly event_count: number;
  readonly run_id: string;
  readonly scenario_id: string;
  readonly source: CommonEventSource;
}

export interface EvalLogFileMatch {
  readonly entry: EvalLogListEntry;
  readonly path: string;
}

interface EvalLogLike {
  readonly eval: {
    readonly created: string;
    readonly run_id: string;
    readonly metadata: {
      readonly scenario_id: string;
      readonly source: CommonEventSource;
    };
  };
  readonly samples: readonly {
    readonly events: readonly unknown[];
  }[];
}

interface ListEvalLogsOptions {
  readonly logsDir?: string;
  readonly scenarioId?: string;
}

function createRunId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `run_${timestamp}_${randomUUID().split("-")[0]}`;
}

function inferSessionId(jsonlPath: string): string {
  const basename = path.basename(jsonlPath, path.extname(jsonlPath));

  return basename.length > 0 ? basename : "session";
}

async function collectEvalFiles(directoryPath: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectEvalFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(EVAL_LOG_EXTENSION)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function parseEvalLogSummary(source: string, filePath: string): EvalLogListEntry {
  const parsed = JSON.parse(source) as unknown;

  if (!validateEvalLog(parsed)) {
    throw new HarnessError(`Eval log at ${filePath} failed minimal validation.`, "EVAL_INVALID_LOG");
  }

  const evalLog = parsed as EvalLogLike;

  return {
    scenario_id: evalLog.eval.metadata.scenario_id,
    run_id: evalLog.eval.run_id,
    created: evalLog.eval.created,
    event_count: evalLog.samples.reduce((count, sample) => count + sample.events.length, 0),
    source: evalLog.eval.metadata.source
  };
}

function createEvalLogMeta(
  options: IngestTrajectoryOptions,
  events: readonly CommonEvent[],
  sessionId: string,
  runId: string
): EvalLogMeta {
  const funnelScore = scoreFunnel({
    events,
    ...(options.qualityInputs ? { quality: options.qualityInputs } : {})
  });

  return {
    runId,
    scenarioId: options.scenarioId,
    sessionId,
    source: options.adapter.source,
    scores: [createFunnelEvalLogScore(funnelScore)]
  };
}

interface ParseTrajectoryEventsOptions {
  readonly adapter: TrajectoryAdapter;
  readonly jsonlPath: string;
  readonly sessionId?: string;
}

export async function parseTrajectoryEvents(options: ParseTrajectoryEventsOptions): Promise<readonly CommonEvent[]> {
  const jsonlPath = path.resolve(options.jsonlPath);
  const source = await readFile(jsonlPath, "utf8");
  const sessionId = options.sessionId ?? inferSessionId(jsonlPath);
  const parserState: Record<string, unknown> = {};
  const events: CommonEvent[] = [];
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (line.trim().length === 0) {
      continue;
    }

    const parsed = options.adapter.parseLine(line, {
      session_id: sessionId,
      sequence: index + 1,
      state: parserState
    });

    if (!parsed) {
      continue;
    }

    const parsedEvents = Array.isArray(parsed) ? parsed : [parsed];

    for (const event of parsedEvents) {
      events.push(commonEventSchema.parse(event));
    }
  }

  return events;
}

export async function ingestTrajectory(options: IngestTrajectoryOptions): Promise<IngestTrajectoryResult> {
  const events = await parseTrajectoryEvents(options);
  const runId = createRunId();
  const outDir = path.resolve(options.outDir ?? path.join(process.cwd(), DEFAULT_EVAL_LOGS_PATH, options.scenarioId));
  const outPath = path.join(outDir, `${runId}${EVAL_LOG_EXTENSION}`);
  const sessionId = options.sessionId ?? inferSessionId(options.jsonlPath);
  await writeEvalLog([...events], createEvalLogMeta(options, events, sessionId, runId), outPath);

  return {
    outPath,
    eventCount: events.length
  };
}

export async function listEvalLogs(options: ListEvalLogsOptions = {}): Promise<EvalLogListEntry[]> {
  const logsDir = path.resolve(options.logsDir ?? path.join(process.cwd(), DEFAULT_EVAL_LOGS_PATH));
  const evalFiles = await collectEvalFiles(logsDir);
  const entries = await Promise.all(
    evalFiles.map(async (filePath) => parseEvalLogSummary(await readFile(filePath, "utf8"), filePath))
  );

  return entries
    .filter((entry) => (options.scenarioId ? entry.scenario_id === options.scenarioId : true))
    .sort((left, right) => {
      if (left.scenario_id !== right.scenario_id) {
        return left.scenario_id.localeCompare(right.scenario_id);
      }

      if (left.created !== right.created) {
        return left.created.localeCompare(right.created);
      }

      return left.run_id.localeCompare(right.run_id);
    });
}

export async function findEvalLogByRunId(runId: string, options: ListEvalLogsOptions = {}): Promise<EvalLogFileMatch | null> {
  const logsDir = path.resolve(options.logsDir ?? path.join(process.cwd(), DEFAULT_EVAL_LOGS_PATH));
  const evalFiles = await collectEvalFiles(logsDir);

  for (const filePath of evalFiles) {
    const entry = parseEvalLogSummary(await readFile(filePath, "utf8"), filePath);

    if (entry.run_id === runId) {
      return {
        entry,
        path: filePath
      };
    }
  }

  return null;
}

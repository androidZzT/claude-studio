import { readFile, writeFile } from "node:fs/promises";

import {
  HarnessError,
  commonEventSchema,
  createFunnelEvalLogScore,
  evalLogSchema,
  findEvalLogByRunId,
  scoreFunnel,
  validateEvalLog
} from "@harness/core";
import type { CommonEvent, EvalLog } from "@harness/core";

import { renderFunnelScoreTable, resolveQualityInputs } from "./eval-support.js";

interface CommandIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

interface EvalScoreArgs {
  readonly bugsPath?: string;
  readonly eventsPath?: string;
  readonly json: boolean;
  readonly lintPath?: string;
  readonly repoPath?: string;
  readonly runId: string;
  readonly smokePath?: string;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalValue(argv: readonly string[], index: number, token: string): { readonly nextIndex: number; readonly value: string } {
  const nextToken = argv[index + 1];

  if (!nextToken) {
    throw new HarnessError(`Missing value for ${token}.`, "CLI_UNKNOWN_ARGUMENT");
  }

  return {
    value: nextToken,
    nextIndex: index + 1
  };
}

function parseEvalScoreArgs(argv: readonly string[]): EvalScoreArgs {
  let runId: string | undefined;
  let json = false;
  let eventsPath: string | undefined;
  let bugsPath: string | undefined;
  let repoPath: string | undefined;
  let lintPath: string | undefined;
  let smokePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--events") {
      const parsed = readOptionalValue(argv, index, token);
      eventsPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--bugs") {
      const parsed = readOptionalValue(argv, index, token);
      bugsPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--repo") {
      const parsed = readOptionalValue(argv, index, token);
      repoPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--lint") {
      const parsed = readOptionalValue(argv, index, token);
      lintPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--smoke") {
      const parsed = readOptionalValue(argv, index, token);
      smokePath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token.startsWith("--")) {
      throw new HarnessError(`Unknown argument: ${token}`, "CLI_UNKNOWN_ARGUMENT");
    }

    if (runId) {
      throw new HarnessError(`Unknown argument: ${token}`, "CLI_UNKNOWN_ARGUMENT");
    }

    runId = token;
  }

  if (!runId) {
    throw new HarnessError("Missing required <run-id>.", "CLI_UNKNOWN_ARGUMENT");
  }

  return {
    runId,
    json,
    ...(eventsPath ? { eventsPath } : {}),
    ...(bugsPath ? { bugsPath } : {}),
    ...(repoPath ? { repoPath } : {}),
    ...(lintPath ? { lintPath } : {}),
    ...(smokePath ? { smokePath } : {})
  };
}

function restoreSessionMetaEvents(evalLog: EvalLog): CommonEvent[] {
  const metadata = evalLog.eval.metadata as JsonObject;
  const sessionMeta = Array.isArray(metadata.session_meta) ? metadata.session_meta : [];
  const source = evalLog.eval.metadata.source;
  const sessionId = evalLog.eval.metadata.session_id;

  return sessionMeta.flatMap((raw, index) => {
    if (!isRecord(raw)) {
      return [];
    }

    const payload = isRecord(raw.payload) ? raw.payload : {};
    const modelProvider = readString(payload.model_provider);

    return [
      commonEventSchema.parse({
        source,
        session_id: sessionId,
        event_id: readString(payload.id) ?? readString(raw.id) ?? `session-meta-${index}`,
        timestamp: readString(raw.timestamp) ?? evalLog.eval.created,
        ...(readString(payload.cwd) ?? readString(raw.cwd) ? { cwd: readString(payload.cwd) ?? readString(raw.cwd) } : {}),
        kind: "session_meta",
        ...(modelProvider
          ? {
              model: {
                id: "unknown",
                provider: modelProvider
              }
            }
          : {}),
        raw
      })
    ];
  });
}

function restoreEvent(record: JsonObject, source: EvalLog["eval"]["metadata"]["source"], sessionId: string): CommonEvent | null {
  const kind = readString(record.event);
  const base = {
    source,
    session_id: sessionId,
    event_id: readString(record.id) ?? "eval-event",
    timestamp: readString(record.timestamp) ?? new Date().toISOString(),
    ...(readString(record.cwd) ? { cwd: readString(record.cwd) } : {}),
    ...(readString(record.parent_event_id) ? { parent_event_id: readString(record.parent_event_id) } : {}),
    ...(readString(record.subagent_id) ? { subagent_id: readString(record.subagent_id) } : {}),
    ...(readString(record.turn_id) ? { turn_id: readString(record.turn_id) } : {}),
    raw: record.raw ?? record.data ?? record
  };

  if (kind === "model") {
    return commonEventSchema.parse({
      ...base,
      kind: "model",
      model: {
        id: readString(record.model) ?? "unknown",
        provider: readString(record.provider) ?? "unknown",
        ...(isRecord(record.usage) ? { usage: record.usage } : {})
      },
      ...(typeof record.content === "string" ? { text: record.content } : {}),
      ...(isRecord(record.thinking) ? { thinking: record.thinking } : {})
    });
  }

  if (kind === "tool") {
    return commonEventSchema.parse({
      ...base,
      kind: "arguments" in record ? "tool_call" : "tool_result",
      tool: {
        name: readString(record.function) ?? "unknown",
        ...("arguments" in record ? { input: record.arguments } : {}),
        ...("result" in record ? { output: record.result } : {}),
        ...(typeof record.error === "string" ? { error: record.error } : {})
      }
    });
  }

  if (kind === "input") {
    return commonEventSchema.parse({
      ...base,
      kind: "user_input",
      text: typeof record.input === "string" ? record.input : ""
    });
  }

  if (kind === "error") {
    return commonEventSchema.parse({
      ...base,
      kind: "error",
      text: typeof record.error === "string" ? record.error : "Unknown error"
    });
  }

  if (kind === "info") {
    return commonEventSchema.parse({
      ...base,
      kind: "lifecycle",
      ...(typeof record.message === "string" ? { text: record.message } : {})
    });
  }

  return null;
}

function restoreCommonEvents(evalLog: EvalLog): CommonEvent[] {
  const source = evalLog.eval.metadata.source;
  const sessionId = evalLog.eval.metadata.session_id;
  const sampleEvents = evalLog.samples.flatMap((sample) => sample.events);

  return [
    ...restoreSessionMetaEvents(evalLog),
    ...sampleEvents.flatMap((event) => {
      if (!isRecord(event)) {
        return [];
      }

      const restored = restoreEvent(event, source, sessionId);
      return restored ? [restored] : [];
    })
  ];
}

export async function runEvalScoreCommand(argv: readonly string[], io: CommandIo): Promise<number> {
  const parsed = parseEvalScoreArgs(argv);
  const evalLogMatch = await findEvalLogByRunId(parsed.runId);

  if (!evalLogMatch) {
    throw new HarnessError(`EvalLog run \`${parsed.runId}\` was not found in .harness/logs.`, "EVAL_RUN_NOT_FOUND");
  }

  const evalLog = evalLogSchema.parse(JSON.parse(await readFile(evalLogMatch.path, "utf8")) as unknown);
  const qualityInputs = await resolveQualityInputs(
    {
      ...(parsed.eventsPath ? { eventsPath: parsed.eventsPath } : {}),
      ...(parsed.bugsPath ? { bugsPath: parsed.bugsPath } : {}),
      ...(parsed.repoPath ? { repoPath: parsed.repoPath } : {}),
      ...(parsed.lintPath ? { lintPath: parsed.lintPath } : {}),
      ...(parsed.smokePath ? { smokePath: parsed.smokePath } : {})
    },
    (message) => io.stderr(message)
  );
  const score = scoreFunnel({
    events: restoreCommonEvents(evalLog),
    ...(Object.keys(qualityInputs).length > 0 ? { quality: qualityInputs } : {})
  });
  const updatedEvalLog = {
    ...evalLog,
    results: {
      ...evalLog.results,
      scores: [createFunnelEvalLogScore(score)]
    }
  };

  if (!validateEvalLog(updatedEvalLog)) {
    throw new HarnessError("Updated EvalLog did not pass minimal validation.", "EVAL_INVALID_OUTPUT");
  }

  await writeFile(evalLogMatch.path, `${JSON.stringify(updatedEvalLog, null, 2)}\n`, "utf8");

  if (parsed.json) {
    io.stdout(
      JSON.stringify(
        {
          runId: parsed.runId,
          outPath: evalLogMatch.path,
          score
        },
        null,
        2
      )
    );
  } else {
    io.stdout(`Updated scores for ${parsed.runId}`);
    io.stdout(`EvalLog: ${evalLogMatch.path}`);
    for (const line of renderFunnelScoreTable(score)) {
      io.stdout(line);
    }
  }

  return 0;
}

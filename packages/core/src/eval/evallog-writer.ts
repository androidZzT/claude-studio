import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { EVAL_LOG_STATUS_SUCCESS, EVAL_LOG_TASK_NAME, EVAL_LOG_VERSION } from "../constants.js";
import { HarnessError } from "../errors.js";

import { commonEventSchema, commonEventSourceSchema } from "./common-event.js";
import { funnelEvalLogScoreSchema } from "./scorer/types.js";
import type { CommonEvent, CommonEventSource } from "./common-event.js";
import type { FunnelEvalLogScore } from "./scorer/types.js";

const nonEmptyStringSchema = z.string().trim().min(1);
const isoTimestampSchema = nonEmptyStringSchema.refine((value) => !Number.isNaN(Date.parse(value)), "Expected an ISO 8601 timestamp.");
const evalLogEventSchema = z.object({ event: nonEmptyStringSchema }).passthrough();

export const evalLogSchema = z
  .object({
    version: z.literal(EVAL_LOG_VERSION),
    status: nonEmptyStringSchema,
    eval: z
      .object({
        task: nonEmptyStringSchema,
        task_id: nonEmptyStringSchema,
        run_id: nonEmptyStringSchema,
        created: isoTimestampSchema,
        tags: z.array(z.unknown()),
        metadata: z
          .object({
            scenario_id: nonEmptyStringSchema,
            source: commonEventSourceSchema,
            session_id: nonEmptyStringSchema,
            harness_version: nonEmptyStringSchema
          })
          .passthrough()
      })
      .passthrough(),
    plan: z
      .object({
        name: nonEmptyStringSchema,
        steps: z.array(z.unknown()),
        config: z.record(z.string(), z.unknown())
      })
      .passthrough(),
    results: z
      .object({
        scores: z.array(funnelEvalLogScoreSchema)
      })
      .passthrough(),
    stats: z
      .object({
        started_at: isoTimestampSchema,
        completed_at: isoTimestampSchema
      })
      .passthrough(),
    samples: z
      .array(
        z
          .object({
            id: nonEmptyStringSchema,
            epoch: z.number().int().nonnegative(),
            input: z.string(),
            events: z.array(evalLogEventSchema)
          })
          .passthrough()
      )
      .min(1)
  })
  .passthrough();

interface EvalLogMetadata {
  readonly scenario_id: string;
  readonly source: CommonEventSource;
  readonly session_id: string;
  readonly harness_version: string;
  readonly cwd?: string;
  readonly session_meta?: readonly unknown[];
}

interface EvalLogSample {
  readonly id: string;
  readonly epoch: number;
  readonly input: string;
  readonly events: readonly ({ readonly event: string } & Record<string, unknown>)[];
}

export interface EvalLogMeta {
  readonly created?: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly sessionId: string;
  readonly source: CommonEventSource;
  readonly scores?: readonly FunnelEvalLogScore[];
}

export type EvalLog = z.infer<typeof evalLogSchema>;

function createBaseEventFields(event: CommonEvent): Record<string, unknown> {
  return {
    id: event.event_id,
    timestamp: event.timestamp,
    origin: event.source,
    ...(event.parent_event_id ? { parent_event_id: event.parent_event_id } : {}),
    ...(event.subagent_id ? { subagent_id: event.subagent_id } : {}),
    ...(event.turn_id ? { turn_id: event.turn_id } : {}),
    ...(event.cwd ? { cwd: event.cwd } : {}),
    raw: event.raw
  };
}

function assertModelEvent(event: CommonEvent): NonNullable<CommonEvent["model"]> {
  if (!event.model?.id || !event.model.provider) {
    throw new HarnessError(`Model event \`${event.event_id}\` is missing model metadata.`, "EVAL_INVALID_MODEL_EVENT");
  }

  return event.model;
}

function assertToolEvent(event: CommonEvent): NonNullable<CommonEvent["tool"]> {
  if (!event.tool?.name) {
    throw new HarnessError(`Tool event \`${event.event_id}\` is missing tool metadata.`, "EVAL_INVALID_TOOL_EVENT");
  }

  return event.tool;
}

function mapEvalEvent(event: CommonEvent): ({ readonly event: string } & Record<string, unknown>) | null {
  const base = createBaseEventFields(event);

  switch (event.kind) {
    case "model": {
      const model = assertModelEvent(event);

      return {
        event: "model",
        model: model.id,
        provider: model.provider,
        ...(model.usage ? { usage: model.usage } : {}),
        ...(event.text !== undefined ? { content: event.text } : {}),
        ...(event.thinking ? { thinking: event.thinking } : {}),
        ...base
      };
    }

    case "tool_call": {
      const tool = assertToolEvent(event);

      return {
        event: "tool",
        function: tool.name,
        ...(tool.input !== undefined ? { arguments: tool.input } : {}),
        ...base
      };
    }

    case "tool_result": {
      const tool = assertToolEvent(event);

      return {
        event: "tool",
        function: tool.name,
        ...(tool.output !== undefined ? { result: tool.output } : {}),
        ...(tool.error ? { error: tool.error } : {}),
        ...base
      };
    }

    case "user_input":
      return {
        event: "input",
        input: event.text ?? "",
        ...base
      };

    case "session_meta":
      return null;

    case "lifecycle":
      return {
        event: "info",
        source: "harness",
        ...(event.text !== undefined ? { message: event.text } : {}),
        data: event.raw,
        ...base
      };

    case "error":
      return {
        event: "error",
        error: event.text ?? event.tool?.error ?? "Unknown error",
        ...base
      };
  }
}

function buildEvalMetadata(events: readonly CommonEvent[], meta: EvalLogMeta, harnessVersion: string): EvalLogMetadata {
  const sessionMeta = events.filter((event) => event.kind === "session_meta").map((event) => event.raw);
  const cwd = events.find((event) => event.cwd)?.cwd;

  return {
    scenario_id: meta.scenarioId,
    source: meta.source,
    session_id: meta.sessionId,
    harness_version: harnessVersion,
    ...(cwd ? { cwd } : {}),
    ...(sessionMeta.length > 0 ? { session_meta: sessionMeta } : {})
  };
}

async function loadHarnessVersion(): Promise<string> {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const source = await readFile(packageUrl, "utf8");
  const parsed = JSON.parse(source) as { readonly version?: string };

  return parsed.version ?? "0.0.0";
}

export function validateEvalLog(json: unknown): boolean {
  return evalLogSchema.safeParse(json).success;
}

export async function writeEvalLog(events: CommonEvent[], meta: EvalLogMeta, outPath: string): Promise<void> {
  const normalizedEvents = events.map((event) => commonEventSchema.parse(event));
  const created = meta.created ?? new Date().toISOString();
  const startedAt = normalizedEvents[0]?.timestamp ?? created;
  const completedAt = normalizedEvents.at(-1)?.timestamp ?? created;
  const harnessVersion = await loadHarnessVersion();
  const sampleEvents = normalizedEvents
    .map((event) => mapEvalEvent(event))
    .flatMap((event) => (event ? [event] : []));
  const document = {
    version: EVAL_LOG_VERSION,
    status: EVAL_LOG_STATUS_SUCCESS,
    eval: {
      task: EVAL_LOG_TASK_NAME,
      task_id: randomUUID(),
      run_id: meta.runId,
      created,
      tags: [],
      metadata: buildEvalMetadata(normalizedEvents, meta, harnessVersion)
    },
    plan: {
      name: "default",
      steps: [],
      config: {}
    },
    results: {
      scores: meta.scores ?? []
    },
    stats: {
      started_at: startedAt,
      completed_at: completedAt
    },
    samples: [
      {
        id: "sample-0",
        epoch: 0,
        input: "",
        events: sampleEvents
      } satisfies EvalLogSample
    ]
  };

  if (!validateEvalLog(document)) {
    throw new HarnessError("Generated EvalLog did not pass minimal validation.", "EVAL_INVALID_OUTPUT");
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

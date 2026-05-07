import { readFile } from "node:fs/promises";
import path from "node:path";

import { HarnessError } from "../../errors.js";

import type { CommonEvent, TokenUsage } from "../common-event.js";
import type { ParserContext, TrajectoryAdapter } from "../trajectory-adapter.js";

interface JsonObject {
  readonly [key: string]: unknown;
}

interface CodexParserState {
  callIdToToolName: Record<string, string>;
  lastCwd?: string;
  lastModel?: string;
  lastTurnId?: string;
  modelContextWindow?: number;
}

interface CommonEventBase {
  readonly event_id: string;
  readonly raw: unknown;
  readonly session_id: string;
  readonly source: "codex";
  readonly timestamp: string;
  readonly cwd?: string;
  readonly turn_id?: string;
}

const CODEX_SESSION_FILENAME_PATTERN =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTimestamp(value: unknown): string {
  return readString(value) ?? new Date().toISOString();
}

function normalizeContentItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function getParserState(ctx: ParserContext): CodexParserState {
  const state = (ctx.state ?? {}) as Record<string, unknown>;

  if (!isRecord(state.callIdToToolName)) {
    state.callIdToToolName = {};
  }

  return state as unknown as CodexParserState;
}

function createSyntheticEventId(ctx: ParserContext, suffix?: number): string {
  return suffix === undefined ? `codex-${ctx.sequence}` : `codex-${ctx.sequence}-${suffix}`;
}

function createCommonBase(
  raw: unknown,
  payload: JsonObject,
  ctx: ParserContext,
  state: CodexParserState,
  eventId: string
): CommonEventBase {
  const cwd = readString(payload.cwd) ?? state.lastCwd;
  const turnId = readString(payload.turn_id) ?? state.lastTurnId;

  return {
    source: "codex",
    session_id: ctx.session_id,
    event_id: eventId,
    timestamp: readTimestamp(isRecord(raw) ? raw.timestamp : undefined),
    ...(cwd ? { cwd } : {}),
    ...(turnId ? { turn_id: turnId } : {}),
    raw
  };
}

function createLifecycleEvent(base: CommonEventBase, text?: string): CommonEvent {
  return {
    ...base,
    kind: "lifecycle",
    ...(text !== undefined ? { text } : {})
  };
}

function createModelUsage(usage: JsonObject | undefined): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const tokenUsage: TokenUsage = {
    ...(typeof usage.input_tokens === "number" ? { input_tokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { output_tokens: usage.output_tokens } : {}),
    ...(typeof usage.cached_input_tokens === "number" ? { cache_read_input_tokens: usage.cached_input_tokens } : {})
  };

  return Object.keys(tokenUsage).length > 0 ? tokenUsage : undefined;
}

function createOpenAiModel(state: CodexParserState, usage?: TokenUsage): CommonEvent["model"] {
  return {
    id: state.lastModel ?? "unknown",
    provider: "openai",
    ...(usage ? { usage } : {})
  };
}

function joinReasoningSummary(summary: unknown): string {
  if (!Array.isArray(summary)) {
    return "";
  }

  return summary
    .flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const text = readString(item.text);
      return text ? [text] : [];
    })
    .join("\n");
}

function parseToolArguments(argumentsSource: unknown): unknown {
  if (typeof argumentsSource !== "string") {
    return argumentsSource ?? {};
  }

  try {
    return JSON.parse(argumentsSource);
  } catch (error) {
    return {
      _raw: argumentsSource,
      _parse_error: error instanceof Error ? error.message : "Unknown JSON parse error."
    };
  }
}

function mapMessageContentItem(
  raw: unknown,
  payload: JsonObject,
  ctx: ParserContext,
  state: CodexParserState,
  role: string | undefined,
  item: unknown,
  index: number
): CommonEvent {
  const base = createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx, index + 1));

  if (!isRecord(item)) {
    return createLifecycleEvent(base);
  }

  if (role === "user" && item.type === "input_text") {
    return {
      ...base,
      kind: "user_input",
      text: typeof item.text === "string" ? item.text : ""
    };
  }

  if (role === "developer" && item.type === "input_text") {
    return createLifecycleEvent(base, typeof item.text === "string" ? item.text : "");
  }

  if (role === "assistant" && item.type === "output_text") {
    return {
      ...base,
      kind: "model",
      model: createOpenAiModel(state),
      text: typeof item.text === "string" ? item.text : ""
    };
  }

  return createLifecycleEvent(base);
}

function parseMessage(
  raw: unknown,
  payload: JsonObject,
  ctx: ParserContext,
  state: CodexParserState
): CommonEvent[] | null {
  const contentItems = normalizeContentItems(payload.content);

  if (contentItems.length === 0) {
    return null;
  }

  const role = readString(payload.role);
  return contentItems.map((item, index) => mapMessageContentItem(raw, payload, ctx, state, role, item, index));
}

function parseReasoning(raw: unknown, payload: JsonObject, ctx: ParserContext, state: CodexParserState): CommonEvent {
  return {
    ...createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)),
    kind: "model",
    model: createOpenAiModel(state),
    thinking: {
      content: joinReasoningSummary(payload.summary),
      ...(typeof payload.encrypted_content === "string" ? { signature: payload.encrypted_content } : {})
    }
  };
}

function parseFunctionCall(raw: unknown, payload: JsonObject, ctx: ParserContext, state: CodexParserState): CommonEvent {
  const callId = readString(payload.call_id);
  const toolName = readString(payload.name) ?? "unknown";

  if (callId) {
    state.callIdToToolName[callId] = toolName;
  }

  return {
    ...createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)),
    kind: "tool_call",
    tool: {
      name: toolName,
      input: parseToolArguments(payload.arguments)
    }
  };
}

function parseFunctionCallOutput(
  raw: unknown,
  payload: JsonObject,
  ctx: ParserContext,
  state: CodexParserState
): CommonEvent {
  const callId = readString(payload.call_id);

  return {
    ...createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)),
    kind: "tool_result",
    tool: {
      name: (callId ? state.callIdToToolName[callId] : undefined) ?? "unknown",
      output: payload.output
    }
  };
}

function parseResponseItem(
  raw: unknown,
  payload: JsonObject,
  ctx: ParserContext,
  state: CodexParserState
): CommonEvent | CommonEvent[] | null {
  const payloadType = readString(payload.type);

  if (payloadType === "message") {
    return parseMessage(raw, payload, ctx, state);
  }

  if (payloadType === "reasoning") {
    return parseReasoning(raw, payload, ctx, state);
  }

  if (payloadType === "function_call") {
    return parseFunctionCall(raw, payload, ctx, state);
  }

  if (payloadType === "function_call_output") {
    return parseFunctionCallOutput(raw, payload, ctx, state);
  }

  return createLifecycleEvent(createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)));
}

function parseSessionMeta(raw: unknown, payload: JsonObject, ctx: ParserContext, state: CodexParserState): CommonEvent {
  const cwd = readString(payload.cwd);
  if (cwd) {
    state.lastCwd = cwd;
  }

  const modelProvider = readString(payload.model_provider);

  return {
    ...createCommonBase(raw, payload, ctx, state, readString(payload.id) ?? createSyntheticEventId(ctx)),
    kind: "session_meta",
    ...(modelProvider
      ? {
          model: {
            id: state.lastModel ?? "unknown",
            provider: modelProvider
          }
        }
      : {})
  };
}

function parseTurnContext(raw: unknown, payload: JsonObject, ctx: ParserContext, state: CodexParserState): CommonEvent {
  const cwd = readString(payload.cwd);
  const turnId = readString(payload.turn_id);
  const model = readString(payload.model);

  if (cwd) {
    state.lastCwd = cwd;
  }

  if (turnId) {
    state.lastTurnId = turnId;
  }

  if (model) {
    state.lastModel = model;
  }

  return {
    ...createCommonBase(raw, payload, ctx, state, turnId ?? `codex-turn-${ctx.sequence}`),
    kind: "session_meta"
  };
}

function parseTokenCount(raw: unknown, payload: JsonObject, ctx: ParserContext, state: CodexParserState): CommonEvent {
  const info = isRecord(payload.info) ? payload.info : undefined;
  const totalTokenUsage = isRecord(info?.total_token_usage) ? info.total_token_usage : undefined;

  return {
    ...createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)),
    kind: "model",
    model: createOpenAiModel(state, createModelUsage(totalTokenUsage))
  };
}

function parseExecCommandEnd(raw: unknown, payload: JsonObject, ctx: ParserContext, state: CodexParserState): CommonEvent {
  const exitCode = typeof payload.exit_code === "number" ? payload.exit_code : undefined;

  return {
    ...createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)),
    kind: "tool_result",
    tool: {
      name: "exec_command",
      output: typeof payload.aggregated_output === "string" ? payload.aggregated_output : "",
      ...(exitCode && exitCode !== 0 ? { error: `exit ${exitCode}` } : {})
    }
  };
}

function parseEventMsg(raw: unknown, payload: JsonObject, ctx: ParserContext, state: CodexParserState): CommonEvent {
  const payloadType = readString(payload.type);

  if (payloadType === "task_started") {
    const turnId = readString(payload.turn_id);
    if (turnId) {
      state.lastTurnId = turnId;
    }

    if (typeof payload.model_context_window === "number") {
      state.modelContextWindow = payload.model_context_window;
    }

    return createLifecycleEvent(createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)));
  }

  if (payloadType === "token_count") {
    return parseTokenCount(raw, payload, ctx, state);
  }

  if (payloadType === "user_message") {
    return {
      ...createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)),
      kind: "user_input",
      text: typeof payload.message === "string" ? payload.message : ""
    };
  }

  if (payloadType === "agent_message") {
    return {
      ...createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)),
      kind: "model",
      model: createOpenAiModel(state),
      text: typeof payload.message === "string" ? payload.message : ""
    };
  }

  if (payloadType === "exec_command_end") {
    return parseExecCommandEnd(raw, payload, ctx, state);
  }

  return createLifecycleEvent(createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)));
}

function readSessionIdFromFirstLine(source: string): string | undefined {
  const firstLine = source.split(/\r?\n/, 1)[0]?.trim();

  if (!firstLine) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(firstLine) as unknown;
    if (!isRecord(parsed) || parsed.type !== "session_meta" || !isRecord(parsed.payload)) {
      return undefined;
    }

    return readString(parsed.payload.id);
  } catch {
    return undefined;
  }
}

export async function inferCodexSessionId(jsonlPath: string): Promise<string> {
  const filename = path.basename(jsonlPath);
  const filenameMatch = CODEX_SESSION_FILENAME_PATTERN.exec(filename);

  if (filenameMatch?.[1]) {
    return filenameMatch[1];
  }

  const source = await readFile(jsonlPath, "utf8");
  const inferredFromSessionMeta = readSessionIdFromFirstLine(source);

  if (inferredFromSessionMeta) {
    return inferredFromSessionMeta;
  }

  throw new HarnessError(
    `Codex rollout filename must match rollout-<timestamp>-<uuid>.jsonl or the first line must be session_meta with payload.id. Received \`${filename}\`. Pass --session-id to override.`,
    "CLI_MISSING_CODEX_SESSION_ID"
  );
}

export class CodexParser implements TrajectoryAdapter {
  readonly source = "codex" as const;

  parseLine(line: string, ctx: ParserContext): CommonEvent | CommonEvent[] | null {
    if (line.trim().length === 0) {
      return null;
    }

    let raw: unknown;

    try {
      raw = JSON.parse(line);
    } catch {
      return null;
    }

    const record = isRecord(raw) ? raw : {};
    const payload = isRecord(record.payload) ? record.payload : {};
    const type = readString(record.type);
    const state = getParserState(ctx);

    if (type === "session_meta") {
      return parseSessionMeta(raw, payload, ctx, state);
    }

    if (type === "turn_context") {
      return parseTurnContext(raw, payload, ctx, state);
    }

    if (type === "response_item") {
      return parseResponseItem(raw, payload, ctx, state);
    }

    if (type === "event_msg") {
      return parseEventMsg(raw, payload, ctx, state);
    }

    return createLifecycleEvent(createCommonBase(raw, payload, ctx, state, createSyntheticEventId(ctx)));
  }
}

export function createCodexParser(): CodexParser {
  return new CodexParser();
}

import path from "node:path";

import { HarnessError } from "../../errors.js";

import type { CommonEvent, TokenUsage } from "../common-event.js";
import type { ParserContext, TrajectoryAdapter } from "../trajectory-adapter.js";

interface JsonObject {
  readonly [key: string]: unknown;
}

interface CommonEventBase {
  readonly source: "claude-code";
  readonly session_id: string;
  readonly event_id: string;
  readonly timestamp: string;
  readonly cwd?: string;
  readonly parent_event_id?: string;
  readonly subagent_id?: string;
  readonly raw: unknown;
}

const CLAUDE_CODE_SESSION_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

function createFallbackEventId(raw: JsonObject, ctx: ParserContext): string {
  return readString(raw.uuid) ?? `cc-${ctx.sequence}`;
}

function createCommonBase(raw: JsonObject, ctx: ParserContext): CommonEventBase {
  const cwd = readString(raw.cwd);
  const parentEventId = readString(raw.parentUuid);
  const subagentId = raw.isSidechain === true ? readString(raw.parentToolUseID) : undefined;

  return {
    source: "claude-code",
    session_id: ctx.session_id,
    event_id: createFallbackEventId(raw, ctx),
    timestamp: readTimestamp(raw.timestamp),
    ...(cwd ? { cwd } : {}),
    ...(parentEventId ? { parent_event_id: parentEventId } : {}),
    ...(subagentId ? { subagent_id: subagentId } : {}),
    raw
  };
}

function extractUsage(message: JsonObject): TokenUsage | undefined {
  const usage = isRecord(message.usage) ? message.usage : undefined;

  if (!usage) {
    return undefined;
  }

  const tokenUsage: TokenUsage = {
    ...(typeof usage.input_tokens === "number" ? { input_tokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { output_tokens: usage.output_tokens } : {}),
    ...(typeof usage.cache_creation_input_tokens === "number"
      ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
      : {}),
    ...(typeof usage.cache_read_input_tokens === "number" ? { cache_read_input_tokens: usage.cache_read_input_tokens } : {})
  };

  return Object.keys(tokenUsage).length > 0 ? tokenUsage : undefined;
}

function createModelEvent(base: CommonEventBase, message: JsonObject, partial: Pick<CommonEvent, "text" | "thinking">): CommonEvent {
  return {
    ...base,
    kind: "model",
    model: {
      id: readString(message.model) ?? "unknown",
      provider: "anthropic",
      ...(extractUsage(message) ? { usage: extractUsage(message) } : {})
    },
    ...partial
  };
}

function createLifecycleEvent(base: CommonEventBase): CommonEvent {
  return {
    ...base,
    kind: "lifecycle"
  };
}

function extractUserText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const segments = content.flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }

      if (isRecord(item)) {
        const text = readString(item.text);
        if (text) {
          return [text];
        }
      }

      return [];
    });

    return segments.length > 0 ? segments.join("\n") : JSON.stringify(content);
  }

  if (isRecord(content)) {
    return readString(content.text) ?? JSON.stringify(content);
  }

  return undefined;
}

function inferToolResultName(toolUseResult: unknown): string {
  if (isRecord(toolUseResult)) {
    return (
      readString(toolUseResult.name) ??
      readString(toolUseResult.toolName) ??
      readString(toolUseResult.tool_name) ??
      readString(toolUseResult.tool) ??
      "unknown"
    );
  }

  return "unknown";
}

function mapAssistantContentItem(item: unknown, base: CommonEventBase, message: JsonObject): CommonEvent | null {
  if (typeof item === "string") {
    return createModelEvent(base, message, { text: item });
  }

  if (!isRecord(item)) {
    return null;
  }

  if (item.type === "thinking") {
    return createModelEvent(base, message, {
      thinking: {
        content: typeof item.thinking === "string" ? item.thinking : "",
        ...(typeof item.signature === "string" ? { signature: item.signature } : {})
      }
    });
  }

  if (item.type === "text" || (item.type === undefined && typeof item.text === "string")) {
    return createModelEvent(base, message, { text: typeof item.text === "string" ? item.text : "" });
  }

  if (item.type === "tool_use") {
    return {
      ...base,
      kind: "tool_call",
      tool: {
        name: readString(item.name) ?? "unknown",
        input: "input" in item ? item.input : {}
      }
    };
  }

  return null;
}

function parseAssistant(raw: JsonObject, ctx: ParserContext): CommonEvent[] | null {
  const base = createCommonBase(raw, ctx);
  const message = isRecord(raw.message) ? raw.message : {};
  const contentItems = normalizeContentItems(message.content);

  if (contentItems.length === 0) {
    return null;
  }

  const events = contentItems.flatMap((item) => {
    const event = mapAssistantContentItem(item, base, message);
    return event ? [event] : [];
  });

  return events.length > 0 ? events : null;
}

function parseUser(raw: JsonObject, ctx: ParserContext): CommonEvent {
  const base = createCommonBase(raw, ctx);

  if ("toolUseResult" in raw) {
    return {
      ...base,
      kind: "tool_result",
      tool: {
        name: inferToolResultName(raw.toolUseResult),
        output: raw.toolUseResult
      }
    };
  }

  const message = isRecord(raw.message) ? raw.message : {};

  return {
    ...base,
    kind: "user_input",
    text: extractUserText(message.content) ?? ""
  };
}

export function inferClaudeCodeSessionId(jsonlPath: string): string {
  const filename = path.basename(jsonlPath);

  if (!CLAUDE_CODE_SESSION_FILENAME_PATTERN.test(filename)) {
    throw new HarnessError(
      `Claude Code trajectory filename must match <uuid>.jsonl. Received \`${filename}\`. Pass --session-id to override.`,
      "EVAL_INVALID_CC_FILENAME"
    );
  }

  return path.basename(filename, ".jsonl");
}

export class ClaudeCodeParser implements TrajectoryAdapter {
  readonly source = "claude-code" as const;

  parseLine(line: string, ctx: ParserContext): CommonEvent | CommonEvent[] | null {
    let raw: unknown;

    try {
      raw = JSON.parse(line);
    } catch {
      throw new HarnessError(`Failed to parse Claude Code trajectory JSONL at line ${ctx.sequence}.`, "EVAL_PARSE_FAILED");
    }

    const record = isRecord(raw) ? raw : {};
    const type = readString(record.type);

    if (type === "assistant") {
      return parseAssistant(record, ctx);
    }

    if (type === "user") {
      return parseUser(record, ctx);
    }

    return createLifecycleEvent(createCommonBase(record, ctx));
  }
}

export function createClaudeCodeParser(): ClaudeCodeParser {
  return new ClaudeCodeParser();
}

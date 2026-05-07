import type { CommonEvent } from "../../common-event.js";

interface JsonObject {
  readonly [key: string]: unknown;
}

export interface TokenContribution {
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
}

const ZERO_TOKENS: TokenContribution = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractCodexLastTokenUsage(event: CommonEvent): TokenContribution | null {
  if (event.kind !== "model" || !isRecord(event.raw) || event.raw.type !== "event_msg") {
    return null;
  }

  const payload = isRecord(event.raw.payload) ? event.raw.payload : null;
  if (!payload || payload.type !== "token_count") {
    return null;
  }

  const info = isRecord(payload.info) ? payload.info : null;
  const lastTokenUsage = info && isRecord(info.last_token_usage) ? info.last_token_usage : null;

  if (!lastTokenUsage) {
    return null;
  }

  return {
    input_tokens: readNumber(lastTokenUsage.input_tokens) ?? 0,
    output_tokens: readNumber(lastTokenUsage.output_tokens) ?? 0,
    cache_read_input_tokens: readNumber(lastTokenUsage.cached_input_tokens) ?? 0,
    cache_creation_input_tokens: 0
  };
}

export function getTokenContribution(event: CommonEvent): TokenContribution {
  if (event.kind !== "model") {
    return ZERO_TOKENS;
  }

  const codexLastTokenUsage = extractCodexLastTokenUsage(event);
  if (codexLastTokenUsage) {
    return codexLastTokenUsage;
  }

  const usage = event.model?.usage;
  if (!usage) {
    return ZERO_TOKENS;
  }

  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0
  };
}

export function getTotalTokenContribution(event: CommonEvent): number {
  const usage = getTokenContribution(event);

  return (
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens
  );
}

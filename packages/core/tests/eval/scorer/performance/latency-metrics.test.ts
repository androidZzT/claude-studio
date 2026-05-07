import { describe, expect, it } from "vitest";

import { scoreLatencyMetrics } from "../../../../src/eval/scorer/performance/index.js";
import type { CommonEvent } from "../../../../src/index.js";

const baseEvent = {
  source: "stub" as const,
  session_id: "session-1",
  raw: {}
};

describe("scoreLatencyMetrics", () => {
  it("returns null latencies for an empty transcript", () => {
    expect(scoreLatencyMetrics([])).toEqual({
      time_to_first_token: null,
      output_tokens_per_sec: null,
      time_to_last_token: null
    });
  });

  it("returns null first-token latency when no model event exists", () => {
    const events: CommonEvent[] = [
      {
        ...baseEvent,
        event_id: "u1",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "user_input",
        text: "hi"
      }
    ];

    expect(scoreLatencyMetrics(events)).toEqual({
      time_to_first_token: null,
      output_tokens_per_sec: null,
      time_to_last_token: 0
    });
  });

  it("computes latency-style metrics from a codex-like event sequence", () => {
    const events: CommonEvent[] = [
      {
        ...baseEvent,
        event_id: "u1",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "user_input",
        text: "hi"
      },
      {
        ...baseEvent,
        event_id: "m1",
        timestamp: "2026-04-27T10:00:02Z",
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            output_tokens: 4
          }
        },
        text: "hello"
      },
      {
        ...baseEvent,
        event_id: "m2",
        timestamp: "2026-04-27T10:00:05Z",
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            output_tokens: 6
          }
        },
        text: "world"
      }
    ];

    expect(scoreLatencyMetrics(events)).toEqual({
      time_to_first_token: 2,
      output_tokens_per_sec: 2,
      time_to_last_token: 5
    });
  });

  it("handles claude-code-like model events that share timestamps", () => {
    const events: CommonEvent[] = [
      {
        ...baseEvent,
        event_id: "u1",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "user_input",
        text: "hi"
      },
      {
        ...baseEvent,
        event_id: "m1",
        timestamp: "2026-04-27T10:00:01Z",
        kind: "model",
        model: {
          id: "claude-sonnet-4-6",
          provider: "anthropic",
          usage: {
            output_tokens: 3
          }
        },
        text: "hello"
      },
      {
        ...baseEvent,
        event_id: "m2",
        timestamp: "2026-04-27T10:00:01Z",
        kind: "model",
        model: {
          id: "claude-sonnet-4-6",
          provider: "anthropic",
          usage: {
            output_tokens: 2
          }
        },
        thinking: {
          content: "reason"
        }
      }
    ];

    expect(scoreLatencyMetrics(events)).toEqual({
      time_to_first_token: 1,
      output_tokens_per_sec: 5,
      time_to_last_token: 1
    });
  });

  it("uses codex last_token_usage output deltas for throughput", () => {
    const events: CommonEvent[] = [
      {
        ...baseEvent,
        event_id: "u1",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "user_input",
        text: "hi"
      },
      {
        ...baseEvent,
        event_id: "m1",
        timestamp: "2026-04-27T10:00:02Z",
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            input_tokens: 24007,
            output_tokens: 479,
            cache_read_input_tokens: 15744
          }
        },
        raw: {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 24007,
                output_tokens: 479,
                cached_input_tokens: 15744
              },
              last_token_usage: {
                input_tokens: 24007,
                output_tokens: 479,
                cached_input_tokens: 15744
              }
            }
          }
        }
      },
      {
        ...baseEvent,
        event_id: "m2",
        timestamp: "2026-04-27T10:00:05Z",
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            input_tokens: 48962,
            output_tokens: 702,
            cache_read_input_tokens: 40064
          }
        },
        raw: {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 48962,
                output_tokens: 702,
                cached_input_tokens: 40064
              },
              last_token_usage: {
                input_tokens: 24955,
                output_tokens: 223,
                cached_input_tokens: 24320
              }
            }
          }
        }
      }
    ];

    expect(scoreLatencyMetrics(events)).toEqual({
      time_to_first_token: 2,
      output_tokens_per_sec: 140.4,
      time_to_last_token: 5
    });
  });
});

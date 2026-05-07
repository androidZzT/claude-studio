import { describe, expect, it } from "vitest";

import { scoreTranscriptMetrics } from "../../../../src/eval/scorer/performance/index.js";
import type { CommonEvent } from "../../../../src/index.js";

const baseEvent = {
  source: "stub" as const,
  session_id: "session-1",
  timestamp: "2026-04-27T10:00:00Z",
  raw: {}
};

describe("scoreTranscriptMetrics", () => {
  it("returns zeros for an empty transcript", () => {
    expect(scoreTranscriptMetrics([])).toEqual({
      n_turns: 0,
      n_toolcalls: 0,
      n_total_tokens: 0
    });
  });

  it("counts user turns, tool calls, and model token usage", () => {
    const events: CommonEvent[] = [
      { ...baseEvent, event_id: "u1", kind: "user_input", text: "hi" },
      { ...baseEvent, event_id: "t1", kind: "tool_call", tool: { name: "Read", input: { path: "/x" } } },
      {
        ...baseEvent,
        event_id: "m1",
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 2
          }
        }
      }
    ];

    expect(scoreTranscriptMetrics(events)).toEqual({
      n_turns: 1,
      n_toolcalls: 1,
      n_total_tokens: 117
    });
  });

  it("handles claude-code-like and codex-like model subsets", () => {
    const events: CommonEvent[] = [
      {
        ...baseEvent,
        event_id: "cc-model",
        kind: "model",
        model: {
          id: "claude-sonnet-4-6",
          provider: "anthropic",
          usage: {
            input_tokens: 12,
            output_tokens: 7
          }
        },
        text: "hello"
      },
      {
        ...baseEvent,
        event_id: "codex-model",
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            input_tokens: 20,
            output_tokens: 8,
            cache_read_input_tokens: 50
          }
        }
      }
    ];

    expect(scoreTranscriptMetrics(events).n_total_tokens).toBe(97);
  });

  it("uses codex last_token_usage deltas instead of cumulative total snapshots", () => {
    const events: CommonEvent[] = [
      {
        ...baseEvent,
        event_id: "codex-token-1",
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
        event_id: "codex-token-2",
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

    expect(scoreTranscriptMetrics(events).n_total_tokens).toBe(89728);
  });
});

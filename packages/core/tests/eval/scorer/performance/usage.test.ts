import { describe, expect, it } from "vitest";

import { getTokenContribution, getTotalTokenContribution } from "../../../../src/eval/scorer/performance/usage.js";
import type { CommonEvent } from "../../../../src/index.js";

const baseEvent = {
  source: "stub" as const,
  session_id: "session-1",
  timestamp: "2026-04-27T10:00:00Z",
  raw: {}
};

describe("token contribution helpers", () => {
  it("returns zeros for non-model events", () => {
    const event: CommonEvent = {
      ...baseEvent,
      event_id: "u1",
      kind: "user_input",
      text: "hi"
    };

    expect(getTokenContribution(event)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    });
    expect(getTotalTokenContribution(event)).toBe(0);
  });

  it("falls back to model usage when codex token_count has no last_token_usage", () => {
    const event: CommonEvent = {
      ...baseEvent,
      event_id: "m1",
      kind: "model",
      model: {
        id: "gpt-5.4",
        provider: "openai",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 3
        }
      },
      raw: {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              output_tokens: 50,
              cached_input_tokens: 30
            }
          }
        }
      }
    };

    expect(getTokenContribution(event)).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 0
    });
  });

  it("uses codex last_token_usage deltas and defaults invalid numeric fields to zero", () => {
    const event: CommonEvent = {
      ...baseEvent,
      event_id: "m2",
      kind: "model",
      model: {
        id: "gpt-5.4",
        provider: "openai",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30
        }
      },
      raw: {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 7,
              output_tokens: "oops",
              cached_input_tokens: 2
            }
          }
        }
      }
    };

    expect(getTokenContribution(event)).toEqual({
      input_tokens: 7,
      output_tokens: 0,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 0
    });
    expect(getTotalTokenContribution(event)).toBe(9);
  });

  it("uses plain model usage for non-codex model events", () => {
    const event: CommonEvent = {
      ...baseEvent,
      event_id: "m3",
      kind: "model",
      model: {
        id: "claude-sonnet-4-6",
        provider: "anthropic",
        usage: {
          input_tokens: 12,
          output_tokens: 6,
          cache_creation_input_tokens: 4
        }
      },
      raw: {
        type: "response_item",
        payload: {
          type: "message"
        }
      }
    };

    expect(getTokenContribution(event)).toEqual({
      input_tokens: 12,
      output_tokens: 6,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 4
    });
  });

  it("falls back to model usage when the codex payload shape is malformed", () => {
    const malformedPayloadEvent: CommonEvent = {
      ...baseEvent,
      event_id: "m4",
      kind: "model",
      model: {
        id: "gpt-5.4",
        provider: "openai",
        usage: {
          input_tokens: 3
        }
      },
      raw: {
        type: "event_msg",
        payload: "not-an-object"
      }
    };

    const malformedInfoEvent: CommonEvent = {
      ...baseEvent,
      event_id: "m5",
      kind: "model",
      model: {
        id: "gpt-5.4",
        provider: "openai",
        usage: {
          input_tokens: 4
        }
      },
      raw: {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: "not-an-object"
        }
      }
    };

    expect(getTokenContribution(malformedPayloadEvent)).toEqual({
      input_tokens: 3,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    });
    expect(getTokenContribution(malformedInfoEvent)).toEqual({
      input_tokens: 4,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    });
  });

  it("defaults missing codex delta fields to zero", () => {
    const event: CommonEvent = {
      ...baseEvent,
      event_id: "m6",
      kind: "model",
      model: {
        id: "gpt-5.4",
        provider: "openai",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30
        }
      },
      raw: {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              output_tokens: 5
            }
          }
        }
      }
    };

    expect(getTokenContribution(event)).toEqual({
      input_tokens: 0,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    });
  });
});

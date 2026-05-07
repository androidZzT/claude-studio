import { describe, expect, it } from "vitest";

import { HarnessError, PassThroughAdapter } from "../../src/index.js";

describe("pass-through trajectory adapter", () => {
  it("wraps a valid jsonl line into a lifecycle CommonEvent", () => {
    const adapter = new PassThroughAdapter();
    const event = adapter.parseLine('{"timestamp":"2026-04-27T10:00:00Z","type":"user","content":"hello"}', {
      session_id: "session-1",
      sequence: 1
    });

    expect(event).toEqual({
      source: "stub",
      session_id: "session-1",
      event_id: "stub-1",
      timestamp: "2026-04-27T10:00:00Z",
      kind: "lifecycle",
      raw: {
        timestamp: "2026-04-27T10:00:00Z",
        type: "user",
        content: "hello"
      }
    });
  });

  it("throws a named error for invalid JSON", () => {
    const adapter = new PassThroughAdapter();

    try {
      adapter.parseLine("{not-json}", {
        session_id: "session-1",
        sequence: 3
      });
      throw new Error("expected invalid json to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect(error).toMatchObject({
        code: "EVAL_STUB_INVALID_JSONL_LINE",
        message: "Invalid stub JSONL at line 3."
      });
    }
  });

  it("uses the parser sequence when synthesizing event ids", () => {
    const adapter = new PassThroughAdapter();
    const first = adapter.parseLine('{"type":"first"}', {
      session_id: "session-1",
      sequence: 1
    });
    const second = adapter.parseLine('{"type":"second"}', {
      session_id: "session-1",
      sequence: 2
    });

    expect(first?.event_id).toBe("stub-1");
    expect(second?.event_id).toBe("stub-2");
  });
});

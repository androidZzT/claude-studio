import { describe, expect, it } from "vitest";

import { commonEventSchema } from "../../src/index.js";

const baseEvent = {
  source: "stub" as const,
  session_id: "session-1",
  event_id: "stub-1",
  timestamp: "2026-04-27T10:00:00Z",
  kind: "lifecycle" as const,
  raw: {
    ok: true
  }
};

describe("common event schema", () => {
  it("accepts a valid CommonEvent payload", () => {
    expect(commonEventSchema.parse(baseEvent)).toEqual(baseEvent);
  });

  it("rejects missing source, event_id, and kind fields", () => {
    expect(commonEventSchema.safeParse({ ...baseEvent, source: undefined }).success).toBe(false);
    expect(commonEventSchema.safeParse({ ...baseEvent, event_id: undefined }).success).toBe(false);
    expect(commonEventSchema.safeParse({ ...baseEvent, kind: undefined }).success).toBe(false);
  });

  it("allows a model kind without forcing a model payload at schema level", () => {
    expect(commonEventSchema.safeParse({ ...baseEvent, kind: "model" }).success).toBe(true);
  });
});

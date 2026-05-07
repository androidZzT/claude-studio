import { HarnessError } from "../../errors.js";

import { commonEventSchema } from "../common-event.js";
import type { CommonEvent } from "../common-event.js";
import type { ParserContext, TrajectoryAdapter } from "../trajectory-adapter.js";

type TimestampCarrier = {
  readonly timestamp?: unknown;
};

function resolveTimestamp(raw: unknown): string {
  if (typeof raw === "object" && raw !== null) {
    const candidate = (raw as TimestampCarrier).timestamp;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return new Date().toISOString();
}

export class PassThroughAdapter implements TrajectoryAdapter {
  readonly source = "stub" as const;

  parseLine(line: string, ctx: ParserContext): CommonEvent | null {
    let raw: unknown;

    try {
      raw = JSON.parse(line);
    } catch {
      throw new HarnessError(`Invalid stub JSONL at line ${ctx.sequence}.`, "EVAL_STUB_INVALID_JSONL_LINE");
    }

    return commonEventSchema.parse({
      source: "stub",
      session_id: ctx.session_id,
      event_id: `stub-${ctx.sequence}`,
      timestamp: resolveTimestamp(raw),
      kind: "lifecycle",
      raw
    });
  }
}

export function createPassThroughAdapter(): PassThroughAdapter {
  return new PassThroughAdapter();
}

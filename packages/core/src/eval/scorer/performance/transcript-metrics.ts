import type { CommonEvent } from "../../common-event.js";

import { getTotalTokenContribution } from "./usage.js";

export interface TranscriptMetrics {
  readonly n_toolcalls: number;
  readonly n_total_tokens: number;
  readonly n_turns: number;
}

export function scoreTranscriptMetrics(events: readonly CommonEvent[]): TranscriptMetrics {
  return {
    n_turns: events.filter((event) => event.kind === "user_input").length,
    n_toolcalls: events.filter((event) => event.kind === "tool_call").length,
    n_total_tokens: events.reduce((total, event) => total + getTotalTokenContribution(event), 0)
  };
}

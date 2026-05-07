import type { CommonEvent } from "../../common-event.js";

import type { PerformanceScore } from "../types.js";

import { scoreLatencyMetrics } from "./latency-metrics.js";
import { scoreTranscriptMetrics } from "./transcript-metrics.js";

export function scorePerformance(events: readonly CommonEvent[]): PerformanceScore {
  return {
    ...scoreTranscriptMetrics(events),
    ...scoreLatencyMetrics(events)
  };
}

export { scoreTranscriptMetrics, scoreLatencyMetrics };

import type { CommonEvent } from "../../common-event.js";

import { getTokenContribution } from "./usage.js";

export interface LatencyMetrics {
  readonly output_tokens_per_sec: number | null;
  readonly time_to_first_token: number | null;
  readonly time_to_last_token: number | null;
}

function toTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toSeconds(milliseconds: number): number {
  return milliseconds / 1000;
}

function getSortedEvents(events: readonly CommonEvent[]): readonly CommonEvent[] {
  return [...events].sort((left, right) => {
    const leftTimestamp = toTimestamp(left.timestamp) ?? 0;
    const rightTimestamp = toTimestamp(right.timestamp) ?? 0;

    return leftTimestamp - rightTimestamp;
  });
}

export function scoreLatencyMetrics(events: readonly CommonEvent[]): LatencyMetrics {
  if (events.length === 0) {
    return {
      time_to_first_token: null,
      output_tokens_per_sec: null,
      time_to_last_token: null
    };
  }

  const sortedEvents = getSortedEvents(events);
  const firstTimestamp = toTimestamp(sortedEvents[0]!.timestamp);
  const lastTimestamp = toTimestamp(sortedEvents.at(-1)!.timestamp);
  const firstUserInput = sortedEvents.find((event) => event.kind === "user_input");
  const firstModelEvent = firstUserInput
    ? sortedEvents.find((event) => event.kind === "model" && (toTimestamp(event.timestamp) ?? -1) >= (toTimestamp(firstUserInput.timestamp) ?? 0))
    : undefined;

  let totalModelLatencySeconds = 0;
  let totalOutputTokens = 0;

  for (let index = 0; index < sortedEvents.length; index += 1) {
    const event = sortedEvents[index]!;

    if (event.kind !== "model") {
      continue;
    }

    totalOutputTokens += getTokenContribution(event).output_tokens;

    if (index === 0) {
      continue;
    }

    const currentTimestamp = toTimestamp(event.timestamp);
    const previousTimestamp = toTimestamp(sortedEvents[index - 1]!.timestamp);

    if (currentTimestamp === null || previousTimestamp === null || currentTimestamp <= previousTimestamp) {
      continue;
    }

    totalModelLatencySeconds += toSeconds(currentTimestamp - previousTimestamp);
  }

  return {
    time_to_first_token:
      firstUserInput && firstModelEvent
        ? Math.max(
            0,
            toSeconds((toTimestamp(firstModelEvent.timestamp) ?? 0) - (toTimestamp(firstUserInput.timestamp) ?? 0))
          )
        : null,
    output_tokens_per_sec:
      totalOutputTokens > 0 && totalModelLatencySeconds > 0 ? totalOutputTokens / totalModelLatencySeconds : null,
    time_to_last_token:
      firstTimestamp !== null && lastTimestamp !== null ? Math.max(0, toSeconds(lastTimestamp - firstTimestamp)) : null
  };
}

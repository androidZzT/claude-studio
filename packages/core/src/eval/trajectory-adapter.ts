import type { CommonEvent, CommonEventSource } from "./common-event.js";

export interface ParserContext {
  readonly session_id: string;
  readonly sequence: number;
  readonly state?: Record<string, unknown>;
}

export interface TrajectoryAdapter {
  readonly source: CommonEventSource;
  parseLine(line: string, ctx: ParserContext): CommonEvent | CommonEvent[] | null;
}

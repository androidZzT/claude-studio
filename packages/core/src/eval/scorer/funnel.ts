import { scorePerformance } from "./performance/index.js";
import { scoreQuality } from "./quality/index.js";
import { funnelScoreSchema } from "./types.js";
import type { FunnelScore, ScoreFunnelInput } from "./types.js";

export function scoreFunnel(input: ScoreFunnelInput): FunnelScore {
  return funnelScoreSchema.parse({
    schema_version: 1,
    quality: scoreQuality(input.quality),
    performance: scorePerformance(input.events)
  });
}

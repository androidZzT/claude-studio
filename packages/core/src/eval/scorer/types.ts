import { z } from "zod";

import type { CommonEvent } from "../common-event.js";

export interface TechDesignConformanceInput {
  readonly totalRules: number;
  readonly violations: number;
}

export interface AdoptionRateInput {
  readonly aiProducedLines: number;
  readonly reworkLines: number;
}

export interface ReviewPassEfficiencyInput {
  readonly reviewRound: number;
}

export interface FirstPassRateInput {
  readonly firstPassPRs: number;
  readonly totalPRs: number;
}

export interface SmokePassRateInput {
  readonly smokePassed: number;
  readonly smokeTotal: number;
}

export interface BugDensityInput {
  readonly bugCount: number;
  readonly totalLOC: number;
}

export interface QualityScoreInputs {
  readonly adoptionRate?: AdoptionRateInput | null;
  readonly bugDensity?: BugDensityInput | null;
  readonly firstPassRate?: FirstPassRateInput | null;
  readonly reviewPassEfficiency?: ReviewPassEfficiencyInput | null;
  readonly smokePassRate?: SmokePassRateInput | null;
  readonly techDesignConformance?: TechDesignConformanceInput | null;
}

export interface ScoreFunnelInput {
  readonly events: readonly CommonEvent[];
  readonly quality?: QualityScoreInputs;
}

const nullableUnitIntervalSchema = z.number().min(0).max(1).nullable();

export const qualityScoreSchema = z
  .object({
    tech_design_conformance: nullableUnitIntervalSchema,
    adoption_rate: nullableUnitIntervalSchema,
    review_pass_efficiency: z.number().positive().max(1).nullable(),
    first_pass_rate: nullableUnitIntervalSchema,
    smoke_pass_rate: nullableUnitIntervalSchema,
    bug_density: z.number().nonnegative().nullable()
  })
  .strict();

export const performanceScoreSchema = z
  .object({
    n_turns: z.number().int().nonnegative(),
    n_toolcalls: z.number().int().nonnegative(),
    n_total_tokens: z.number().int().nonnegative(),
    time_to_first_token: z.number().nonnegative().nullable(),
    output_tokens_per_sec: z.number().nonnegative().nullable(),
    time_to_last_token: z.number().nonnegative().nullable()
  })
  .strict();

export const funnelScoreSchema = z
  .object({
    schema_version: z.literal(1),
    quality: qualityScoreSchema,
    performance: performanceScoreSchema
  })
  .strict();

export const funnelEvalLogScoreSchema = z
  .object({
    scorer: z.literal("harness/funnel"),
    value: z.null(),
    answer: z.null(),
    metadata: funnelScoreSchema
  })
  .strict();

export type QualityScore = z.infer<typeof qualityScoreSchema>;
export type PerformanceScore = z.infer<typeof performanceScoreSchema>;
export type FunnelScore = z.infer<typeof funnelScoreSchema>;
export type FunnelEvalLogScore = z.infer<typeof funnelEvalLogScoreSchema>;

export function createFunnelEvalLogScore(score: FunnelScore): FunnelEvalLogScore {
  return funnelEvalLogScoreSchema.parse({
    scorer: "harness/funnel",
    value: null,
    answer: null,
    metadata: score
  });
}

import type { QualityScore, QualityScoreInputs } from "../types.js";

import { scoreAdoptionRate } from "./adoption-rate.js";
import { scoreBugDensity } from "./bug-density.js";
import { scoreFirstPassRate } from "./first-pass-rate.js";
import { scoreReviewPassEfficiency } from "./review-pass-efficiency.js";
import { scoreSmokePassRate } from "./smoke-pass-rate.js";
import { scoreTechDesignConformance } from "./tech-design-conformance.js";

export function scoreQuality(inputs: QualityScoreInputs = {}): QualityScore {
  return {
    tech_design_conformance: scoreTechDesignConformance(inputs.techDesignConformance),
    adoption_rate: scoreAdoptionRate(inputs.adoptionRate),
    review_pass_efficiency: scoreReviewPassEfficiency(inputs.reviewPassEfficiency),
    first_pass_rate: scoreFirstPassRate(inputs.firstPassRate),
    smoke_pass_rate: scoreSmokePassRate(inputs.smokePassRate),
    bug_density: scoreBugDensity(inputs.bugDensity)
  };
}

export {
  scoreTechDesignConformance,
  scoreAdoptionRate,
  scoreReviewPassEfficiency,
  scoreFirstPassRate,
  scoreSmokePassRate,
  scoreBugDensity
};

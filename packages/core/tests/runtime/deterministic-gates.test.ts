import { describe, expect, it } from "vitest";

import { applyDeterministicGateOverride, evaluateDeterministicSignals } from "../../src/index.js";
import type { DeterministicSignals } from "../../src/index.js";

const passingSignals: DeterministicSignals = {
  compile_pass: true,
  test_pass: true,
  lint_pass: true,
  diff_check_pass: true,
  reviewer_critical_count: 0,
  drift_check_pass: true
};

describe("deterministic gates", () => {
  it("passes when required deterministic signals are green", () => {
    expect(evaluateDeterministicSignals(passingSignals)).toEqual({
      status: "pass"
    });
  });

  it("treats missing and false deterministic signals as failures", () => {
    expect(
      evaluateDeterministicSignals({
        compile_pass: false,
        test_pass: true,
        lint_pass: true,
        diff_check_pass: true,
        reviewer_critical_count: 0
      })
    ).toEqual({
      failed_signals: ["compile_pass", "drift_check_pass"],
      forced_decision: "revise",
      reasons: ["compile_pass is false", "drift_check_pass is missing"],
      status: "fail"
    });
  });

  it("fails when reviewer critical findings are present", () => {
    expect(
      evaluateDeterministicSignals({
        ...passingSignals,
        reviewer_critical_count: 2
      })
    ).toEqual({
      failed_signals: ["reviewer_critical_count"],
      forced_decision: "revise",
      reasons: ["reviewer_critical_count is 2"],
      status: "fail"
    });
  });

  it("supports optional acceptance matrix enforcement", () => {
    expect(evaluateDeterministicSignals(passingSignals, { require_acceptance_matrix: true })).toEqual({
      failed_signals: ["acceptance_matrix_all_green"],
      forced_decision: "revise",
      reasons: ["acceptance_matrix_all_green is missing"],
      status: "fail"
    });

    expect(
      evaluateDeterministicSignals(
        {
          ...passingSignals,
          acceptance_matrix_all_green: true
        },
        { require_acceptance_matrix: true }
      )
    ).toEqual({ status: "pass" });
  });

  it("overrides an advisory go decision when deterministic signals fail", () => {
    const gateResult = evaluateDeterministicSignals({
      ...passingSignals,
      test_pass: false
    });

    expect(
      applyDeterministicGateOverride(
        {
          decision: "go",
          confidence: 0.9
        },
        gateResult
      )
    ).toEqual({
      decision: "revise",
      confidence: 0.9,
      deterministic_override: {
        failed_signals: ["test_pass"],
        forced_decision: "revise",
        reasons: ["test_pass is false"],
        status: "fail"
      }
    });
  });

  it("does not override revise or escalate decisions", () => {
    const gateResult = evaluateDeterministicSignals({
      ...passingSignals,
      lint_pass: false
    });
    const reviseDecision = {
      decision: "revise" as const,
      confidence: 0.8
    };
    const escalateDecision = {
      decision: "escalate" as const,
      confidence: 0.5
    };

    expect(applyDeterministicGateOverride(reviseDecision, gateResult)).toBe(reviseDecision);
    expect(applyDeterministicGateOverride(escalateDecision, gateResult)).toBe(escalateDecision);
  });
});

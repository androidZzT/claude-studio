export interface DeterministicSignals {
  readonly acceptance_matrix_all_green?: boolean;
  readonly compile_pass?: boolean;
  readonly diff_check_pass?: boolean;
  readonly drift_check_pass?: boolean;
  readonly lint_pass?: boolean;
  readonly reviewer_critical_count?: number;
  readonly test_pass?: boolean;
}

export interface DeterministicGateOptions {
  readonly require_acceptance_matrix?: boolean;
}

export interface DeterministicGatePass {
  readonly status: "pass";
}

export interface DeterministicGateFail {
  readonly failed_signals: readonly string[];
  readonly forced_decision: "revise";
  readonly reasons: readonly string[];
  readonly status: "fail";
}

export type DeterministicGateResult = DeterministicGatePass | DeterministicGateFail;

export interface AdvisoryCheckpointDecision {
  readonly decision: "go" | "revise" | "escalate";
  readonly [key: string]: unknown;
}

export type DeterministicCheckpointDecision =
  | AdvisoryCheckpointDecision
  | (AdvisoryCheckpointDecision & {
      readonly deterministic_override: DeterministicGateFail;
      readonly decision: "revise";
    });

const BOOLEAN_REQUIRED_SIGNALS: readonly (keyof DeterministicSignals)[] = [
  "compile_pass",
  "test_pass",
  "lint_pass",
  "diff_check_pass",
  "drift_check_pass"
];

function collectBooleanSignalFailure(signals: DeterministicSignals, signalName: keyof DeterministicSignals): string | undefined {
  const value = signals[signalName];

  if (value !== true) {
    return value === false ? `${signalName} is false` : `${signalName} is missing`;
  }

  return undefined;
}

export function evaluateDeterministicSignals(
  signals: DeterministicSignals,
  options: DeterministicGateOptions = {}
): DeterministicGateResult {
  const failures: string[] = [];
  const reasons: string[] = [];

  for (const signalName of BOOLEAN_REQUIRED_SIGNALS) {
    const reason = collectBooleanSignalFailure(signals, signalName);
    if (reason) {
      failures.push(signalName);
      reasons.push(reason);
    }
  }

  if (signals.reviewer_critical_count === undefined) {
    failures.push("reviewer_critical_count");
    reasons.push("reviewer_critical_count is missing");
  } else if (signals.reviewer_critical_count > 0) {
    failures.push("reviewer_critical_count");
    reasons.push(`reviewer_critical_count is ${signals.reviewer_critical_count}`);
  }

  if (options.require_acceptance_matrix) {
    const reason = collectBooleanSignalFailure(signals, "acceptance_matrix_all_green");
    if (reason) {
      failures.push("acceptance_matrix_all_green");
      reasons.push(reason);
    }
  }

  if (failures.length === 0) {
    return {
      status: "pass"
    };
  }

  return {
    failed_signals: failures,
    forced_decision: "revise",
    reasons,
    status: "fail"
  };
}

export function applyDeterministicGateOverride(
  decision: AdvisoryCheckpointDecision,
  gateResult: DeterministicGateResult
): DeterministicCheckpointDecision {
  if (gateResult.status === "pass" || decision.decision !== "go") {
    return decision;
  }

  return {
    ...decision,
    decision: "revise",
    deterministic_override: gateResult
  };
}

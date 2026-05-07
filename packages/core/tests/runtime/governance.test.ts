import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyTaskCardTimeout,
  evaluateBudget,
  evaluateRisk,
  getRunStorePaths,
  renderRiskEscalationQuestion,
} from "../../src/index.js";
import type { PhaseExecutionResult, PhaseSpec, TaskCard } from "../../src/index.js";

const taskCard: TaskCard = {
  acceptance_criteria: ["done"],
  allowed_paths: ["src/**"],
  budget: {
    max_cost_usd: 0.01,
    max_tokens: 10,
    max_tool_calls: 0,
    timeout_seconds: 3,
  },
  context_paths: [],
  denied_actions: [],
  goal: "bounded",
  human_review_required: false,
  risk_level: "medium",
  test_commands: [],
};

function phaseResult(): PhaseExecutionResult {
  return {
    cwd: "",
    duration_ms: 1,
    exit_code: 0,
    output_path: "output.md",
    phase_id: "build",
    signal: null,
    status: "completed",
    trajectory_summary: {
      assistant_message_count: 0,
      event_count: 0,
      phase_id: "build",
      skill_use_count: 0,
      status: "captured",
      tool_call_count: 2,
      tool_result_count: 0,
      total_tokens: 20,
      usage_reliable: true,
      usage_warnings: [],
      user_prompt_count: 0,
    },
  };
}

describe("runtime governance", () => {
  it("applies TaskCard timeout as an upper bound", () => {
    const phase: PhaseSpec = {
      agent: "coder",
      cwd_ref: "harness",
      phase_id: "build",
      provider_stall_timeout_seconds: 10,
      tool: "codex",
    };

    expect(applyTaskCardTimeout(phase, taskCard)).toMatchObject({
      provider_stall_timeout_seconds: 3,
    });
    expect(applyTaskCardTimeout(phase, undefined)).toBe(phase);
  });

  it("flags cost, token, and tool-call budget overruns", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "governance-"));
    const paths = getRunStorePaths(runRoot);
    await mkdir(path.join(paths.phasesDir, "build"), { recursive: true });
    await writeFile(
      path.join(paths.phasesDir, "build", "cost.json"),
      JSON.stringify({ dollars: 0.02 }),
      "utf8",
    );

    const report = await evaluateBudget({
      paths,
      phaseResult: phaseResult(),
      taskCard,
    });

    expect(report.status).toBe("critical");
    expect(report.findings.map((finding) => finding.code)).toEqual([
      "max_cost_usd_exceeded",
      "max_tokens_exceeded",
      "max_tool_calls_exceeded",
    ]);
  });

  it("escalates off-policy, dependency, and network risk signals", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "governance-"));
    const paths = getRunStorePaths(runRoot);
    await mkdir(path.join(paths.phasesDir, "build"), { recursive: true });
    await writeFile(
      path.join(paths.phasesDir, "build", "result.json"),
      JSON.stringify({
        changed_files: ["package.json", "secrets/token.txt"],
        commands_run: [],
        next_action: "review",
        risk_flags: ["network access requested"],
        status: "OK",
        summary: "changed risky files",
        tests: [],
      }),
      "utf8",
    );

    const report = await evaluateRisk({
      paths,
      phaseResult: phaseResult(),
      taskCard,
    });

    expect(report.status).toBe("escalate");
    expect(report.critical_count).toBeGreaterThanOrEqual(3);
    expect(renderRiskEscalationQuestion(report)).toContain("Risk Gate");
  });
});

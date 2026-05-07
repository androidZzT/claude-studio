import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultCheckpointModel,
  getRunStorePaths,
  recomputeEstimatedDollars,
  runCheckpoint,
} from "../../src/index.js";
import type { CheckpointJudge, DeterministicSignals } from "../../src/index.js";

const passingSignals: DeterministicSignals = {
  compile_pass: true,
  test_pass: true,
  lint_pass: true,
  diff_check_pass: true,
  reviewer_critical_count: 0,
  drift_check_pass: true,
};

function validDecision(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    decision: "go",
    confidence: 0.9,
    reasoning: "Looks good.",
    semantic_findings: [],
    ...overrides,
  });
}

async function createRunPaths(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const paths = getRunStorePaths(
    path.join(root, ".harness", "runs", "thread-1"),
  );
  await mkdir(paths.checkpointsDir, { recursive: true });
  return paths;
}

describe("checkpoint runtime", () => {
  it("selects default checkpoint models by previous phase class", () => {
    expect(defaultCheckpointModel("opus")).toBe("sonnet-4.6");
    expect(defaultCheckpointModel("drift")).toBe("sonnet-4.6");
    expect(defaultCheckpointModel("sonnet")).toBe("haiku-4.5");
    expect(defaultCheckpointModel("codex")).toBe("haiku-4.5");
  });

  it("writes a deterministic-only checkpoint when no judge is configured", async () => {
    const paths = await createRunPaths("checkpoint-deterministic-");

    const result = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: passingSignals,
      paths,
      previousPhaseModelClass: "codex",
      prompt: "judge",
    });

    expect(result).toMatchObject({
      attempts: 0,
      judge_used: false,
      model: "haiku-4.5",
      decision: {
        decision: "go",
        confidence: 1,
        reasoning:
          "No provider checkpoint judge was configured; deterministic signals decide whether this checkpoint can continue.",
      },
    });
    await expect(
      readFile(
        path.join(paths.checkpointsDir, "01-02", "decision.json"),
        "utf8",
      ),
    ).resolves.toContain('"judge_used": false');
  });

  it("retries invalid JSON once and then escalates", async () => {
    const paths = await createRunPaths("checkpoint-invalid-");
    const calls: string[] = [];
    const judge: CheckpointJudge = async (input) => {
      calls.push(input.model);
      return { text: "not json" };
    };

    const result = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: passingSignals,
      judge,
      paths,
      previousPhaseModelClass: "codex",
      prompt: "judge",
    });

    expect(calls).toEqual(["haiku-4.5", "haiku-4.5"]);
    expect(result).toEqual({
      attempts: 2,
      judge_used: true,
      model: "haiku-4.5",
      decision: {
        decision: "escalate",
        confidence: 0,
        reasoning: "Checkpoint judge returned invalid JSON twice.",
        semantic_findings: [],
        escalate_question_md:
          "Checkpoint judge returned invalid JSON twice. Please inspect the previous phase output and provide a decision.",
      },
    });
  });

  it("times out checkpoint calls and escalates", async () => {
    const paths = await createRunPaths("checkpoint-timeout-");
    const judge: CheckpointJudge = () => new Promise(() => undefined);

    const result = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: passingSignals,
      judge,
      paths,
      previousPhaseModelClass: "sonnet",
      prompt: "judge",
      timeoutMs: 1,
    });

    expect(result.decision).toEqual({
      decision: "escalate",
      confidence: 0,
      reasoning: "Checkpoint judge timed out.",
      semantic_findings: [],
      escalate_question_md:
        "Checkpoint judge exceeded the timeout. Please review the run state and decide whether to retry, revise, or stop.",
    });
  });

  it("escalates low confidence decisions", async () => {
    const paths = await createRunPaths("checkpoint-low-confidence-");
    const judge: CheckpointJudge = async () => ({
      text: validDecision({ confidence: 0.5 }),
    });

    const result = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: passingSignals,
      judge,
      paths,
      previousPhaseModelClass: "codex",
      prompt: "judge",
    });

    expect(result.decision).toEqual({
      decision: "escalate",
      confidence: 0,
      reasoning: "Checkpoint confidence 0.5 is below threshold.",
      semantic_findings: [],
      escalate_question_md:
        "Checkpoint confidence was below 0.6. Please review the previous phase and decide whether to go, revise, or stop.",
    });
  });

  it("applies deterministic override after schema validation", async () => {
    const paths = await createRunPaths("checkpoint-override-");
    const judge: CheckpointJudge = async () => ({
      text: validDecision(),
    });

    const result = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: {
        ...passingSignals,
        compile_pass: false,
      },
      judge,
      paths,
      previousPhaseModelClass: "codex",
      prompt: "judge",
    });

    expect(result.decision).toMatchObject({
      decision: "revise",
      confidence: 0.9,
      deterministic_override: {
        failed_signals: ["compile_pass"],
        forced_decision: "revise",
        reasons: ["compile_pass is false"],
        status: "fail",
      },
    });
  });

  it("records checkpoint cost for estimated dollar aggregation", async () => {
    const paths = await createRunPaths("checkpoint-cost-");
    await mkdir(path.join(paths.phasesDir, "01-architect"), {
      recursive: true,
    });
    await writeFile(
      path.join(paths.phasesDir, "01-architect", "cost.json"),
      '{"dollars":1.25}\n',
      "utf8",
    );
    const judge: CheckpointJudge = async () => ({
      text: validDecision(),
      cost: {
        tokens_in: 10,
        tokens_out: 5,
        model: "haiku-4.5",
        dollars: 0.75,
      },
    });

    const result = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: passingSignals,
      judge,
      model: "custom-judge",
      paths,
      previousPhaseModelClass: "codex",
      prompt: "judge",
    });

    expect(result.model).toBe("custom-judge");
    await expect(
      readFile(path.join(paths.checkpointsDir, "01-02", "cost.json"), "utf8"),
    ).resolves.toContain('"dollars": 0.75');
    await expect(recomputeEstimatedDollars(paths)).resolves.toBe(2);
  });
});

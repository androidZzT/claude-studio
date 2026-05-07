import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  initializeRunStore,
  loadRunState,
  parseHarnessConfig,
  resumeRunFromDecision,
  runCheckpoint,
  runPhase,
  saveRunState,
  writeEscalationRequest,
} from "../../src/index.js";
import type {
  CheckpointJudge,
  DeterministicSignals,
  PhaseSpawn,
  PhaseSpec,
  RunStorePaths,
} from "../../src/index.js";

const passingSignals: DeterministicSignals = {
  compile_pass: true,
  test_pass: true,
  lint_pass: true,
  diff_check_pass: true,
  reviewer_critical_count: 0,
  drift_check_pass: true,
};

function decision(
  decisionValue: "go" | "revise" | "escalate",
  extras: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    decision: decisionValue,
    confidence: 0.9,
    reasoning: "Mock judge decision.",
    semantic_findings: [],
    ...extras,
  });
}

function createSpawnMock(): {
  readonly calls: string[];
  readonly spawnImpl: PhaseSpawn;
} {
  const calls: string[] = [];
  const spawnImpl: PhaseSpawn = (file, args) => {
    calls.push(`${file} ${args.join(" ")}`);

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    child.stdout = stdout;
    child.stderr = stderr;

    queueMicrotask(() => {
      stdout.end(`session_id: ${file}-session\n`);
      stderr.end("");
      child.emit("close", 0, null);
    });

    return child;
  };

  return { calls, spawnImpl };
}

function phase(phaseId: string): PhaseSpec {
  return {
    agent: "architect",
    cwd_ref: "harness",
    phase_id: phaseId,
    tool: "claude-code",
  };
}

async function createMockRun(prefix: string): Promise<{
  readonly harnessRepoPath: string;
  readonly paths: RunStorePaths;
}> {
  const harnessRepoPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  await writeFile(
    path.join(harnessRepoPath, ".gitignore"),
    ".harness/\n",
    "utf8",
  );
  const { paths } = await initializeRunStore({
    brief: "# Brief\nBuild a mock feature.\n",
    harnessRepoPath,
    processInfo: {
      hostname: "test-host",
      nowIso: () => "2026-05-04T00:00:00.000Z",
      pid: 123,
    },
    runId: "run-1",
    threadId: "thread-1",
  });

  return { harnessRepoPath, paths };
}

async function markCompleted(paths: RunStorePaths): Promise<void> {
  const state = await loadRunState(paths);
  await saveRunState(paths, {
    ...state,
    status: "completed",
  });
  await writeFile(
    path.join(paths.rootDir, "summary.md"),
    "# Mock Summary\n\nstatus: completed\n",
    "utf8",
  );
}

describe("mock compound autonomous e2e", () => {
  it("runs the green path and writes a summary", async () => {
    const { harnessRepoPath, paths } = await createMockRun(
      "mock-compound-green-",
    );
    const config = parseHarnessConfig("name: mock\n");
    const { calls, spawnImpl } = createSpawnMock();
    const judge: CheckpointJudge = async () => ({
      text: decision("go"),
    });

    const phaseResult = await runPhase({
      config,
      harnessRepoPath,
      outputMd: "# Phase Output\nGreen.\n",
      paths,
      phase: phase("01-architect"),
      prompt: "plan",
      spawnImpl,
    });
    const checkpoint = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: passingSignals,
      judge,
      paths,
      previousPhaseModelClass: "sonnet",
      prompt: "judge",
    });
    if (
      phaseResult.status === "completed" &&
      checkpoint.decision.decision === "go"
    ) {
      await markCompleted(paths);
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("claude -p Harness-Phase-Fingerprint:");
    expect(calls[0]).toContain("plan");
    await expect(
      readFile(path.join(paths.rootDir, "summary.md"), "utf8"),
    ).resolves.toContain("status: completed");
    await expect(loadRunState(paths)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("runs a revise path retry within budget", async () => {
    const { harnessRepoPath, paths } = await createMockRun(
      "mock-compound-revise-",
    );
    const config = parseHarnessConfig("name: mock\n");
    const { calls, spawnImpl } = createSpawnMock();
    const decisions = [
      decision("revise", {
        revise_target_phase: "01-architect",
        revise_feedback_md: "Tighten the design.",
      }),
      decision("go"),
    ];
    const judge: CheckpointJudge = async () => ({
      text: decisions.shift()!,
    });

    await runPhase({
      config,
      harnessRepoPath,
      outputMd: "# Phase Output\nNeeds revision.\n",
      paths,
      phase: phase("01-architect"),
      prompt: "plan v1",
      spawnImpl,
    });
    const firstCheckpoint = await runCheckpoint({
      checkpointId: "01-02-a",
      deterministicSignals: passingSignals,
      judge,
      paths,
      previousPhaseModelClass: "sonnet",
      prompt: "judge",
    });

    if (firstCheckpoint.decision.decision === "revise") {
      await runPhase({
        config,
        harnessRepoPath,
        outputMd: "# Phase Output\nRevised.\n",
        paths,
        phase: phase("01-architect-retry"),
        prompt: "plan v2",
        spawnImpl,
      });
    }

    const secondCheckpoint = await runCheckpoint({
      checkpointId: "01-02-b",
      deterministicSignals: passingSignals,
      judge,
      paths,
      previousPhaseModelClass: "sonnet",
      prompt: "judge again",
    });

    expect(firstCheckpoint.decision.decision).toBe("revise");
    expect(secondCheckpoint.decision.decision).toBe("go");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("plan v1");
    expect(calls[1]).toContain("plan v2");
  });

  it("pauses on escalation and resumes from a decision file", async () => {
    const { paths } = await createMockRun("mock-compound-escalate-");
    const judge: CheckpointJudge = async () => ({
      text: decision("escalate", {
        escalate_question_md: "Need human decision.",
      }),
    });

    const checkpoint = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: passingSignals,
      judge,
      paths,
      previousPhaseModelClass: "sonnet",
      prompt: "judge",
    });
    const pause = await writeEscalationRequest(
      paths,
      "01-02",
      checkpoint.decision.escalate_question_md as string,
      {
        nowIso: () => "2026-05-04T00:01:00.000Z",
      },
    );
    await writeFile(
      pause.requestPath!.replace(".request.md", ".decision.md"),
      "continue\n",
      "utf8",
    );

    const resumed = await resumeRunFromDecision(paths);

    expect(pause.status).toBe("paused");
    expect(resumed.status).toBe("running");
  });

  it("does not let a judge overrule a failed deterministic gate", async () => {
    const { paths } = await createMockRun("mock-compound-failed-gate-");
    const judge: CheckpointJudge = async () => ({
      text: decision("go"),
    });

    const checkpoint = await runCheckpoint({
      checkpointId: "01-02",
      deterministicSignals: {
        ...passingSignals,
        test_pass: false,
      },
      judge,
      paths,
      previousPhaseModelClass: "sonnet",
      prompt: "judge",
    });

    expect(checkpoint.decision).toMatchObject({
      decision: "revise",
      deterministic_override: {
        failed_signals: ["test_pass"],
        status: "fail",
      },
    });
  });
});

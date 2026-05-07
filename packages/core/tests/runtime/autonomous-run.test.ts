import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import {
  getRunStorePaths,
  loadRunState,
  runAutonomousExecution,
} from "../../src/index.js";
import type {
  CheckpointJudge,
  GateCommandSpawn,
  PhaseSpawn,
} from "../../src/index.js";

function createPhaseSpawn(): {
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
      stdout.end(`# ${file} output\nsession_id: ${file}-session\n`);
      stderr.end("");
      child.emit("close", 0, null);
    });

    return child;
  };

  return { calls, spawnImpl };
}

function createProviderStallPhaseSpawn(): PhaseSpawn {
  return () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {
      queueMicrotask(() => {
        stdout.end("");
        stderr.end("");
        child.emit("close", null, "SIGTERM");
      });
      return true;
    };

    queueMicrotask(() => {
      stderr.write("ERROR: Reconnecting... 5/5\n");
    });

    return child;
  };
}

function createGateSpawn(exitCode = 0): GateCommandSpawn {
  return () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    queueMicrotask(() => {
      stdout.end("gate ok");
      stderr.end("");
      child.emit("close", exitCode, null);
    });
    return child;
  };
}

function checkpointDecision(
  decision: "go" | "revise" | "escalate",
  extras: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    decision,
    confidence: 0.9,
    reasoning: "Mock checkpoint decision.",
    semantic_findings: [],
    ...extras,
  });
}

async function createHarnessFixture(): Promise<string> {
  const harnessRepoPath = await mkdtemp(
    path.join(os.tmpdir(), "autonomous-run-"),
  );
  await mkdir(
    path.join(harnessRepoPath, "skills", "compound", "compound-fixture"),
    {
      recursive: true,
    },
  );
  await mkdir(path.join(harnessRepoPath, "targets", "android"), {
    recursive: true,
  });
  await mkdir(path.join(harnessRepoPath, "targets", "ios"), {
    recursive: true,
  });
  await writeFile(
    path.join(harnessRepoPath, ".gitignore"),
    ".harness/\n",
    "utf8",
  );
  await writeFile(
    path.join(harnessRepoPath, "harness.yaml"),
    YAML.stringify({
      schema_version: 2,
      name: "run-fixture",
      tools: ["codex", "claude-code"],
      projects: {
        targets: {
          android: { path: "targets/android" },
          ios: { path: "targets/ios" },
        },
        references: {},
      },
      models: {
        codex: {
          default: {
            approval_policy: "never",
            effort: "high",
            model: "gpt-5.5",
            sandbox_mode: "workspace-write",
          },
          agents: {
            "android-coder": {
              effort: "medium",
            },
          },
        },
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(
      harnessRepoPath,
      "skills",
      "compound",
      "compound-fixture",
      "SKILL.md",
    ),
    [
      "---",
      "name: compound-fixture",
      "description: Fixture compound skill.",
      "phases:",
      "  - phase_id: design",
      "    agent: architect",
      "    tool: claude-code",
      "    cwd_ref: harness",
      "    instructions:",
      "      - Only check active experiment hygiene.",
      "      - Do not perform implementation work.",
      "  - phase_id: android-build",
      "    agent: android-coder",
      "    tool: codex",
      "    cwd_ref: target:android",
      "    parallel_group: implementation",
      "    gate_commands:",
      "      - id: android-diff",
      "        kind: diff",
      "        cwd_ref: target:android",
      '        argv: ["git", "diff", "--check"]',
      "        timeout_seconds: 30",
      "  - phase_id: ios-build",
      "    agent: ios-coder",
      "    tool: claude-code",
      "    cwd_ref: target:ios",
      "    parallel_group: implementation",
      "---",
      "",
      "# Fixture",
      "",
    ].join("\n"),
    "utf8",
  );

  return harnessRepoPath;
}

describe("autonomous run execution", () => {
  it("executes phases, parallel groups, gates, summary, and visualization", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { calls, spawnImpl } = createPhaseSpawn();

    const report = await runAutonomousExecution(process.cwd(), {
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(),
      harnessRepoPath,
      prompt: "Build the fixture.",
      runId: "run-1",
      spawnImpl,
      threadId: "thread-1",
    });

    const paths = getRunStorePaths(
      path.join(harnessRepoPath, ".harness", "runs", "thread-1"),
    );
    expect(report).toMatchObject({
      completed_phase_count: 3,
      run_id: "run-1",
      status: "completed",
      thread_id: "thread-1",
    });
    expect(calls).toHaveLength(3);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('codex exec --config model="gpt-5.5"'),
        expect.stringContaining('--config model_reasoning_effort="medium"'),
        expect.stringContaining("--output-last-message"),
        expect.stringContaining("claude -p"),
      ]),
    );
    expect(calls.join("\n")).toContain("## Phase Instructions");
    expect(calls.join("\n")).toContain("Only check active experiment hygiene.");
    await expect(loadRunState(paths)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(readFile(report.summary_path, "utf8")).resolves.toContain(
      "status: completed",
    );
    await expect(
      readFile(report.visualization_html_path!, "utf8"),
    ).resolves.toContain("Harness Run Report");
    await expect(
      readFile(
        path.join(paths.gatesDir, "android-build", "android-diff.json"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
  });

  it("persists TaskCard artifacts and validates synthesized phase results", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const taskCardPath = path.join(harnessRepoPath, "task-card.json");
    await writeFile(
      taskCardPath,
      JSON.stringify(
        {
          acceptance_criteria: ["phase output captured"],
          allowed_paths: ["targets/**", ".harness/**"],
          budget: { max_tokens: 1000, timeout_seconds: 30 },
          context_paths: [],
          denied_actions: ["no release"],
          goal: "Bounded fixture run",
          human_review_required: false,
          risk_level: "medium",
          test_commands: ["git diff --check"],
        },
        null,
        2,
      ),
      "utf8",
    );
    const { spawnImpl } = createPhaseSpawn();

    const report = await runAutonomousExecution(process.cwd(), {
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(),
      harnessRepoPath,
      runId: "run-1",
      spawnImpl,
      taskCardPath,
      threadId: "thread-1",
    });
    const paths = getRunStorePaths(
      path.join(harnessRepoPath, ".harness", "runs", "thread-1"),
    );

    expect(report.task_card_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(paths.taskCardPath, "utf8")).resolves.toContain(
      "Bounded fixture run",
    );
    await expect(
      readFile(path.join(paths.phasesDir, "design", "result.json"), "utf8"),
    ).resolves.toContain('"status": "OK"');
    await expect(
      readFile(
        path.join(paths.validationDir, "design", "result-schema.json"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(path.join(paths.rootDir, "run-family.json"), "utf8"),
    ).resolves.toContain(report.task_card_hash!);
  });

  it("fails the run when a gate command fails", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { spawnImpl } = createPhaseSpawn();

    const report = await runAutonomousExecution(process.cwd(), {
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(1),
      harnessRepoPath,
      prompt: "Build the fixture.",
      runId: "run-1",
      spawnImpl,
      threadId: "thread-1",
    });

    expect(report).toMatchObject({
      failed_reason: "gate_failed:android-build",
      status: "failed",
    });
    await expect(readFile(report.summary_path, "utf8")).resolves.toContain(
      "failed_reason: gate_failed:android-build",
    );
  });

  it("blocks before spawning an agent when a pre-phase env gate fails", async () => {
    const harnessRepoPath = await createHarnessFixture();
    await writeFile(
      path.join(
        harnessRepoPath,
        "skills",
        "compound",
        "compound-fixture",
        "SKILL.md",
      ),
      [
        "---",
        "name: compound-fixture",
        "phases:",
        "  - phase_id: design",
        "    agent: architect",
        "    tool: claude-code",
        "    cwd_ref: harness",
        "    pre_phase_gate_commands:",
        "      - id: env-check",
        "        kind: env",
        "        cwd_ref: harness",
        '        argv: ["node", "--bad-option"]',
        "        timeout_seconds: 30",
        "---",
        "",
        "# Fixture",
        "",
      ].join("\n"),
      "utf8",
    );
    const { calls, spawnImpl } = createPhaseSpawn();

    const report = await runAutonomousExecution(process.cwd(), {
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(1),
      harnessRepoPath,
      prompt: "Build the fixture.",
      runId: "run-1",
      spawnImpl,
      threadId: "thread-1",
    });

    expect(report).toMatchObject({
      completed_phase_count: 0,
      failed_reason: "environment_blocked",
      status: "failed",
    });
    expect(calls).toEqual([]);
    expect(report.phase_reports[0]?.result).toMatchObject({
      phase_id: "design",
      reason: "preflight-gate-failed:env-check",
      status: "failed",
    });
  });

  it("classifies provider stalls separately from code failures", async () => {
    const harnessRepoPath = await createHarnessFixture();

    const report = await runAutonomousExecution(process.cwd(), {
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(),
      harnessRepoPath,
      prompt: "Build the fixture.",
      runId: "run-1",
      spawnImpl: createProviderStallPhaseSpawn(),
      threadId: "thread-1",
    });

    expect(report).toMatchObject({
      completed_phase_count: 0,
      failed_reason: "provider_stalled",
      status: "failed",
    });
    expect(report.phase_reports[0]?.result).toMatchObject({
      provider_stall_detail: "reconnect exhausted",
      reason: "provider_stalled",
      status: "failed",
    });
    await expect(readFile(report.summary_path, "utf8")).resolves.toContain(
      "failed_reason: provider_stalled",
    );
  });

  it("runs checkpoints after each successful phase batch", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { spawnImpl } = createPhaseSpawn();
    const checkpointCalls: string[] = [];
    const checkpointJudge: CheckpointJudge = async (input) => {
      checkpointCalls.push(`${input.checkpoint_id}:${input.model}`);
      return { text: checkpointDecision("go") };
    };

    const report = await runAutonomousExecution(process.cwd(), {
      checkpointJudge,
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(),
      harnessRepoPath,
      prompt: "Build the fixture.",
      runId: "run-1",
      spawnImpl,
      threadId: "thread-1",
    });

    expect(report.status).toBe("completed");
    expect(report.checkpoint_reports).toHaveLength(2);
    expect(checkpointCalls).toEqual([
      "checkpoint-1-design:haiku-4.5",
      "checkpoint-2-implementation:haiku-4.5",
    ]);
    await expect(readFile(report.summary_path, "utf8")).resolves.toContain(
      "checkpoint-1-design: go",
    );
  });

  it("stops on checkpoint revise feedback", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { calls, spawnImpl } = createPhaseSpawn();
    const checkpointJudge: CheckpointJudge = async () => ({
      text: checkpointDecision("revise", {
        revise_target_phase: "design",
        revise_feedback_md: "Tighten the contract before implementation.",
      }),
    });

    const report = await runAutonomousExecution(process.cwd(), {
      checkpointJudge,
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(),
      harnessRepoPath,
      prompt: "Build the fixture.",
      runId: "run-1",
      spawnImpl,
      threadId: "thread-1",
    });

    expect(report).toMatchObject({
      completed_phase_count: 1,
      failed_reason: "checkpoint_revise:checkpoint-1-design",
      status: "failed",
    });
    expect(calls).toHaveLength(1);
    await expect(readFile(report.summary_path, "utf8")).resolves.toContain(
      "failed_reason: checkpoint_revise:checkpoint-1-design",
    );
  });

  it("pauses on checkpoint escalation and resumes remaining phases", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { calls, spawnImpl } = createPhaseSpawn();
    const checkpointJudge: CheckpointJudge = async () => ({
      text: checkpointDecision("escalate", {
        escalate_question_md: "Need a human decision before implementation.",
      }),
    });

    const pausedReport = await runAutonomousExecution(process.cwd(), {
      checkpointJudge,
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(),
      harnessRepoPath,
      prompt: "Build the fixture.",
      runId: "run-1",
      spawnImpl,
      threadId: "thread-1",
    });

    expect(pausedReport.status).toBe("paused");
    expect(pausedReport.checkpoint_reports[0]?.notification_path).toBeTruthy();
    await expect(
      loadRunState(
        getRunStorePaths(
          path.join(harnessRepoPath, ".harness", "runs", "thread-1"),
        ),
      ),
    ).resolves.toMatchObject({ status: "paused" });
    await writeFile(
      pausedReport.checkpoint_reports[0]!.notification_path!.replace(
        ".request.md",
        ".decision.md",
      ),
      "continue\n",
      "utf8",
    );

    const resumedReport = await runAutonomousExecution(process.cwd(), {
      compoundName: "compound-fixture",
      gateSpawnImpl: createGateSpawn(),
      harnessRepoPath,
      resume: true,
      spawnImpl,
      threadId: "thread-1",
    });

    expect(resumedReport.status).toBe("completed");
    expect(resumedReport.completed_phase_count).toBe(3);
    expect(calls).toHaveLength(3);
  });
});

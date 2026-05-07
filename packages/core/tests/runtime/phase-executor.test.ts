import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  getRunStorePaths,
  parseHarnessConfig,
  createPhasePromptSha256,
  resolveCwdRef,
  runPhase,
  runPhaseGroup,
} from "../../src/index.js";
import type { PhaseSpawn, PhaseSpec } from "../../src/index.js";

interface SpawnCall {
  readonly args: string[];
  readonly cwd: string;
  readonly file: string;
  readonly shell: false;
}

function createSpawnMock(
  options: {
    readonly closeDelayMs?: number;
    readonly exitCode?: number;
    readonly includeSessionId?: boolean;
    readonly stdoutText?: string;
  } = {},
): {
  readonly calls: SpawnCall[];
  readonly getMaxActive: () => number;
  readonly spawnImpl: PhaseSpawn;
} {
  const calls: SpawnCall[] = [];
  let active = 0;
  let maxActive = 0;
  const spawnImpl: PhaseSpawn = (file, args, spawnOptions) => {
    calls.push({
      file,
      args,
      cwd: spawnOptions.cwd,
      shell: spawnOptions.shell,
    });
    active += 1;
    maxActive = Math.max(maxActive, active);

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    child.stdout = stdout;
    child.stderr = stderr;

    setTimeout(() => {
      stdout.end(
        options.stdoutText ??
          `stdout from ${file}\n${options.includeSessionId === false ? "" : `session_id: ${file}-session\n`}`,
      );
      stderr.end(`stderr from ${file}\n`);
      active -= 1;
      child.emit("close", options.exitCode ?? 0, null);
    }, options.closeDelayMs ?? 0);

    return child;
  };

  return {
    calls,
    getMaxActive: () => maxActive,
    spawnImpl,
  };
}

function createProviderStallSpawn(): {
  readonly getKilled: () => boolean;
  readonly spawnImpl: PhaseSpawn;
} {
  let killed = false;
  const spawnImpl: PhaseSpawn = () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {
      killed = true;
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

  return {
    getKilled: () => killed,
    spawnImpl,
  };
}

function phase(overrides: Partial<PhaseSpec>): PhaseSpec {
  return {
    agent: "architect",
    cwd_ref: "harness",
    phase_id: "01-architect",
    tool: "claude-code",
    ...overrides,
  };
}

describe("phase executor", () => {
  it("resolves cwd_ref values from harness config without hardcoded agent names", () => {
    const repo = "/tmp/harness";
    const config = parseHarnessConfig(`
name: phase-fixture
projects:
  targets:
    android:
      path: ../transaction_android
  references:
    machpro:
      path: ../machpro
`);

    expect(resolveCwdRef(config, repo, "harness")).toBe(repo);
    expect(resolveCwdRef(config, repo, "target:android")).toBe(
      path.resolve(repo, "../transaction_android"),
    );
    expect(resolveCwdRef(config, repo, "reference:machpro")).toBe(
      path.resolve(repo, "../machpro"),
    );
    expect(() => resolveCwdRef(config, repo, "target:ios")).toThrow(
      /Missing target/,
    );
    expect(() => resolveCwdRef(config, repo, "agent:architect")).toThrow(
      /Unsupported cwd_ref/,
    );
  });

  it("spawns Claude and Codex phases with expected argv and cwd, tees logs, and writes artifacts", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "phase-executor-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const stdoutMirror = new PassThrough();
    const stderrMirror = new PassThrough();
    let mirroredStdout = "";
    let mirroredStderr = "";
    stdoutMirror.on("data", (chunk) => {
      mirroredStdout += String(chunk);
    });
    stderrMirror.on("data", (chunk) => {
      mirroredStderr += String(chunk);
    });
    await mkdir(paths.phasesDir, { recursive: true });
    const config = parseHarnessConfig(`
name: phase-fixture
projects:
  targets:
    android:
      path: ../transaction_android
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
      sandbox_mode: workspace-write
      approval_policy: never
    agents:
      android-coder:
        effort: medium
`);
    const { calls, spawnImpl } = createSpawnMock();

    const claudeResult = await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "# Architect output\n",
      paths,
      phase: phase({
        phase_id: "01-architect",
        tool: "claude-code",
        cwd_ref: "harness",
      }),
      prompt: "design it",
      spawnImpl,
      stdoutMirror,
      stderrMirror,
    });
    const codexResult = await runPhase({
      config,
      cost: { tokens_in: 10, tokens_out: 5, model: "gpt", dollars: 0.25 },
      harnessRepoPath: repo,
      outputMd: "# Android output\n",
      paths,
      phase: phase({
        agent: "android-coder",
        cwd_ref: "target:android",
        phase_id: "02-android",
        profile: "android-coder",
        tool: "codex",
      }),
      prompt: "implement it",
      spawnImpl,
    });

    expect(calls).toEqual([
      {
        file: "claude",
        args: ["-p", expect.stringContaining("Harness-Phase-Fingerprint:")],
        cwd: repo,
        shell: false,
      },
      {
        file: "codex",
        args: [
          "exec",
          "--config",
          'model="gpt-5.5"',
          "--config",
          'model_reasoning_effort="medium"',
          "--config",
          'sandbox_mode="workspace-write"',
          "--config",
          'approval_policy="never"',
          "--output-last-message",
          path.join(paths.phasesDir, "02-android", "output.md"),
          "--full-auto",
          expect.stringContaining("Harness-Phase-Fingerprint:"),
        ],
        cwd: path.resolve(repo, "../transaction_android"),
        shell: false,
      },
    ]);
    expect(claudeResult).toMatchObject({
      phase_id: "01-architect",
      status: "completed",
      session_id: "claude-session",
    });
    expect(codexResult).toMatchObject({
      phase_id: "02-android",
      status: "completed",
      session_id: "codex-session",
    });
    await expect(
      readFile(
        path.join(paths.phasesDir, "01-architect", "stdout.log"),
        "utf8",
      ),
    ).resolves.toContain("stdout from claude");
    await expect(
      readFile(
        path.join(paths.phasesDir, "01-architect", "stderr.log"),
        "utf8",
      ),
    ).resolves.toContain("stderr from claude");
    await expect(
      readFile(path.join(paths.phasesDir, "01-architect", "prompt.md"), "utf8"),
    ).resolves.toContain("Harness-Phase-Fingerprint:");
    await expect(
      readFile(
        path.join(paths.phasesDir, "01-architect", "session.json"),
        "utf8",
      ),
    ).resolves.toContain('"trajectory_status": "missing"');
    await expect(
      readFile(
        path.join(paths.phasesDir, "01-architect", "exit_code.json"),
        "utf8",
      ),
    ).resolves.toContain('"status": "completed"');
    await expect(
      readFile(path.join(paths.phasesDir, "02-android", "cost.json"), "utf8"),
    ).resolves.toContain('"dollars": 0.25');
    await expect(
      readFile(
        path.join(paths.trajectoryDir, "01-architect", "summary.json"),
        "utf8",
      ),
    ).resolves.toContain('"status": "missing"');
    await expect(
      readFile(
        path.join(paths.auditsDir, "01-architect", "default.json"),
        "utf8",
      ),
    ).resolves.toContain('"blocked": false');
    expect(mirroredStdout).toContain("stdout from claude");
    expect(mirroredStderr).toContain("stderr from claude");
  });

  it("fails a zero-exit phase when output.md is missing or empty", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-missing-output-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
`);
    const { spawnImpl } = createSpawnMock({ stdoutText: "" });

    const missingOutputResult = await runPhase({
      config,
      harnessRepoPath: repo,
      paths,
      phase: phase({ phase_id: "01-missing-output" }),
      prompt: "do it",
      spawnImpl,
    });
    const emptyOutputResult = await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "",
      paths,
      phase: phase({ phase_id: "02-empty-output" }),
      prompt: "do it",
      spawnImpl,
    });

    expect(missingOutputResult).toMatchObject({
      status: "failed",
      reason: "phase-output-missing-or-empty",
    });
    expect(emptyOutputResult).toMatchObject({
      status: "failed",
      reason: "phase-output-missing-or-empty",
    });
  });

  it("passes phase mode to Claude Code and maps Codex plan mode to read-only execution", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "phase-executor-mode-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
      sandbox_mode: workspace-write
      approval_policy: never
`);
    const { calls, spawnImpl } = createSpawnMock();

    await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "# Plan\n",
      paths,
      phase: phase({ mode: "plan", phase_id: "01-claude-plan" }),
      prompt: "plan it",
      spawnImpl,
    });
    await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "# Codex plan\n",
      paths,
      phase: phase({
        mode: "plan",
        phase_id: "02-codex-plan",
        tool: "codex",
      }),
      prompt: "plan it",
      spawnImpl,
    });

    expect(calls[0]).toMatchObject({
      file: "claude",
      args: [
        "-p",
        "--permission-mode",
        "plan",
        expect.stringContaining("Harness-Phase-Mode: plan"),
      ],
    });
    expect(calls[1]?.args).toEqual(
      expect.arrayContaining([
        "--config",
        'sandbox_mode="read-only"',
        "--config",
        'approval_policy="never"',
        expect.stringContaining("Harness-Phase-Mode: plan"),
      ]),
    );
    expect(calls[1]?.args).not.toContain("--full-auto");
    await expect(
      readFile(
        path.join(paths.phasesDir, "02-codex-plan", "session.json"),
        "utf8",
      ),
    ).resolves.toContain('"mode": "plan"');
  });

  it("rejects unsupported Codex phase modes before spawning", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-mode-unsupported-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
`);
    const { calls, spawnImpl } = createSpawnMock();

    await expect(
      runPhase({
        config,
        harnessRepoPath: repo,
        outputMd: "# Output\n",
        paths,
        phase: phase({
          mode: "unsupported",
          phase_id: "01-unsupported",
          tool: "codex",
        }),
        prompt: "do it",
        spawnImpl,
      }),
    ).rejects.toThrow(/Unsupported Codex phase mode/);
    expect(calls).toHaveLength(0);
  });

  it("marks provider reconnect exhaustion as provider_stalled", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-provider-stall-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const config = parseHarnessConfig(`
name: phase-fixture
`);
    const { getKilled, spawnImpl } = createProviderStallSpawn();

    const result = await runPhase({
      config,
      harnessRepoPath: repo,
      paths,
      phase: phase({ phase_id: "01-stalled" }),
      prompt: "do it",
      spawnImpl,
    });

    expect(getKilled()).toBe(true);
    expect(result).toMatchObject({
      provider_stall_detail: "reconnect exhausted",
      reason: "provider_stalled",
      status: "failed",
    });
    await expect(
      readFile(
        path.join(paths.phasesDir, "01-stalled", "partial-output.md"),
        "utf8",
      ),
    ).resolves.toContain("provider_stalled: reconnect exhausted");
  });

  it("uses an injected audit judge and blocks critical judge findings", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "phase-executor-audit-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
`);
    const { spawnImpl } = createSpawnMock();

    const result = await runPhase({
      auditJudge: async (input) => ({
        findings: [
          {
            severity: "critical",
            message: `judge found mismatch in ${input.audit_id}`,
          },
        ],
        next_phase_risk: "semantic mismatch blocks next phase",
        recommendation: "revise",
        score: 0.2,
      }),
      config,
      harnessRepoPath: repo,
      outputMd: "# Output\n",
      paths,
      phase: phase({
        audit_model: "sonnet-4.6",
        phase_id: "01-audited",
        post_phase_audits: [{ audit_id: "semantic-review" }],
      }),
      prompt: "do it",
      spawnImpl,
    });

    expect(result.audit_blocked).toBe(true);
    expect(result.audits?.[0]).toMatchObject({
      audit_id: "semantic-review",
      blocked: true,
      critical_count: 1,
      judge_model: "sonnet-4.6",
      judge_used: true,
      recommendation: "revise",
      score: 0.2,
    });
    await expect(
      readFile(
        path.join(paths.auditsDir, "01-audited", "semantic-review.json"),
        "utf8",
      ),
    ).resolves.toContain('"judge_used": true');
  });

  it("feeds bounded audit context and blocks missing required outputs", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-audit-context-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    await writeFile(path.join(repo, "contract.md"), "# Contract\n", "utf8");
    const config = parseHarnessConfig(`
name: phase-fixture
`);
    const { spawnImpl } = createSpawnMock();
    let contextSeen = false;

    const result = await runPhase({
      auditJudge: async (input) => {
        contextSeen = input.context_artifacts.some((artifact) =>
          artifact.content.includes("# Contract"),
        );
        return {
          findings: [],
          next_phase_risk: "required artifact is checked deterministically",
          recommendation: "go",
          score: 1,
        };
      },
      config,
      harnessRepoPath: repo,
      outputMd: "# Output\n",
      paths,
      phase: phase({
        phase_id: "01-required-artifact",
        post_phase_audits: [
          {
            audit_id: "artifact-check",
            context_paths: ["contract.md"],
            required_output_paths: ["missing.md"],
          },
        ],
      }),
      prompt: "do it",
      spawnImpl,
    });

    expect(contextSeen).toBe(true);
    expect(result.audit_blocked).toBe(true);
    expect(result.audits?.[0]).toMatchObject({
      audit_id: "artifact-check",
      blocked: true,
      critical_count: 1,
      judge_used: true,
      recommendation: "revise",
    });
    await expect(
      readFile(
        path.join(paths.auditsDir, "01-required-artifact", "artifact-check.md"),
        "utf8",
      ),
    ).resolves.toContain("Required output is missing or empty: missing.md");
  });

  it("captures a matching raw trajectory into normalized phase artifacts", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-trajectory-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const rawTrajectoryPath = path.join(
      repo,
      "rollout-2026-05-03T10-00-00-codex-session.jsonl",
    );
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
`);
    const { spawnImpl } = createSpawnMock();
    const promptSha256 = createPhasePromptSha256("do it");
    await mkdir(paths.phasesDir, { recursive: true });
    await writeFile(
      rawTrajectoryPath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-05-03T10:00:00.000Z",
          payload: { id: "codex-session" },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-05-03T10:00:01.000Z",
          payload: {
            type: "user_message",
            message: `Harness-Phase-Fingerprint: ${promptSha256}\n\ndo it`,
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-05-03T10:00:02.000Z",
          payload: {
            type: "function_call",
            name: "skill_loader",
            call_id: "call-1",
            arguments: "{}",
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-05-03T10:00:03.000Z",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "loaded",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-05-03T10:00:04.000Z",
          payload: { type: "agent_message", message: "done" },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "# Output\n",
      paths,
      phase: phase({ phase_id: "01-codex", tool: "codex" }),
      prompt: "do it",
      spawnImpl,
      trajectoryPath: rawTrajectoryPath,
    });

    expect(result.trajectory_summary).toMatchObject({
      status: "captured",
      event_count: 7,
      skill_use_count: 1,
      tool_call_count: 1,
      tool_result_count: 1,
    });
    await expect(
      readFile(
        path.join(paths.trajectoryDir, "01-codex", "events.jsonl"),
        "utf8",
      ),
    ).resolves.toContain('"kind":"skill_use"');
    await expect(
      readFile(
        path.join(paths.trajectoryDir, "01-codex", "common-events.jsonl"),
        "utf8",
      ),
    ).resolves.toContain('"kind":"tool_call"');
  });

  it("marks trajectory missing when the raw session lacks the phase fingerprint", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-trajectory-mismatch-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const rawTrajectoryPath = path.join(repo, "rollout-codex-session.jsonl");
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
`);
    const { spawnImpl } = createSpawnMock();
    await writeFile(
      rawTrajectoryPath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-05-03T10:00:00.000Z",
          payload: { id: "codex-session" },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-05-03T10:00:01.000Z",
          payload: {
            type: "user_message",
            message: "Harness-Phase-Fingerprint: wrong\n\ndo it",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "# Output\n",
      paths,
      phase: phase({ phase_id: "01-codex", tool: "codex" }),
      prompt: "do it",
      spawnImpl,
      trajectoryPath: rawTrajectoryPath,
    });

    expect(result.trajectory_summary).toMatchObject({
      status: "missing",
      reason: expect.stringContaining("Harness-Phase-Fingerprint"),
    });
  });

  it("does not include outlier trajectory token usage in totals", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-trajectory-usage-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const rawTrajectoryPath = path.join(repo, "rollout-codex-session.jsonl");
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
`);
    const { spawnImpl } = createSpawnMock();
    const promptSha256 = createPhasePromptSha256("do it");
    await writeFile(
      rawTrajectoryPath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-05-03T10:00:00.000Z",
          payload: { id: "codex-session" },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-05-03T10:00:01.000Z",
          payload: {
            type: "user_message",
            message: `Harness-Phase-Fingerprint: ${promptSha256}\n\ndo it`,
          },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-05-03T10:00:02.000Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 99_999_999,
                output_tokens: 1,
              },
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "# Output\n",
      paths,
      phase: phase({ phase_id: "01-codex", tool: "codex" }),
      prompt: "do it",
      spawnImpl,
      trajectoryPath: rawTrajectoryPath,
    });

    expect(result.trajectory_summary).toMatchObject({
      status: "captured",
      total_tokens: 0,
      usage_reliable: false,
    });
  });

  it("uses fingerprint matching in the phase time window when stdout has no session id", async () => {
    const repo = await mkdtemp(
      path.join(os.tmpdir(), "phase-executor-trajectory-window-"),
    );
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const rawTrajectoryPath = path.join(
      repo,
      ".codex",
      "sessions",
      "2026",
      "05",
      "03",
      "rollout.jsonl",
    );
    const config = parseHarnessConfig(`
name: phase-fixture
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
`);
    const { spawnImpl } = createSpawnMock({ includeSessionId: false });
    const promptSha256 = createPhasePromptSha256("do it");
    await mkdir(path.dirname(rawTrajectoryPath), { recursive: true });
    await writeFile(
      rawTrajectoryPath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-05-03T10:00:00.000Z",
          payload: { id: "time-window-session" },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-05-03T10:00:01.000Z",
          payload: {
            type: "user_message",
            message: `Harness-Phase-Fingerprint: ${promptSha256}\n\ndo it`,
          },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-05-03T10:00:02.000Z",
          payload: { type: "agent_message", message: "done by window" },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await runPhase({
      config,
      harnessRepoPath: repo,
      outputMd: "# Output\n",
      paths,
      phase: phase({ phase_id: "01-window", tool: "codex" }),
      prompt: "do it",
      spawnImpl,
      trajectoryHomeDir: repo,
    });

    expect(result).toMatchObject({
      phase_id: "01-window",
      session_id: "time-window-session",
      trajectory_summary: {
        status: "captured",
        session_id: "time-window-session",
      },
    });
    await expect(
      readFile(path.join(paths.phasesDir, "01-window", "session.json"), "utf8"),
    ).resolves.toContain('"session_id": "time-window-session"');
  });

  it("runs a phase group concurrently and returns all results after sibling drain", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "phase-executor-group-"));
    const paths = getRunStorePaths(
      path.join(repo, ".harness", "runs", "thread-1"),
    );
    const config = parseHarnessConfig(`
name: phase-fixture
projects:
  targets:
    android:
      path: ../transaction_android
    ios:
      path: ../transaction_ios
models:
  codex:
    default:
      model: gpt-5.5
      effort: high
`);
    const { getMaxActive, spawnImpl } = createSpawnMock({ closeDelayMs: 10 });

    const results = await runPhaseGroup({
      config,
      harnessRepoPath: repo,
      outputMdByPhase: {
        "02-android": "# Android\n",
        "03-ios": "# iOS\n",
      },
      paths,
      phases: [
        phase({
          agent: "android-coder",
          cwd_ref: "target:android",
          parallel_group: "platform-coders",
          phase_id: "02-android",
          tool: "codex",
        }),
        phase({
          agent: "ios-coder",
          cwd_ref: "target:ios",
          parallel_group: "platform-coders",
          phase_id: "03-ios",
          tool: "codex",
        }),
      ],
      promptByPhase: {
        "02-android": "android",
        "03-ios": "ios",
      },
      spawnImpl,
    });

    expect(results.map((result) => result.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(getMaxActive()).toBe(2);
    await expect(
      readFile(
        path.join(
          paths.auditsDir,
          "_groups",
          "platform-coders",
          "group-consistency.json",
        ),
        "utf8",
      ),
    ).resolves.toContain('"audit_id": "group-consistency"');
  });
});

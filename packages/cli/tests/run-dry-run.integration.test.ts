import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/index.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout(message: string): void {
        stdout.push(message);
      },
      stderr(message: string): void {
        stderr.push(message);
      },
    },
    stdout,
    stderr,
  };
}

async function createHarnessFixture(): Promise<string> {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "harness-run-dry-run-"),
  );
  const harnessRepoPath = path.join(tempRoot, "sailor-harness");

  await mkdir(
    path.join(harnessRepoPath, "skills", "compound", "compound-fixture"),
    { recursive: true },
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
      name: "dry-run-fixture",
      tools: ["codex", "claude-code"],
      agent_tools: {
        default: "codex",
        agents: {
          architect: "codex",
          "android-coder": "codex",
          "ios-coder": "claude-code",
        },
      },
      projects: {
        targets: {
          android: {
            path: "targets/android",
          },
          ios: {
            path: "targets/ios",
          },
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
      "    tool: codex",
      "    cwd_ref: harness",
      "    profile: architect",
      "    mode: plan",
      "    audit_blocking_policy: threshold",
      "    audit_model: audit-judge",
      "    checkpoint_model: checkpoint-judge",
      "    allowed_write_roots:",
      "      - .",
      "    provider_stall_timeout_seconds: 120",
      "    trajectory_capture: false",
      "    pre_phase_gate_commands:",
      "      - id: env-check",
      "        kind: env",
      "        cwd_ref: harness",
      "        argv:",
      "          - node",
      "          - --version",
      "        timeout_seconds: 30",
      "    post_phase_audits:",
      "      - audit_id: contract-aware",
      "        threshold: 0.8",
      "    gate_commands:",
      "      - id: diff-check",
      "        kind: diff",
      "        cwd_ref: harness",
      "        argv:",
      "          - git",
      "          - diff",
      "          - --check",
      "        timeout_seconds: 30",
      "  - phase_id: android-build",
      "    agent: android-coder",
      "    tool: codex",
      "    cwd_ref: target:android",
      "    parallel_group: implementation",
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

describe("harness run --dry-run", () => {
  it("reports a real harness-shaped phase graph without writing run artifacts", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "run",
        "--dry-run",
        "--compound",
        "compound-fixture",
        "--harness-repo",
        harnessRepoPath,
        "--json",
      ],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const report = JSON.parse(stdout[0] ?? "{}") as {
      readonly dry_run_only: boolean;
      readonly phase_graph: readonly {
        readonly cwd: string;
        readonly cwd_ref: string;
        readonly mode?: string;
        readonly parallel_group?: string;
        readonly phase_id: string;
        readonly pre_phase_gate_command_count: number;
        readonly profile_resolved: boolean;
        readonly provider_stall_timeout_seconds?: number;
      }[];
      readonly required_ignored_paths: readonly {
        readonly ignored: boolean;
        readonly path: string;
      }[];
      readonly run_root: string;
      readonly skill_path: string;
    };

    expect(report.dry_run_only).toBe(true);
    expect(report.skill_path).toBe(
      path.join(
        harnessRepoPath,
        "skills",
        "compound",
        "compound-fixture",
        "SKILL.md",
      ),
    );
    expect(report.run_root).toBe(
      path.join(harnessRepoPath, ".harness", "runs", "dry-run"),
    );
    expect(report.required_ignored_paths).toEqual([
      {
        path: path.join(harnessRepoPath, ".harness"),
        ignored: true,
      },
      {
        path: path.join(harnessRepoPath, ".harness", "runs", "dry-run"),
        ignored: true,
      },
    ]);
    expect(report.phase_graph).toMatchObject([
      {
        phase_id: "design",
        cwd_ref: "harness",
        cwd: harnessRepoPath,
        mode: "plan",
        pre_phase_gate_command_count: 1,
        profile_resolved: true,
        provider_stall_timeout_seconds: 120,
      },
      {
        phase_id: "android-build",
        cwd_ref: "target:android",
        cwd: path.join(harnessRepoPath, "targets", "android"),
        parallel_group: "implementation",
      },
      {
        phase_id: "ios-build",
        cwd_ref: "target:ios",
        cwd: path.join(harnessRepoPath, "targets", "ios"),
        parallel_group: "implementation",
      },
    ]);
    await expect(
      access(path.join(harnessRepoPath, ".harness")),
    ).rejects.toThrow();
  });

  it("fails dry-run when a Codex phase has no resolved model config", async () => {
    const harnessRepoPath = await createHarnessFixture();
    await writeFile(
      path.join(harnessRepoPath, "harness.yaml"),
      YAML.stringify({
        schema_version: 2,
        name: "dry-run-fixture",
        tools: ["codex"],
        projects: { targets: {}, references: {} },
      }),
      "utf8",
    );
    const { io, stderr } = createIo();

    const exitCode = await runCli(
      [
        "run",
        "--dry-run",
        "--compound",
        "compound-fixture",
        "--harness-repo",
        harnessRepoPath,
      ],
      io,
    );

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("must resolve model config");
  });

  it("executes a real run through the execution dependency", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "run",
        "--compound",
        "compound-fixture",
        "--harness-repo",
        harnessRepoPath,
        "--thread-id",
        "thread-1",
        "--prompt",
        "Build it.",
        "--json",
      ],
      io,
      {
        async loadVersion() {
          return "0.1.0";
        },
        async runAdopt() {
          throw new Error("not used");
        },
        async runAutonomousExecution(options) {
          return {
            checkpoint_reports: [],
            completed_phase_count: 3,
            gate_reports: [],
            harness_repo_path: options.harnessRepoPath!,
            phase_reports: [],
            run_id: options.threadId!,
            run_root: path.join(
              options.harnessRepoPath!,
              ".harness",
              "runs",
              options.threadId!,
            ),
            skill_path: path.join(
              options.harnessRepoPath!,
              "skills",
              "compound",
              options.compoundName!,
              "SKILL.md",
            ),
            status: "completed",
            summary_path: path.join(
              options.harnessRepoPath!,
              ".harness",
              "runs",
              options.threadId!,
              "summary.md",
            ),
            thread_id: options.threadId!,
          };
        },
        async runDiff() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
        async runDoctor() {
          return {
            checks: [],
            configPath: "",
            projectName: "fixture",
            summary: { fail: 0, pass: 0 },
            tools: [],
          };
        },
        async runInit() {
          throw new Error("not used");
        },
        async runSync() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      status: "completed",
      thread_id: "thread-1",
    });
  });

  it("passes --task-card through and rejects mixed prompt input", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const taskCardPath = path.join(harnessRepoPath, "task-card.json");
    await writeFile(taskCardPath, "{}", "utf8");
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      [
        "run",
        "--compound",
        "compound-fixture",
        "--harness-repo",
        harnessRepoPath,
        "--thread-id",
        "thread-1",
        "--task-card",
        taskCardPath,
        "--json",
      ],
      io,
      {
        async loadVersion() {
          return "0.1.0";
        },
        async runAdopt() {
          throw new Error("not used");
        },
        async runAutonomousExecution(options) {
          expect(options.taskCardPath).toBe(taskCardPath);
          return {
            checkpoint_reports: [],
            completed_phase_count: 1,
            gate_reports: [],
            harness_repo_path: options.harnessRepoPath!,
            phase_reports: [],
            run_id: "run-1",
            run_root: path.join(
              options.harnessRepoPath!,
              ".harness",
              "runs",
              options.threadId!,
            ),
            skill_path: "skill",
            status: "completed",
            summary_path: "summary",
            task_card_hash: "abc",
            thread_id: options.threadId!,
          };
        },
        async runDiff() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
        async runDoctor() {
          return {
            checks: [],
            configPath: "",
            projectName: "fixture",
            summary: { fail: 0, pass: 0 },
            tools: [],
          };
        },
        async runInit() {
          throw new Error("not used");
        },
        async runSync() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      task_card_hash: "abc",
    });

    const badIo = createIo();
    const badExitCode = await runCli(
      [
        "run",
        "--compound",
        "compound-fixture",
        "--harness-repo",
        harnessRepoPath,
        "--thread-id",
        "thread-1",
        "--task-card",
        taskCardPath,
        "--prompt",
        "do it",
      ],
      badIo.io,
    );

    expect(badExitCode).toBe(1);
    expect(badIo.stderr.join("\n")).toContain("Use --task-card");
  });

  it("passes --resume through to real run execution", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      [
        "run",
        "--resume",
        "thread-1",
        "--harness-repo",
        harnessRepoPath,
        "--json",
      ],
      io,
      {
        async loadVersion() {
          return "0.1.0";
        },
        async runAdopt() {
          throw new Error("not used");
        },
        async runAutonomousExecution(options) {
          expect(options.resume).toBe(true);
          expect(options.threadId).toBe("thread-1");
          return {
            checkpoint_reports: [],
            completed_phase_count: 1,
            gate_reports: [],
            harness_repo_path: options.harnessRepoPath!,
            phase_reports: [],
            run_id: "run-1",
            run_root: path.join(
              options.harnessRepoPath!,
              ".harness",
              "runs",
              options.threadId!,
            ),
            skill_path: path.join(
              options.harnessRepoPath!,
              "skills",
              "compound",
              "compound-fixture",
              "SKILL.md",
            ),
            status: "completed",
            summary_path: path.join(
              options.harnessRepoPath!,
              ".harness",
              "runs",
              options.threadId!,
              "summary.md",
            ),
            thread_id: options.threadId!,
          };
        },
        async runDiff() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
        async runDoctor() {
          return {
            checks: [],
            configPath: "",
            projectName: "fixture",
            summary: { fail: 0, pass: 0 },
            tools: [],
          };
        },
        async runInit() {
          throw new Error("not used");
        },
        async runSync() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      status: "completed",
      thread_id: "thread-1",
    });
  });

  it("passes provider judge options through to real run execution", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      [
        "run",
        "--compound",
        "compound-fixture",
        "--harness-repo",
        harnessRepoPath,
        "--thread-id",
        "thread-1",
        "--prompt",
        "Build it.",
        "--judge-tool",
        "codex",
        "--judge-profile",
        "checkpoint-judge",
        "--judge-timeout-seconds",
        "7",
        "--json",
      ],
      io,
      {
        async loadVersion() {
          return "0.1.0";
        },
        async runAdopt() {
          throw new Error("not used");
        },
        async runAutonomousExecution(options) {
          expect(options.judgeTool).toBe("codex");
          expect(options.judgeProfile).toBe("checkpoint-judge");
          expect(options.judgeTimeoutSeconds).toBe(7);
          return {
            checkpoint_reports: [],
            completed_phase_count: 1,
            gate_reports: [],
            harness_repo_path: options.harnessRepoPath!,
            phase_reports: [],
            run_id: "run-1",
            run_root: path.join(
              options.harnessRepoPath!,
              ".harness",
              "runs",
              options.threadId!,
            ),
            skill_path: path.join(
              options.harnessRepoPath!,
              "skills",
              "compound",
              options.compoundName!,
              "SKILL.md",
            ),
            status: "completed",
            summary_path: path.join(
              options.harnessRepoPath!,
              ".harness",
              "runs",
              options.threadId!,
              "summary.md",
            ),
            thread_id: options.threadId!,
          };
        },
        async runDiff() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
        async runDoctor() {
          return {
            checks: [],
            configPath: "",
            projectName: "fixture",
            summary: { fail: 0, pass: 0 },
            tools: [],
          };
        },
        async runInit() {
          throw new Error("not used");
        },
        async runSync() {
          return { added: [], modified: [], removed: [], unchanged: [] };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      status: "completed",
      thread_id: "thread-1",
    });
  });

  it("inspects and visualizes captured run artifacts", async () => {
    const harnessRepoPath = await createHarnessFixture();
    const runRoot = path.join(harnessRepoPath, ".harness", "runs", "thread-1");
    await mkdir(path.join(runRoot, "phases", "01-design"), { recursive: true });
    await mkdir(path.join(runRoot, "audits", "01-design"), { recursive: true });
    await mkdir(path.join(runRoot, "trajectory", "01-design"), {
      recursive: true,
    });
    await writeFile(
      path.join(runRoot, "phases", "01-design", "session.json"),
      JSON.stringify({
        phase_id: "01-design",
        status: "completed",
        agent: "architect",
        tool: "codex",
      }),
      "utf8",
    );
    await writeFile(
      path.join(runRoot, "phases", "01-design", "exit_code.json"),
      JSON.stringify({ status: "completed" }),
      "utf8",
    );
    await writeFile(
      path.join(runRoot, "audits", "01-design", "default.json"),
      JSON.stringify({
        audit_id: "default",
        blocked: false,
        critical_count: 0,
        recommendation: "go",
        score: 1,
      }),
      "utf8",
    );
    await writeFile(
      path.join(runRoot, "trajectory", "01-design", "summary.json"),
      JSON.stringify({
        status: "captured",
        event_count: 1,
        tool_call_count: 0,
        total_tokens: 0,
      }),
      "utf8",
    );

    const inspectIo = createIo();
    const inspectExit = await runCli(
      ["run", "inspect", "thread-1", "--harness-repo", harnessRepoPath],
      inspectIo.io,
    );
    expect(inspectExit).toBe(0);
    expect(inspectIo.stdout.join("\n")).toContain("01-design status=completed");

    const viewIo = createIo();
    const viewExit = await runCli(
      ["run", "view", "thread-1", "--harness-repo", harnessRepoPath, "--json"],
      viewIo.io,
    );
    expect(viewExit).toBe(0);
    const result = JSON.parse(viewIo.stdout[0] ?? "{}") as {
      readonly html_path: string;
      readonly mermaid_path: string;
    };
    await expect(readFile(result.html_path, "utf8")).resolves.toContain(
      "Harness Run Report",
    );
    await expect(readFile(result.mermaid_path, "utf8")).resolves.toContain(
      "flowchart TD",
    );
  });
});

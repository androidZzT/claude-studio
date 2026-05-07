import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/index.js";

const execFileAsync = promisify(execFile);

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
      }
    },
    stdout,
    stderr
  };
}

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);

  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

async function createWorkspace(tempRoot: string, name = "demo"): Promise<string> {
  const workspaceDir = path.join(tempRoot, name);

  await withCwd(tempRoot, async () => {
    const initIo = createIo();
    expect(await runCli(["init", name], initIo.io)).toBe(0);
  });

  return workspaceDir;
}

async function writeCodexTrajectory(workspaceDir: string): Promise<string> {
  const jsonlPath = path.join(workspaceDir, "rollout-2026-04-24T16-29-13-019dbe9b-78a9-7e70-9004-6a0f4897d09e.jsonl");
  await writeFile(
    jsonlPath,
    [
      JSON.stringify({
        timestamp: "2026-04-24T08:29:13.019Z",
        type: "session_meta",
        payload: {
          id: "019dbe9b-78a9-7e70-9004-6a0f4897d09e",
          cwd: "/workspace",
          model_provider: "openai"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:14.000Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
          model_context_window: 272000
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:15.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: "/workspace",
          model: "gpt-5.4"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:16.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello codex" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:17.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "hello" },
            { type: "output_text", text: "again" }
          ]
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:18.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "step one" }],
          encrypted_content: "enc-sig"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:19.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "exec_command",
          arguments: "{\"cmd\":\"pwd\"}"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:20.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "/workspace"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:21.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 10,
              output_tokens: 5,
              cached_input_tokens: 100
            }
          }
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:22.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "agent summary"
        }
      }),
      JSON.stringify({
        timestamp: "2026-04-24T08:29:23.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          aggregated_output: "done",
          exit_code: 0
        }
      })
    ].join("\n"),
    "utf8"
  );

  return jsonlPath;
}

async function createArtifactRepo(tempRoot: string): Promise<{
  readonly bugsPath: string;
  readonly eventsPath: string;
  readonly lintPath: string;
  readonly repoPath: string;
  readonly smokePath: string;
}> {
  const repoPath = path.join(tempRoot, "artifact-repo");
  const eventsPath = path.join(tempRoot, "events.jsonl");
  const bugsPath = path.join(tempRoot, "bugs.md");
  const lintPath = path.join(tempRoot, "lint.json");
  const smokePath = path.join(tempRoot, "smoke.json");

  await mkdir(path.join(repoPath, ".claude", "rules"), { recursive: true });
  await mkdir(path.join(repoPath, "architecture", "adr"), { recursive: true });
  await mkdir(path.join(repoPath, "src"), { recursive: true });

  await writeFile(path.join(repoPath, ".claude", "rules", "ui.md"), "rule one\n", "utf8");
  await writeFile(path.join(repoPath, ".claude", "rules", "arch.md"), "rule two\n", "utf8");
  await writeFile(path.join(repoPath, "architecture", "adr", "001.md"), "adr one\n", "utf8");
  await writeFile(path.join(repoPath, "src", "app.ts"), "line1\nline2\nline3\nline4\n", "utf8");
  await writeFile(path.join(repoPath, "README.md"), "hello\nworld\n", "utf8");

  await execFileAsync("git", ["init", "-q"], { cwd: repoPath });
  await execFileAsync("git", ["add", "-A"], { cwd: repoPath });

  await writeFile(
    eventsPath,
    [
      JSON.stringify({
        ts: "2026-04-20T19:05:21+0800",
        event: "review_end",
        review_round: 1,
        loc_added: 50,
        adoption_rate: 0.9
      }),
      JSON.stringify({
        ts: "2026-04-21T19:05:21+0800",
        event: "review_end",
        review_round: 2,
        loc_added: 100,
        adoption_rate: 0.8
      })
    ].join("\n"),
    "utf8"
  );
  await writeFile(bugsPath, "# Bug one\n## Bug two\n", "utf8");
  await writeFile(lintPath, JSON.stringify({ violations: 1 }, null, 2), "utf8");
  await writeFile(smokePath, JSON.stringify({ passed: 9, total: 10 }, null, 2), "utf8");

  return {
    repoPath,
    eventsPath,
    bugsPath,
    lintPath,
    smokePath
  };
}

describe.sequential("eval funnel integration", () => {
  it("computes all 12 metrics when trajectory and external artifacts are present", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-funnel-full-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const trajectoryPath = await writeCodexTrajectory(workspaceDir);
    const artifacts = await createArtifactRepo(tempRoot);

    await withCwd(workspaceDir, async () => {
      const funnelIo = createIo();
      expect(
        await runCli(
          [
            "eval",
            "funnel",
            "--trajectory",
            trajectoryPath,
            "--events",
            artifacts.eventsPath,
            "--bugs",
            artifacts.bugsPath,
            "--repo",
            artifacts.repoPath,
            "--lint",
            artifacts.lintPath,
            "--smoke",
            artifacts.smokePath,
            "--format",
            "json"
          ],
          funnelIo.io
        )
      ).toBe(0);

      const parsed = JSON.parse(funnelIo.stdout[0] ?? "{}") as Record<string, unknown>;
      expect(parsed).toMatchObject({
        schema_version: 1,
        quality: {
          review_pass_efficiency: 0.5,
          first_pass_rate: 0.5,
          smoke_pass_rate: 0.9,
          adoption_rate: 0.8
        },
        performance: {
          n_turns: expect.any(Number),
          n_toolcalls: expect.any(Number),
          n_total_tokens: expect.any(Number),
          time_to_first_token: expect.any(Number),
          output_tokens_per_sec: expect.any(Number),
          time_to_last_token: expect.any(Number)
        }
      });
      expect((parsed.quality as Record<string, unknown>).tech_design_conformance).not.toBeNull();
      expect((parsed.quality as Record<string, unknown>).bug_density).not.toBeNull();
    });
  });

  it("fills only performance metrics when no quality artifacts are provided", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-funnel-trajectory-only-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const trajectoryPath = await writeCodexTrajectory(workspaceDir);

    await withCwd(workspaceDir, async () => {
      const funnelIo = createIo();
      expect(await runCli(["eval", "funnel", "--trajectory", trajectoryPath, "--format", "json"], funnelIo.io)).toBe(0);

      const parsed = JSON.parse(funnelIo.stdout[0] ?? "{}") as Record<string, unknown>;
      expect(parsed).toMatchObject({
        quality: {
          tech_design_conformance: null,
          adoption_rate: null,
          review_pass_efficiency: null,
          first_pass_rate: null,
          smoke_pass_rate: null,
          bug_density: null
        }
      });
      expect((parsed.performance as Record<string, unknown>).n_turns).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders a human-readable table with em dashes for missing metrics", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-funnel-table-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const trajectoryPath = await writeCodexTrajectory(workspaceDir);

    await withCwd(workspaceDir, async () => {
      const funnelIo = createIo();
      expect(await runCli(["eval", "funnel", "--trajectory", trajectoryPath], funnelIo.io)).toBe(0);

      expect(funnelIo.stdout[0]).toContain("Funnel Score");
      expect(funnelIo.stdout).toContain("Quality");
      expect(funnelIo.stdout.join("\n")).toContain("—");
    });
  });
});

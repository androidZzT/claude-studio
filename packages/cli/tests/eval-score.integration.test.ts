import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { validateEvalLog } from "@harness/core";

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
          content: [{ type: "output_text", text: "hello" }]
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
      })
    ].join("\n"),
    "utf8"
  );

  return jsonlPath;
}

async function createArtifactRepo(tempRoot: string): Promise<{
  readonly eventsPath: string;
  readonly repoPath: string;
}> {
  const repoPath = path.join(tempRoot, "artifact-repo");
  const eventsPath = path.join(tempRoot, "events.jsonl");

  await mkdir(path.join(repoPath, ".claude", "rules"), { recursive: true });
  await mkdir(path.join(repoPath, "architecture", "adr"), { recursive: true });
  await writeFile(path.join(repoPath, ".claude", "rules", "ui.md"), "rule\n", "utf8");
  await writeFile(path.join(repoPath, "architecture", "adr", "001.md"), "adr\n", "utf8");
  await execFileAsync("git", ["init", "-q"], { cwd: repoPath });
  await execFileAsync("git", ["add", "-A"], { cwd: repoPath });

  await writeFile(
    eventsPath,
    JSON.stringify({
      ts: "2026-04-21T19:05:21+0800",
      event: "review_end",
      review_round: 1,
      loc_added: 50,
      adoption_rate: 0.9
    }),
    "utf8"
  );

  return {
    repoPath,
    eventsPath
  };
}

describe.sequential("eval score integration", () => {
  it("recomputes scores for an existing EvalLog run", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-score-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const trajectoryPath = await writeCodexTrajectory(workspaceDir);
    const artifacts = await createArtifactRepo(tempRoot);

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(await runCli(["eval", "ingest", trajectoryPath, "--scenario", "score-test", "--source", "codex", "--json"], ingestIo.io)).toBe(0);

      const ingestResult = JSON.parse(ingestIo.stdout[0] ?? "{}") as { readonly outPath: string };
      const initialEvalLog = JSON.parse(await readFile(ingestResult.outPath, "utf8")) as Record<string, unknown>;
      expect(validateEvalLog(initialEvalLog)).toBe(true);
      expect(((initialEvalLog.results as Record<string, unknown>).scores as unknown[])[0]).toMatchObject({
        metadata: {
          quality: {
            review_pass_efficiency: null
          }
        }
      });

      const runId = ((initialEvalLog.eval as Record<string, unknown>).run_id as string | undefined) ?? "";
      const scoreIo = createIo();
      expect(
        await runCli(["eval", "score", runId, "--events", artifacts.eventsPath, "--repo", artifacts.repoPath, "--json"], scoreIo.io)
      ).toBe(0);

      const scored = JSON.parse(scoreIo.stdout[0] ?? "{}") as Record<string, unknown>;
      expect((scored.score as Record<string, unknown>).schema_version).toBe(1);

      const updatedEvalLog = JSON.parse(await readFile(ingestResult.outPath, "utf8")) as Record<string, unknown>;
      expect((((updatedEvalLog.results as Record<string, unknown>).scores as Record<string, unknown>[])[0]?.metadata as Record<string, unknown>).quality).toMatchObject({
        review_pass_efficiency: 1,
        first_pass_rate: 1,
        adoption_rate: 0.9
      });
    });
  });
});

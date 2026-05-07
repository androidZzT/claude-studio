import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateEvalLog } from "@harness/core";

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

async function writeCodexFixture(workspaceDir: string, filename: string, withSessionMeta = true): Promise<string> {
  const jsonlPath = path.join(workspaceDir, filename);
  const lines = [
    ...(withSessionMeta
      ? [
          JSON.stringify({
            timestamp: "2026-04-24T08:29:13.019Z",
            type: "session_meta",
            payload: {
              id: "019dbe9b-78a9-7e70-9004-6a0f4897d09e",
              cwd: "/workspace",
              model_provider: "openai"
            }
          })
        ]
      : []),
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
  ];

  await writeFile(jsonlPath, lines.join("\n"), "utf8");
  return jsonlPath;
}

describe.sequential("Codex eval ingest integration", () => {
  it("ingests a synthetic Codex rollout into an EvalLog", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-codex-ingest-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeCodexFixture(
      workspaceDir,
      "rollout-2026-04-24T16-29-13-019dbe9b-78a9-7e70-9004-6a0f4897d09e.jsonl"
    );

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(await runCli(["eval", "ingest", jsonlPath, "--scenario", "test-codex", "--source", "codex", "--json"], ingestIo.io)).toBe(0);

      const result = JSON.parse(ingestIo.stdout[0] ?? "{}") as { readonly outPath: string; readonly eventCount: number };
      expect(result.eventCount).toBeGreaterThanOrEqual(10);

      const evalLog = JSON.parse(await readFile(result.outPath, "utf8")) as Record<string, unknown>;
      expect(validateEvalLog(evalLog)).toBe(true);
      expect(evalLog).toMatchObject({
        eval: {
          metadata: {
            source: "codex",
            session_id: "019dbe9b-78a9-7e70-9004-6a0f4897d09e"
          }
        }
      });

      const sampleEvents = ((evalLog.samples as Record<string, unknown>[])[0]?.events ?? []) as Record<string, unknown>[];
      expect(sampleEvents.length).toBeGreaterThanOrEqual(10);
      expect(sampleEvents.some((event) => event.event === "tool" && event.function === "exec_command" && "arguments" in event)).toBe(true);
      expect(sampleEvents.some((event) => event.event === "tool" && event.function === "exec_command" && "result" in event)).toBe(true);
      expect(
        sampleEvents.some(
          (event) =>
            event.event === "model" &&
            typeof event.thinking === "object" &&
            event.thinking !== null &&
            (event.thinking as Record<string, unknown>).signature === "enc-sig"
        )
      ).toBe(true);

      const listIo = createIo();
      expect(await runCli(["eval", "list", "--scenario", "test-codex", "--json"], listIo.io)).toBe(0);
      expect(JSON.parse(listIo.stdout[0] ?? "[]")).toEqual([
        expect.objectContaining({
          scenario_id: "test-codex",
          source: "codex",
          event_count: expect.any(Number)
        })
      ]);
    });
  });

  it("accepts an explicit --session-id override for filenames outside the rollout convention", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-codex-session-override-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeCodexFixture(workspaceDir, "bad-name.jsonl");

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(
        await runCli(
          ["eval", "ingest", jsonlPath, "--scenario", "manual", "--source", "codex", "--session-id", "manual-uuid", "--json"],
          ingestIo.io
        )
      ).toBe(0);

      const result = JSON.parse(ingestIo.stdout[0] ?? "{}") as { readonly outPath: string };
      const evalLog = JSON.parse(await readFile(result.outPath, "utf8")) as Record<string, unknown>;
      expect(evalLog).toMatchObject({
        eval: {
          metadata: {
            session_id: "manual-uuid"
          }
        }
      });
    });
  });

  it("fails when neither the filename nor the first line can provide a Codex session id", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-codex-missing-session-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeCodexFixture(workspaceDir, "bad-name.jsonl", false);

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(await runCli(["eval", "ingest", jsonlPath, "--scenario", "fail", "--source", "codex"], ingestIo.io)).toBe(1);
      expect(ingestIo.stdout).toEqual([]);
      expect(ingestIo.stderr.join("\n")).toContain("rollout-<timestamp>-<uuid>.jsonl");
      expect(ingestIo.stderr.join("\n")).toContain("--session-id");
    });
  });
});

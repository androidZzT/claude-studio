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

async function writeClaudeCodeFixture(workspaceDir: string, filename: string): Promise<string> {
  const jsonlPath = path.join(workspaceDir, filename);
  await writeFile(
    jsonlPath,
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-04-27T10:00:00Z",
        cwd: "/x",
        message: { role: "user", content: "hi" }
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-04-27T10:00:01Z",
        cwd: "/x",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "thinking", thinking: "reasoning here", signature: "sig123" },
            { type: "text", text: "hello" },
            { type: "tool_use", id: "t1", name: "Read", input: { path: "/foo" } }
          ],
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }
        }
      }),
      JSON.stringify({
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        timestamp: "2026-04-27T10:00:02Z",
        cwd: "/x",
        toolUseResult: { toolName: "Read", content: "file contents" }
      }),
      JSON.stringify({
        type: "progress",
        uuid: "p1",
        timestamp: "2026-04-27T10:00:03Z",
        cwd: "/x",
        data: { hookEvent: "PostToolUse" }
      }),
      JSON.stringify({
        type: "attachment",
        uuid: "att1",
        timestamp: "2026-04-27T10:00:04Z",
        cwd: "/x",
        attachment: { name: "file.txt" }
      }),
      JSON.stringify({
        type: "system",
        uuid: "s1",
        timestamp: "2026-04-27T10:00:05Z",
        cwd: "/x",
        content: "system info"
      })
    ].join("\n"),
    "utf8"
  );

  return jsonlPath;
}

describe.sequential("Claude Code eval ingest integration", () => {
  it("ingests a synthetic Claude Code session into an EvalLog", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-cc-ingest-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeClaudeCodeFixture(workspaceDir, "12345678-1234-1234-1234-123456789abc.jsonl");

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(await runCli(["eval", "ingest", jsonlPath, "--scenario", "cc-test", "--source", "claude-code", "--json"], ingestIo.io)).toBe(0);

      const result = JSON.parse(ingestIo.stdout[0] ?? "{}") as { readonly outPath: string; readonly eventCount: number };
      expect(result.eventCount).toBeGreaterThanOrEqual(8);

      const evalLog = JSON.parse(await readFile(result.outPath, "utf8")) as Record<string, unknown>;
      expect(validateEvalLog(evalLog)).toBe(true);
      expect(evalLog).toMatchObject({
        eval: {
          metadata: {
            source: "claude-code",
            session_id: "12345678-1234-1234-1234-123456789abc"
          }
        }
      });

      const sampleEvents = ((evalLog.samples as Record<string, unknown>[])[0]?.events ?? []) as Record<string, unknown>[];
      expect(sampleEvents.length).toBeGreaterThanOrEqual(8);
      expect(sampleEvents.filter((event) => event.event === "tool" && "arguments" in event)).toHaveLength(1);
      expect(sampleEvents.filter((event) => event.event === "tool" && "result" in event)).toHaveLength(1);
      expect(sampleEvents.some((event) => event.event === "model" && "thinking" in event)).toBe(true);
      expect(
        sampleEvents.some(
          (event) =>
            event.event === "model" &&
            typeof event.thinking === "object" &&
            event.thinking !== null &&
            (event.thinking as Record<string, unknown>).signature === "sig123"
        )
      ).toBe(true);
    });
  });

  it("fails when a Claude Code filename is not uuid-shaped and no session override is provided", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-cc-invalid-name-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeClaudeCodeFixture(workspaceDir, "bad-name.jsonl");

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(await runCli(["eval", "ingest", jsonlPath, "--scenario", "cc-test", "--source", "claude-code"], ingestIo.io)).toBe(1);
      expect(ingestIo.stderr.join("\n")).toContain("filename must match <uuid>.jsonl");
      expect(ingestIo.stderr.join("\n")).toContain("--session-id");
    });
  });

  it("accepts an explicit --session-id override for non-uuid filenames", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-eval-cc-session-override-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const jsonlPath = await writeClaudeCodeFixture(workspaceDir, "bad-name.jsonl");

    await withCwd(workspaceDir, async () => {
      const ingestIo = createIo();
      expect(
        await runCli(
          ["eval", "ingest", jsonlPath, "--scenario", "ok", "--source", "claude-code", "--session-id", "manual-id", "--json"],
          ingestIo.io
        )
      ).toBe(0);

      const result = JSON.parse(ingestIo.stdout[0] ?? "{}") as { readonly outPath: string };
      const evalLog = JSON.parse(await readFile(result.outPath, "utf8")) as Record<string, unknown>;
      expect(evalLog).toMatchObject({
        eval: {
          metadata: {
            session_id: "manual-id"
          }
        }
      });
    });
  });
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  createProviderCheckpointJudge,
  createProviderPhaseAuditJudge,
  extractJsonObject,
} from "../../src/index.js";
import type { ProviderJudgeSpawn } from "../../src/index.js";

function createSpawnMock(
  stdoutText: string,
  exitCode = 0,
): {
  readonly calls: readonly {
    readonly args: string[];
    readonly file: string;
  }[];
  readonly spawnImpl: ProviderJudgeSpawn;
} {
  const calls: { args: string[]; file: string }[] = [];
  const spawnImpl: ProviderJudgeSpawn = (file, args) => {
    calls.push({ file, args });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as ChildProcess;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;

    queueMicrotask(() => {
      stdout.end(stdoutText);
      stderr.end(exitCode === 0 ? "" : "provider failed");
      child.emit("close", exitCode, null);
    });

    return child;
  };

  return { calls, spawnImpl };
}

describe("provider judges", () => {
  it("extracts the first balanced JSON object from provider text", () => {
    expect(extractJsonObject('prefix {"a":"{x}","b":1} suffix')).toBe(
      '{"a":"{x}","b":1}',
    );
  });

  it("runs a Codex checkpoint judge without full-auto", async () => {
    const { calls, spawnImpl } = createSpawnMock(
      JSON.stringify({
        decision: "go",
        confidence: 0.9,
        reasoning: "ok",
        semantic_findings: [],
      }),
    );
    const judge = createProviderCheckpointJudge({
      cwd: "/tmp",
      profile: "judge",
      spawnImpl,
      tool: "codex",
    });

    const result = await judge({
      checkpoint_id: "checkpoint-1",
      model: "haiku-4.5",
      prompt: "judge this",
    });

    expect(JSON.parse(result.text)).toMatchObject({ decision: "go" });
    expect(calls[0]).toMatchObject({
      file: "codex",
      args: [
        "exec",
        "--profile",
        "judge",
        expect.stringContaining("judge this"),
      ],
    });
    expect(calls[0]?.args).not.toContain("--full-auto");
  });

  it("turns provider checkpoint failures into escalation JSON", async () => {
    const { spawnImpl } = createSpawnMock("", 1);
    const judge = createProviderCheckpointJudge({
      cwd: "/tmp",
      spawnImpl,
      tool: "claude-code",
    });

    const result = await judge({
      checkpoint_id: "checkpoint-1",
      model: "haiku-4.5",
      prompt: "judge this",
    });

    expect(JSON.parse(result.text)).toMatchObject({
      decision: "escalate",
      confidence: 0,
    });
  });

  it("parses provider phase audit JSON", async () => {
    const { spawnImpl } = createSpawnMock(
      [
        "```json",
        JSON.stringify({
          score: 0.82,
          findings: [{ severity: "warning", message: "minor risk" }],
          recommendation: "go",
          next_phase_risk: "low",
        }),
        "```",
      ].join("\n"),
    );
    const judge = createProviderPhaseAuditJudge({
      cwd: "/tmp",
      spawnImpl,
      tool: "claude-code",
    });

    const result = await judge({
      audit_id: "default",
      deterministic_findings: [],
      model: "sonnet-4.6",
      output_md: "# Output",
      phase: {
        agent: "architect",
        cwd_ref: "harness",
        phase_id: "design",
        tool: "claude-code",
      },
      phase_result: {
        cwd: "/tmp",
        duration_ms: 1,
        exit_code: 0,
        output_path: "/tmp/output.md",
        phase_id: "design",
        signal: null,
        status: "completed",
      },
      prompt: "do design",
    });

    expect(result).toMatchObject({
      score: 0.82,
      recommendation: "go",
    });
  });
});

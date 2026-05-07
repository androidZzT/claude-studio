import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateEvalLog, writeEvalLog } from "../../src/index.js";
import type { CommonEvent, EvalLogMeta } from "../../src/index.js";

const baseMeta: EvalLogMeta = {
  runId: "run_2026-04-27_test",
  scenarioId: "demo",
  sessionId: "session-1",
  source: "stub",
  created: "2026-04-27T10:00:00Z"
};

async function createOutPath(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(directory, "run.eval");
}

async function readEvalLog(outPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(outPath, "utf8")) as Record<string, unknown>;
}

describe("EvalLog writer", () => {
  it("writes a valid EvalLog even when no events exist", async () => {
    const outPath = await createOutPath("eval-log-empty-");

    await writeEvalLog([], baseMeta, outPath);

    const parsed = await readEvalLog(outPath);

    expect(validateEvalLog(parsed)).toBe(true);
    expect(parsed).toMatchObject({
      version: 2,
      status: "success",
      eval: {
        task: "harness-trajectory",
        run_id: "run_2026-04-27_test",
        metadata: {
          source: "stub",
          scenario_id: "demo",
          session_id: "session-1"
        }
      },
      samples: [
        {
          id: "sample-0",
          events: []
        }
      ]
    });
  });

  it("maps model events into Inspect AI model events", async () => {
    const outPath = await createOutPath("eval-log-model-");
    const events: CommonEvent[] = [
      {
        source: "stub",
        session_id: "session-1",
        event_id: "event-1",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai"
        },
        text: "hi",
        raw: {
          role: "assistant"
        }
      }
    ];

    await writeEvalLog(events, baseMeta, outPath);

    const parsed = await readEvalLog(outPath);
    const sampleEvents = ((parsed.samples as Record<string, unknown>[])[0]?.events ?? []) as Record<string, unknown>[];

    expect(sampleEvents[0]).toMatchObject({
      event: "model",
      model: "gpt-5.4",
      provider: "openai",
      content: "hi"
    });
  });

  it("maps tool calls and tool results into separate tool events", async () => {
    const outPath = await createOutPath("eval-log-tool-");
    const events: CommonEvent[] = [
      {
        source: "stub",
        session_id: "session-1",
        event_id: "tool-call",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "tool_call",
        tool: {
          name: "read_file",
          input: {
            path: "README.md"
          }
        },
        raw: {}
      },
      {
        source: "stub",
        session_id: "session-1",
        event_id: "tool-result",
        timestamp: "2026-04-27T10:00:01Z",
        kind: "tool_result",
        tool: {
          name: "read_file",
          output: "hello"
        },
        raw: {}
      }
    ];

    await writeEvalLog(events, baseMeta, outPath);

    const parsed = await readEvalLog(outPath);
    const sampleEvents = ((parsed.samples as Record<string, unknown>[])[0]?.events ?? []) as Record<string, unknown>[];

    expect(sampleEvents).toMatchObject([
      {
        event: "tool",
        function: "read_file",
        arguments: {
          path: "README.md"
        }
      },
      {
        event: "tool",
        function: "read_file",
        result: "hello"
      }
    ]);
  });

  it("moves session_meta events into top-level metadata instead of sample events", async () => {
    const outPath = await createOutPath("eval-log-session-meta-");
    const events: CommonEvent[] = [
      {
        source: "stub",
        session_id: "session-1",
        event_id: "meta-1",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "session_meta",
        raw: {
          cwd: "/tmp/demo"
        }
      }
    ];

    await writeEvalLog(events, baseMeta, outPath);

    const parsed = await readEvalLog(outPath);

    expect(((parsed.samples as Record<string, unknown>[])[0]?.events ?? [])).toEqual([]);
    expect((parsed.eval as Record<string, unknown>).metadata).toMatchObject({
      session_meta: [
        {
          cwd: "/tmp/demo"
        }
      ]
    });
  });

  it("rejects malformed model events even though the schema is permissive", async () => {
    const outPath = await createOutPath("eval-log-invalid-model-");
    const events: CommonEvent[] = [
      {
        source: "stub",
        session_id: "session-1",
        event_id: "bad-model",
        timestamp: "2026-04-27T10:00:00Z",
        kind: "model",
        raw: {}
      }
    ];

    await expect(writeEvalLog(events, baseMeta, outPath)).rejects.toMatchObject({
      code: "EVAL_INVALID_MODEL_EVENT"
    });
  });
});

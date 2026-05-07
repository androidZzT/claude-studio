import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CodexParser, commonEventSchema, inferCodexSessionId } from "../../src/index.js";

function createContext(sequence: number, state?: Record<string, unknown>) {
  return {
    session_id: "session-1",
    sequence,
    ...(state ? { state } : {})
  };
}

describe("Codex rollout trajectory parser", () => {
  it("maps session_meta into a session_meta CommonEvent and records cwd", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = {};
    const event = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:13.019Z",
        type: "session_meta",
        payload: {
          id: "019dbe9b-78a9-7e70-9004-6a0f4897d09e",
          cwd: "/workspace",
          model_provider: "openai"
        }
      }),
      createContext(1, state)
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "session_meta",
        event_id: "019dbe9b-78a9-7e70-9004-6a0f4897d09e",
        cwd: "/workspace",
        model: {
          id: "unknown",
          provider: "openai"
        }
      })
    );
  });

  it("maps turn_context into session_meta and sets turn_id", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = {};
    const event = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:14.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: "/workspace",
          model: "gpt-5.4"
        }
      }),
      createContext(2, state)
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "session_meta",
        event_id: "turn-1",
        turn_id: "turn-1",
        cwd: "/workspace"
      })
    );
  });

  it("maps response_item.message for user, developer, and assistant roles", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = {};
    parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:14.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          model: "gpt-5.4"
        }
      }),
      createContext(1, state)
    );

    const userEvent = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:15.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }]
        }
      }),
      createContext(2, state)
    );
    const developerEvent = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:16.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "system guardrails" }]
        }
      }),
      createContext(3, state)
    );
    const assistantEvent = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:17.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello back" }]
        }
      }),
      createContext(4, state)
    );

    expect(userEvent).toEqual([expect.objectContaining({ kind: "user_input", text: "hello" })]);
    expect(developerEvent).toEqual([expect.objectContaining({ kind: "lifecycle", text: "system guardrails" })]);
    expect(assistantEvent).toEqual([
      expect.objectContaining({
        kind: "model",
        text: "hello back",
        model: {
          id: "gpt-5.4",
          provider: "openai"
        }
      })
    ]);
  });

  it("expands multi-part assistant messages in order", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = {};
    parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:14.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          model: "gpt-5.4"
        }
      }),
      createContext(1, state)
    );

    const event = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:17.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "first" },
            { type: "output_text", text: "second" }
          ]
        }
      }),
      createContext(2, state)
    );

    expect(event).toEqual([
      expect.objectContaining({ kind: "model", text: "first", event_id: "codex-2-1" }),
      expect.objectContaining({ kind: "model", text: "second", event_id: "codex-2-2" })
    ]);
  });

  it("maps reasoning into a model event while preserving encrypted_content as signature", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = { lastModel: "gpt-5.4" };
    const event = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:18.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "reason one" }, { text: "reason two" }],
          encrypted_content: "encrypted-signature"
        }
      }),
      createContext(3, state)
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "model",
        thinking: {
          content: "reason one\nreason two",
          signature: "encrypted-signature"
        }
      })
    );
  });

  it("parses function_call arguments as JSON and tolerates malformed JSON", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = {};
    const valid = parser.parseLine(
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
      createContext(4, state)
    );
    const invalid = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:20.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-2",
          name: "exec_command",
          arguments: "{not json"
        }
      }),
      createContext(5, state)
    );

    expect(valid).toEqual(
      expect.objectContaining({
        kind: "tool_call",
        tool: {
          name: "exec_command",
          input: {
            cmd: "pwd"
          }
        }
      })
    );
    expect(invalid).toEqual(
      expect.objectContaining({
        kind: "tool_call",
        tool: {
          name: "exec_command",
          input: {
            _raw: "{not json",
            _parse_error: expect.any(String)
          }
        }
      })
    );
  });

  it("uses cached tool names for function_call_output and falls back to unknown", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = {};
    parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:21.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "exec_command",
          arguments: "{\"cmd\":\"pwd\"}"
        }
      }),
      createContext(6, state)
    );

    const known = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:22.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "/workspace"
        }
      }),
      createContext(7, state)
    );
    const unknown = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:23.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "missing",
          output: "??"
        }
      }),
      createContext(8, state)
    );

    expect(known).toEqual(expect.objectContaining({ kind: "tool_result", tool: { name: "exec_command", output: "/workspace" } }));
    expect(unknown).toEqual(expect.objectContaining({ kind: "tool_result", tool: { name: "unknown", output: "??" } }));
  });

  it("maps token_count and preserves cached_input_tokens as cache_read_input_tokens", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = { lastModel: "gpt-5.4" };
    const withCache = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:24.000Z",
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
      createContext(9, state)
    );
    const withoutCache = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:25.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 11,
              output_tokens: 6
            }
          }
        }
      }),
      createContext(10, state)
    );

    expect(withCache).toEqual(
      expect.objectContaining({
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 100
          }
        }
      })
    );
    expect(commonEventSchema.parse(withoutCache as object)).toEqual(
      expect.objectContaining({
        kind: "model",
        model: {
          id: "gpt-5.4",
          provider: "openai",
          usage: {
            input_tokens: 11,
            output_tokens: 6
          }
        }
      })
    );
  });

  it("maps exec_command_end into tool_result and only emits tool.error on non-zero exit", () => {
    const parser = new CodexParser();
    const state: Record<string, unknown> = {};
    const success = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:26.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          aggregated_output: "ok",
          exit_code: 0
        }
      }),
      createContext(11, state)
    );
    const failure = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:27.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          aggregated_output: "failed",
          exit_code: 1
        }
      }),
      createContext(12, state)
    );

    expect(success).toEqual(expect.objectContaining({ kind: "tool_result", tool: { name: "exec_command", output: "ok" } }));
    expect(success).not.toEqual(expect.objectContaining({ tool: expect.objectContaining({ error: expect.anything() }) }));
    expect(failure).toEqual(
      expect.objectContaining({
        kind: "tool_result",
        tool: {
          name: "exec_command",
          output: "failed",
          error: "exit 1"
        }
      })
    );
  });

  it("treats unknown top-level types as lifecycle and preserves raw", () => {
    const parser = new CodexParser();
    const event = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:28.000Z",
        type: "agent-name",
        payload: {
          value: "reviewer"
        }
      }),
      createContext(13, {})
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "lifecycle",
        raw: {
          timestamp: "2026-04-24T08:29:28.000Z",
          type: "agent-name",
          payload: {
            value: "reviewer"
          }
        }
      })
    );
  });

  it("uses synthetic event ids when needed and ignores empty or invalid lines", () => {
    const parser = new CodexParser();
    const missingId = parser.parseLine(
      JSON.stringify({
        timestamp: "2026-04-24T08:29:29.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: []
        }
      }),
      createContext(14, {})
    );

    expect(missingId).toEqual(expect.objectContaining({ event_id: "codex-14" }));
    expect(parser.parseLine("", createContext(15, {}))).toBeNull();
    expect(parser.parseLine("{not-json}", createContext(16, {}))).toBeNull();
  });

  it("infers session ids from rollout filenames, then first-line session_meta, and otherwise fails", async () => {
    expect(
      await inferCodexSessionId(
        "/tmp/rollout-2026-04-24T16-29-13-019dbe9b-78a9-7e70-9004-6a0f4897d09e.jsonl"
      )
    ).toBe("019dbe9b-78a9-7e70-9004-6a0f4897d09e");

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-codex-session-id-"));
    const fallbackPath = path.join(tempRoot, "bad-name.jsonl");
    await writeFile(
      fallbackPath,
      `${JSON.stringify({
        timestamp: "2026-04-24T08:29:13.019Z",
        type: "session_meta",
        payload: {
          id: "fallback-session-id"
        }
      })}\n`,
      "utf8"
    );

    expect(await inferCodexSessionId(fallbackPath)).toBe("fallback-session-id");

    const invalidPath = path.join(tempRoot, "still-bad.jsonl");
    await writeFile(
      invalidPath,
      `${JSON.stringify({
        timestamp: "2026-04-24T08:29:13.019Z",
        type: "event_msg",
        payload: {
          type: "task_started"
        }
      })}\n`,
      "utf8"
    );

    await expect(inferCodexSessionId(invalidPath)).rejects.toMatchObject({
      code: "CLI_MISSING_CODEX_SESSION_ID"
    });
  });
});

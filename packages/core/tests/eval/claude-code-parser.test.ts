import { describe, expect, it } from "vitest";

import { ClaudeCodeParser, HarnessError, inferClaudeCodeSessionId } from "../../src/index.js";

describe("Claude Code trajectory parser", () => {
  it("maps assistant text content into a model event", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-04-27T10:00:01Z",
        cwd: "/x",
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "hello" }]
        }
      }),
      { session_id: "session-1", sequence: 1 }
    );

    expect(event).toEqual([
      {
        source: "claude-code",
        session_id: "session-1",
        event_id: "a1",
        timestamp: "2026-04-27T10:00:01Z",
        cwd: "/x",
        kind: "model",
        model: {
          id: "claude-sonnet-4-6",
          provider: "anthropic"
        },
        text: "hello",
        raw: {
          type: "assistant",
          uuid: "a1",
          timestamp: "2026-04-27T10:00:01Z",
          cwd: "/x",
          message: {
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "hello" }]
          }
        }
      }
    ]);
  });

  it("maps assistant thinking content into a model event while preserving signature", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-04-27T10:00:01Z",
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "thinking", thinking: "reasoning here", signature: "sig123" }]
        }
      }),
      { session_id: "session-1", sequence: 1 }
    );

    expect(event).toEqual([
      expect.objectContaining({
        kind: "model",
        thinking: {
          content: "reasoning here",
          signature: "sig123"
        }
      })
    ]);
  });

  it("maps assistant tool_use content into a tool_call event", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-04-27T10:00:01Z",
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }]
        }
      }),
      { session_id: "session-1", sequence: 1 }
    );

    expect(event).toEqual([
      expect.objectContaining({
        kind: "tool_call",
        tool: {
          name: "Read",
          input: {
            path: "/foo"
          }
        }
      })
    ]);
  });

  it("expands assistant multi-content items in order", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-04-27T10:00:01Z",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 100
          },
          content: [
            { type: "thinking", thinking: "reasoning here", signature: "sig123" },
            { type: "text", text: "hello" },
            { type: "tool_use", name: "Read", input: { path: "/foo" } }
          ]
        }
      }),
      { session_id: "session-1", sequence: 1 }
    );

    expect(event).toHaveLength(3);
    expect(event).toEqual([
      expect.objectContaining({
        kind: "model",
        model: expect.objectContaining({
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 100
          }
        }),
        thinking: {
          content: "reasoning here",
          signature: "sig123"
        }
      }),
      expect.objectContaining({
        kind: "model",
        text: "hello"
      }),
      expect.objectContaining({
        kind: "tool_call",
        tool: {
          name: "Read",
          input: {
            path: "/foo"
          }
        }
      })
    ]);
  });

  it("maps user toolUseResult into a tool_result event", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        timestamp: "2026-04-27T10:00:02Z",
        toolUseResult: {
          toolName: "Read",
          content: "file contents"
        },
        message: {
          content: "ignored because toolUseResult wins"
        }
      }),
      { session_id: "session-1", sequence: 2 }
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "tool_result",
        parent_event_id: "a1",
        tool: {
          name: "Read",
          output: {
            toolName: "Read",
            content: "file contents"
          }
        }
      })
    );
  });

  it("maps user content into a user_input event", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-04-27T10:00:00Z",
        message: {
          role: "user",
          content: "hi"
        }
      }),
      { session_id: "session-1", sequence: 1 }
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "user_input",
        text: "hi"
      })
    );
  });

  it("maps progress into lifecycle and preserves raw payload", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "progress",
        uuid: "p1",
        timestamp: "2026-04-27T10:00:03Z",
        data: {
          hookEvent: "PostToolUse"
        }
      }),
      { session_id: "session-1", sequence: 3 }
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "lifecycle",
        raw: {
          type: "progress",
          uuid: "p1",
          timestamp: "2026-04-27T10:00:03Z",
          data: {
            hookEvent: "PostToolUse"
          }
        }
      })
    );
  });

  it("sets subagent_id only for sidechain events", () => {
    const parser = new ClaudeCodeParser();
    const withSidechain = parser.parseLine(
      JSON.stringify({
        type: "progress",
        uuid: "p1",
        isSidechain: true,
        parentToolUseID: "tool-123"
      }),
      { session_id: "session-1", sequence: 1 }
    );
    const withoutSidechain = parser.parseLine(
      JSON.stringify({
        type: "progress",
        uuid: "p2",
        isSidechain: false,
        parentToolUseID: "tool-456"
      }),
      { session_id: "session-1", sequence: 2 }
    );

    expect(withSidechain).toEqual(expect.objectContaining({ subagent_id: "tool-123" }));
    expect(withoutSidechain).not.toHaveProperty("subagent_id");
  });

  it("treats unknown event types as lifecycle events", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "agent-name",
        uuid: "x1",
        value: "reviewer"
      }),
      { session_id: "session-1", sequence: 1 }
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: "lifecycle",
        raw: {
          type: "agent-name",
          uuid: "x1",
          value: "reviewer"
        }
      })
    );
  });

  it("falls back to a synthetic event id when uuid is missing", () => {
    const parser = new ClaudeCodeParser();
    const event = parser.parseLine(
      JSON.stringify({
        type: "progress"
      }),
      { session_id: "session-1", sequence: 7 }
    );

    expect(event).toEqual(expect.objectContaining({ event_id: "cc-7" }));
  });

  it("throws a named error for invalid JSON", () => {
    const parser = new ClaudeCodeParser();

    expect(() =>
      parser.parseLine("{not-json}", {
        session_id: "session-1",
        sequence: 9
      })
    ).toThrowError(
      expect.objectContaining({
        code: "EVAL_PARSE_FAILED"
      })
    );
  });

  it("infers session ids from uuid-style filenames and rejects invalid filenames", () => {
    expect(inferClaudeCodeSessionId("/tmp/12345678-1234-1234-1234-123456789abc.jsonl")).toBe(
      "12345678-1234-1234-1234-123456789abc"
    );

    try {
      inferClaudeCodeSessionId("/tmp/not-a-uuid.jsonl");
      throw new Error("expected invalid filename to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect(error).toMatchObject({
        code: "EVAL_INVALID_CC_FILENAME"
      });
    }
  });
});

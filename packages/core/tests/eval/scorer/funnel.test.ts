import { describe, expect, it } from "vitest";

import { scoreFunnel } from "../../../src/eval/scorer/funnel.js";
import type { CommonEvent } from "../../../src/index.js";

const events: CommonEvent[] = [
  {
    source: "stub",
    session_id: "session-1",
    event_id: "u1",
    timestamp: "2026-04-27T10:00:00Z",
    kind: "user_input",
    text: "hi",
    raw: {}
  },
  {
    source: "stub",
    session_id: "session-1",
    event_id: "m1",
    timestamp: "2026-04-27T10:00:02Z",
    kind: "model",
    model: {
      id: "gpt-5.4",
      provider: "openai",
      usage: {
        input_tokens: 10,
        output_tokens: 5
      }
    },
    text: "hello",
    raw: {}
  },
  {
    source: "stub",
    session_id: "session-1",
    event_id: "t1",
    timestamp: "2026-04-27T10:00:03Z",
    kind: "tool_call",
    tool: {
      name: "Read",
      input: { path: "/x" }
    },
    raw: {}
  }
];

describe("scoreFunnel", () => {
  it("returns a full FunnelScore from structured inputs", () => {
    expect(
      scoreFunnel({
        events,
        quality: {
          techDesignConformance: {
            violations: 1,
            totalRules: 10
          },
          adoptionRate: {
            aiProducedLines: 100,
            reworkLines: 10
          },
          reviewPassEfficiency: {
            reviewRound: 2
          },
          firstPassRate: {
            firstPassPRs: 3,
            totalPRs: 4
          },
          smokePassRate: {
            smokePassed: 8,
            smokeTotal: 10
          },
          bugDensity: {
            bugCount: 2,
            totalLOC: 2000
          }
        }
      })
    ).toEqual({
      schema_version: 1,
      quality: {
        tech_design_conformance: 0.9,
        adoption_rate: 0.9,
        review_pass_efficiency: 0.5,
        first_pass_rate: 0.75,
        smoke_pass_rate: 0.8,
        bug_density: 1
      },
      performance: {
        n_turns: 1,
        n_toolcalls: 1,
        n_total_tokens: 15,
        time_to_first_token: 2,
        output_tokens_per_sec: 2.5,
        time_to_last_token: 3
      }
    });
  });
});

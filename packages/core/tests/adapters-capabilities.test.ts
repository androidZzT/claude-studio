import { describe, expect, it } from "vitest";

import {
  ADAPTERS_CAPABILITIES_SCHEMA_VERSION,
  adaptersCapabilitiesReportSchema,
  describeAdapterCapabilities
} from "../src/index.js";
import type { Adapter, PlannedFile, ToolName } from "../src/index.js";

function createAdapter(id: ToolName, features: readonly string[]): Adapter {
  return {
    id,
    async plan(): Promise<PlannedFile[]> {
      return [];
    },
    capabilities() {
      return { features };
    }
  };
}

describe("adapter capabilities report", () => {
  it("returns an empty matrix when no adapters are registered", () => {
    const report = describeAdapterCapabilities([]);

    expect(adaptersCapabilitiesReportSchema.parse(report)).toEqual({
      schema_version: ADAPTERS_CAPABILITIES_SCHEMA_VERSION,
      adapters: []
    });
  });

  it("sorts a single adapter feature list for stable json output", () => {
    const report = describeAdapterCapabilities([createAdapter("codex", ["codex-config-toml", "agents-md"])]);

    expect(adaptersCapabilitiesReportSchema.parse(report)).toEqual({
      schema_version: ADAPTERS_CAPABILITIES_SCHEMA_VERSION,
      adapters: [
        {
          id: "codex",
          features: ["agents-md", "codex-config-toml"]
        }
      ]
    });
  });

  it("sorts adapters by id", () => {
    const report = describeAdapterCapabilities([
      createAdapter("claude-code", [
        "claude-md",
        "claude-mcp",
        "claude-commands-md",
        "claude-agents-md",
        "claude-docs",
        "claude-metrics",
        "claude-plugins",
        "claude-reference-projects",
        "claude-scripts",
        "claude-skills",
        "claude-rules-md",
        "claude-hooks"
      ]),
      createAdapter("cursor", ["cursor-rules-mdc", "cursor-mcp-json"]),
      createAdapter("codex", ["codex-config-toml", "agents-md"])
    ]);

    expect(report.adapters).toEqual([
      {
        id: "claude-code",
        features: [
          "claude-agents-md",
          "claude-commands-md",
          "claude-docs",
          "claude-hooks",
          "claude-mcp",
          "claude-md",
          "claude-metrics",
          "claude-plugins",
          "claude-reference-projects",
          "claude-rules-md",
          "claude-scripts",
          "claude-skills"
        ]
      },
      {
        id: "codex",
        features: ["agents-md", "codex-config-toml"]
      },
      {
        id: "cursor",
        features: ["cursor-mcp-json", "cursor-rules-mdc"]
      }
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { adaptersListReportSchema, describeConfiguredAdapters, parseHarnessConfig } from "../src/index.js";
import type { Adapter, PlannedFile, ToolName } from "../src/index.js";

function createAdapter(id: ToolName): Adapter {
  return {
    id,
    async plan(): Promise<PlannedFile[]> {
      return [];
    },
    capabilities() {
      return { features: [] };
    }
  };
}

describe("adapter list report", () => {
  it("returns an empty list when no adapters are registered", () => {
    const config = parseHarnessConfig(`
name: demo
tools:
  - codex
canonical:
  instructions: ./AGENTS.md.template
`);

    const report = describeConfiguredAdapters(config, []);

    expect(adaptersListReportSchema.parse(report)).toEqual({
      adapters: []
    });
  });

  it("includes configured adapters from tools and adapter settings with stable ordering", () => {
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
  - codex
  - cursor
canonical:
  instructions: ./AGENTS.md.template
adapters:
  claude-code:
    enabled: true
    target: ./docs
  codex:
    enabled: true
    target: .
  cursor:
    enabled: true
    target: ./.cursor
`);

    const report = describeConfiguredAdapters(config, [createAdapter("cursor"), createAdapter("codex"), createAdapter("claude-code")]);

    expect(adaptersListReportSchema.parse(report)).toEqual({
      adapters: [
        {
          id: "claude-code",
          registered: true,
          enabled_in_config: true,
          target: "./docs"
        },
        {
          id: "codex",
          registered: true,
          enabled_in_config: true,
          target: "."
        },
        {
          id: "cursor",
          registered: true,
          enabled_in_config: true,
          target: "./.cursor"
        }
      ]
    });
  });

  it("defaults undeclared adapter settings to disabled and null target", () => {
    const config = parseHarnessConfig(`
name: demo
tools:
  - codex
canonical:
  instructions: ./AGENTS.md.template
`);

    const report = describeConfiguredAdapters(config, [createAdapter("codex"), createAdapter("cursor"), createAdapter("claude-code")]);

    expect(report.adapters).toEqual([
      {
        id: "claude-code",
        registered: true,
        enabled_in_config: false,
        target: null
      },
      {
        id: "codex",
        registered: true,
        enabled_in_config: true,
        target: null
      },
      {
        id: "cursor",
        registered: true,
        enabled_in_config: false,
        target: null
      }
    ]);
  });
});

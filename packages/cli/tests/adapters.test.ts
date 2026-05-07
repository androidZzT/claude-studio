import { describe, expect, it } from "vitest";

import {
  ADAPTERS_CAPABILITIES_SCHEMA_VERSION,
  adaptersCapabilitiesReportSchema,
  adaptersListReportSchema
} from "@harness/core";

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

describe("harness adapters cli", () => {
  it("prints adapters help", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["adapters", "--help"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("Usage: harness adapters <list|capabilities>");
  });

  it("prints adapter list in human-readable form", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["adapters", "list"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      "Adapters",
      "  claude-code  registered  disabled  target=null",
      "  codex        registered  enabled  target=.",
      "  cursor       registered  disabled  target=null"
    ]);
  });

  it("prints adapter list json that matches the exported schema", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["adapters", "list", "--json"], io);
    const report = adaptersListReportSchema.parse(JSON.parse(stdout[0] ?? "{}"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(report).toEqual({
      adapters: [
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
          target: "."
        },
        {
          id: "cursor",
          registered: true,
          enabled_in_config: false,
          target: null
        }
      ]
    });
  });

  it("prints the full capabilities matrix", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["adapters", "capabilities"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      `Capabilities (schema_version=${ADAPTERS_CAPABILITIES_SCHEMA_VERSION})`,
      "  claude-code",
      "    - claude-agents-md",
      "    - claude-commands-md",
      "    - claude-docs",
      "    - claude-hooks",
      "    - claude-mcp",
      "    - claude-md",
      "    - claude-metrics",
      "    - claude-plugins",
      "    - claude-reference-projects",
      "    - claude-rules-md",
      "    - claude-scripts",
      "    - claude-skills",
      "  codex",
      "    - agents-md",
      "    - codex-config-toml",
      "  cursor",
      "    - cursor-mcp-json",
      "    - cursor-rules-mdc"
    ]);
  });

  it("prints a single claude-code adapter capability report", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["adapters", "capabilities", "claude-code"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      `Capabilities (schema_version=${ADAPTERS_CAPABILITIES_SCHEMA_VERSION})`,
      "  claude-code",
      "    - claude-agents-md",
      "    - claude-commands-md",
      "    - claude-docs",
      "    - claude-hooks",
      "    - claude-mcp",
      "    - claude-md",
      "    - claude-metrics",
      "    - claude-plugins",
      "    - claude-reference-projects",
      "    - claude-rules-md",
      "    - claude-scripts",
      "    - claude-skills"
    ]);
  });

  it("fails for an unknown registered adapter id", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["adapters", "capabilities", "not-exists"], io);

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toContain("not registered");
  });

  it("keeps features sorted in json output", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["adapters", "capabilities", "--json"], io);
    const report = adaptersCapabilitiesReportSchema.parse(JSON.parse(stdout[0] ?? "{}"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(report).toEqual({
      schema_version: ADAPTERS_CAPABILITIES_SCHEMA_VERSION,
      adapters: [
        {
          id: "claude-code",
          features: ["claude-agents-md", "claude-commands-md", "claude-docs", "claude-hooks", "claude-mcp", "claude-md", "claude-metrics", "claude-plugins", "claude-reference-projects", "claude-rules-md", "claude-scripts", "claude-skills"]
        },
        {
          id: "codex",
          features: ["agents-md", "codex-config-toml"]
        },
        {
          id: "cursor",
          features: ["cursor-mcp-json", "cursor-rules-mdc"]
        }
      ]
    });
  });
});

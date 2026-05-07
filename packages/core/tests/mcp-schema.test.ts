import { describe, expect, it } from "vitest";

import { parseHarnessConfig } from "../src/index.js";

const baseConfig = `
name: demo
tools:
  - codex
canonical:
  instructions: ./AGENTS.md.template
`;

describe("mcp schema", () => {
  it("parses standard command-based MCP server declarations", () => {
    const config = parseHarnessConfig(`
${baseConfig}
mcp:
  servers:
    github:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: "\${GITHUB_TOKEN}"
`);

    expect(config.mcp).toEqual({
      servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: {
            GITHUB_TOKEN: "${GITHUB_TOKEN}"
          }
        }
      }
    });
  });

  it("rejects MCP servers without command", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
mcp:
  servers:
    github:
      args: ["-y"]
`)
    ).toThrow(/command/i);
  });

  it("rejects MCP args with non-string values", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
mcp:
  servers:
    github:
      command: npx
      args: [1]
`)
    ).toThrow(/string/i);
  });

  it("rejects MCP env values that are not string-to-string records", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
mcp:
  servers:
    github:
      command: npx
      env:
        GITHUB_TOKEN: 123
`)
    ).toThrow(/string/i);
  });

  it("accepts an explicit empty MCP servers block", () => {
    const config = parseHarnessConfig(`
${baseConfig}
mcp:
  servers: {}
`);

    expect(config.mcp).toEqual({
      servers: {}
    });
  });

  it("accepts configs with no MCP block", () => {
    const config = parseHarnessConfig(baseConfig);

    expect(config.mcp).toBeUndefined();
  });
});

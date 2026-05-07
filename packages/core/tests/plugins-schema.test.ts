import { describe, expect, it } from "vitest";

import { parseHarnessConfig } from "../src/index.js";

const baseConfig = `
name: demo
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
`;

describe("plugins schema", () => {
  it("defaults plugin format to plugins", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  enabled:
    - skill-health@everything-claude-code
`);

    expect(config.plugins?.format).toBe("plugins");
  });

  it("parses enabledPlugins as an alternative plugin format", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  format: enabledPlugins
  enabled:
    - skill-health@everything-claude-code
`);

    expect(config.plugins?.format).toBe("enabledPlugins");
  });

  it("normalizes string plugin entries to user scope", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  enabled:
    - skill-health@everything-claude-code
    - everything-claude-code
`);

    expect(config.plugins?.enabled).toEqual([
      { id: "skill-health@everything-claude-code", scope: "user" },
      { id: "everything-claude-code", scope: "user" }
    ]);
  });

  it("preserves object plugin scopes", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  enabled:
    - id: swift-lsp@claude-plugins-official
      scope: local
`);

    expect(config.plugins?.enabled).toEqual([{ id: "swift-lsp@claude-plugins-official", scope: "local" }]);
  });

  it("rejects duplicate enabled plugin ids", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
plugins:
  enabled:
    - skill-health@everything-claude-code
    - id: skill-health@everything-claude-code
      scope: local
`)
    ).toThrow(/unique/i);
  });

  it("rejects duplicate marketplace ids", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
plugins:
  marketplaces:
    - id: everything-claude-code
      source: github:affaan-m/everything-claude-code
    - id: everything-claude-code
      source: github:other/repo
`)
    ).toThrow(/unique/i);
  });

  it("rejects unsupported marketplace source prefixes", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
plugins:
  marketplaces:
    - id: everything-claude-code
      source: ssh://example.com/repo
`)
    ).toThrow(/github:|http/i);
  });

  it("accepts undeclared marketplace references at schema time", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  enabled:
    - skill-health@unknown-marketplace
`);

    expect(config.plugins?.enabled).toEqual([{ id: "skill-health@unknown-marketplace", scope: "user" }]);
  });

  it("rejects version-pinned plugin references with multiple @ segments", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
plugins:
  enabled:
    - skill-health@everything-claude-code@v1
`)
    ).toThrow(/multiple @ segments|version pinning/i);
  });

  it("rejects unsupported plugin format values", () => {
    expect(() =>
      parseHarnessConfig(`
${baseConfig}
plugins:
  format: legacy
  enabled:
    - skill-health@everything-claude-code
`)
    ).toThrow(/enabledPlugins|plugins/i);
  });
});

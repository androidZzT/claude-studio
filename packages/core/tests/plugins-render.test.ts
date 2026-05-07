import { describe, expect, it } from "vitest";

import {
  parseHarnessConfig,
  renderClaudeEnabledPlugins,
  renderClaudeEnabledPluginsArray,
  renderClaudeEnabledPluginsObject,
  renderClaudePluginMarketplaces
} from "../src/index.js";

const baseConfig = `
name: demo
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
`;

describe("plugins render", () => {
  it("renders a single marketplace and plugin entry", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  marketplaces:
    - id: everything-claude-code
      source: github:affaan-m/everything-claude-code
  enabled:
    - skill-health@everything-claude-code
`);

    expect(renderClaudePluginMarketplaces(config)).toEqual({
      "everything-claude-code": {
        source: "github:affaan-m/everything-claude-code"
      }
    });
    expect(renderClaudeEnabledPluginsArray(config)).toEqual([
      {
        enabled: true,
        plugin: "skill-health@everything-claude-code",
        scope: "user"
      }
    ]);
  });

  it("renders autoUpdate only when true", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  marketplaces:
    - id: alpha
      source: github:alpha/repo
      autoUpdate: true
    - id: beta
      source: github:beta/repo
`);

    expect(renderClaudePluginMarketplaces(config)).toEqual({
      alpha: {
        autoUpdate: true,
        source: "github:alpha/repo"
      },
      beta: {
        source: "github:beta/repo"
      }
    });
  });

  it("sorts plugin arrays and marketplace objects by id", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  marketplaces:
    - id: zeta
      source: github:zeta/repo
    - id: alpha
      source: github:alpha/repo
  enabled:
    - id: zeta
      scope: local
    - alpha@alpha
`);

    expect(Object.keys(renderClaudePluginMarketplaces(config))).toEqual(["alpha", "zeta"]);
    expect(renderClaudeEnabledPluginsArray(config)).toEqual([
      {
        enabled: true,
        plugin: "alpha@alpha",
        scope: "user"
      },
      {
        enabled: true,
        plugin: "zeta",
        scope: "local"
      }
    ]);
  });

  it("renders enabledPlugins as a sorted object when requested", () => {
    const config = parseHarnessConfig(`
${baseConfig}
plugins:
  format: enabledPlugins
  enabled:
    - id: zeta
      scope: local
    - alpha@alpha
`);

    expect(renderClaudeEnabledPlugins(config)).toEqual({
      key: "enabledPlugins",
      noteScopeDropped: true,
      value: {
        "alpha@alpha": true,
        zeta: true
      }
    });
    expect(renderClaudeEnabledPluginsObject(config)).toEqual({
      "alpha@alpha": true,
      zeta: true
    });
  });
});

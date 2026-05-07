import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createClaudeCodeAdapter, parseHarnessConfig } from "../src/index.js";

async function createClaudeWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-format-"));
  await writeFile(path.join(rootDir, "AGENTS.md.template"), "# Demo Agent Guide\n", "utf8");
  return rootDir;
}

describe("plugins format", () => {
  it("uses the plugins array format by default", async () => {
    const adapter = createClaudeCodeAdapter();
    const rootDir = await createClaudeWorkspace();
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
plugins:
  marketplaces:
    - id: everything-claude-code
      source: github:affaan-m/everything-claude-code
  enabled:
    - skill-health@everything-claude-code
adapters:
  claude-code:
    target: .
`);

    const plan = await adapter.plan(config, rootDir);
    const settingsFile = plan.find((file) => file.path === ".claude/settings.json");

    expect(settingsFile).toMatchObject({
      kind: "partial-json",
      ownedKeys: ["marketplaces", "plugins"]
    });
    expect(settingsFile && "ownedValues" in settingsFile ? settingsFile.ownedValues : undefined).toEqual({
      marketplaces: {
        "everything-claude-code": {
          source: "github:affaan-m/everything-claude-code"
        }
      },
      plugins: [
        {
          enabled: true,
          plugin: "skill-health@everything-claude-code",
          scope: "user"
        }
      ]
    });
  });

  it("uses the enabledPlugins object format when selected", async () => {
    const adapter = createClaudeCodeAdapter();
    const rootDir = await createClaudeWorkspace();
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
plugins:
  format: enabledPlugins
  enabled:
    - zeta@mp
    - alpha@mp
adapters:
  claude-code:
    target: .
`);

    const plan = await adapter.plan(config, rootDir);
    const settingsFile = plan.find((file) => file.path === ".claude/settings.json");

    expect(settingsFile).toMatchObject({
      kind: "partial-json",
      ownedKeys: ["enabledPlugins"]
    });
    expect(settingsFile && "ownedValues" in settingsFile ? settingsFile.ownedValues : undefined).toEqual({
      enabledPlugins: {
        "alpha@mp": true,
        "zeta@mp": true
      }
    });
  });

  it("warns once and drops scope when enabledPlugins format is selected", async () => {
    const adapter = createClaudeCodeAdapter();
    const rootDir = await createClaudeWorkspace();
    const warnings: string[] = [];
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
plugins:
  format: enabledPlugins
  enabled:
    - id: everything-claude-code
      scope: local
    - skill-health@everything-claude-code
adapters:
  claude-code:
    target: .
`);

    const plan = await adapter.plan(config, rootDir, {
      onWarning(message) {
        warnings.push(message);
      }
    });
    const settingsFile = plan.find((file) => file.path === ".claude/settings.json");

    expect(warnings).toEqual(["Note: enabledPlugins format does not support 'scope'; field will be dropped."]);
    expect(settingsFile && "ownedValues" in settingsFile ? settingsFile.ownedValues : undefined).toEqual({
      enabledPlugins: {
        "everything-claude-code": true,
        "skill-health@everything-claude-code": true
      }
    });
  });
});

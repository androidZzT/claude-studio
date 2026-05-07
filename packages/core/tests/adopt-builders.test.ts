import { describe, expect, it } from "vitest";

import { buildAdoptGitignore, buildHarnessYaml, parseHarnessConfig } from "../src/index.js";

describe("adopt builders", () => {
  it("builds a standard harness.yaml for adopt output", () => {
    const source = buildHarnessYaml({
      name: "sailor-harness",
      description: "Migrated from /tmp/source at 2026-04-29T00:00:00.000Z",
      capabilities: ["agents", "skills", "rules", "scripts", "commands", "hooks", "mcp", "plugins", "reference_projects", "docs", "metrics"],
      hooks: {
        SessionStart: [{ enabled: true, run: "echo session", matcher: "", timeout: 10, statusMessage: "checking" }]
      },
      mcp: {
        servers: {
          alpha: {
            command: "npx",
            args: ["-y", "@example/server-alpha"],
            env: {}
          }
        }
      },
      plugins: {
        format: "enabledPlugins",
        marketplaces: [{ id: "mini-market", source: "github:example/mini-market", autoUpdate: false }],
        enabled: [{ id: "mini-plugin@mini-market", scope: "user" }]
      }
    });

    const parsed = parseHarnessConfig(source);
    expect(parsed.name).toBe("sailor-harness");
    expect(parsed.description).toContain("Migrated from /tmp/source");
    expect(parsed.tools).toEqual(["claude-code"]);
    expect(parsed.adapters["claude-code"]?.capabilities).toEqual([
      "agents",
      "skills",
      "rules",
      "scripts",
      "commands",
      "hooks",
      "mcp",
      "plugins",
      "reference_projects",
      "docs",
      "metrics"
    ]);
  });

  it("builds a gitignore that excludes runtime .claude data", () => {
    const source = buildAdoptGitignore();

    expect(source).toContain(".claude/settings.local.json");
    expect(source).toContain(".claude/metrics/events.jsonl");
    expect(source).toContain(".claude/reference-project.local.json");
  });
});

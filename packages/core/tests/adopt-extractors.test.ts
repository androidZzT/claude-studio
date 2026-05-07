import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CLAUDE_LIFECYCLE_HOOK_NAMES } from "../src/index.js";
import type { HarnessError } from "../src/index.js";
import { extractAgents } from "../src/adopt/extractors/agents.js";
import { extractCommands } from "../src/adopt/extractors/commands.js";
import { extractDocs, extractMetrics } from "../src/adopt/extractors/passthrough.js";
import { extractReferenceProjects } from "../src/adopt/extractors/reference-projects.js";
import { extractRules } from "../src/adopt/extractors/rules.js";
import { extractScripts } from "../src/adopt/extractors/scripts.js";
import { extractSettings } from "../src/adopt/extractors/settings.js";
import { extractSkills } from "../src/adopt/extractors/skills.js";

const fixtureRoot = path.resolve("packages/core/tests/fixtures/mini-claude-dir");

async function cloneFixture(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-adopt-fixture-"));
  const workspaceDir = path.join(tempRoot, "fixture");
  await cp(fixtureRoot, workspaceDir, { recursive: true });
  return workspaceDir;
}

describe("adopt extractors", () => {
  it("extracts the standard .claude subtrees into harness repo roots", async () => {
    const workspaceDir = await cloneFixture();

    expect((await extractAgents(workspaceDir)).files.map((file) => file.targetPath)).toEqual(["agents/code-reviewer.md"]);
    expect((await extractCommands(workspaceDir)).files.map((file) => file.targetPath)).toEqual(["commands/review.md"]);
    expect((await extractRules(workspaceDir)).files.map((file) => file.targetPath)).toEqual([
      "rules/style.md",
      "rules/testing.md"
    ]);
    expect((await extractScripts(workspaceDir)).files.map((file) => file.targetPath)).toEqual(["scripts/check.sh"]);
    expect((await extractSkills(workspaceDir)).files.map((file) => file.targetPath)).toEqual([
      "skills/demo-skill/resources/checklist.md",
      "skills/demo-skill/SKILL.md"
    ]);
    expect((await extractDocs(workspaceDir)).files.map((file) => file.targetPath)).toEqual([
      "docs/architecture/adr/ADR-001.md",
      "docs/README.md"
    ]);
    expect((await extractMetrics(workspaceDir)).files.map((file) => file.targetPath)).toEqual(["metrics/events.schema.md"]);
    expect((await extractReferenceProjects(workspaceDir)).files.map((file) => file.targetPath)).toEqual(["reference-project.json"]);
  });

  it("extracts hooks, mcp, and plugins from settings.json", async () => {
    const workspaceDir = await cloneFixture();
    const extracted = await extractSettings(workspaceDir);

    expect(Object.keys(extracted.hooks ?? {})).toEqual(["PostToolUse", "SessionStart"]);
    expect(extracted.hooks?.SessionStart?.[0]).toEqual({
      enabled: true,
      matcher: "",
      run: "bash .claude/scripts/check.sh",
      statusMessage: "checking",
      timeout: 10
    });
    expect(extracted.mcp).toEqual({
      servers: {
        alpha: {
          command: "npx",
          args: ["-y", "@example/server-alpha"],
          env: {
            TOKEN: "${TOKEN}"
          }
        }
      }
    });
    expect(extracted.plugins).toEqual({
      format: "enabledPlugins",
      marketplaces: [{ id: "mini-market", source: "github:example/mini-market", autoUpdate: false }],
      enabled: [{ id: "mini-plugin@mini-market", scope: "user" }]
    });
  });

  it("accepts extraKnownMarketplaces as a reverse-parse alias", async () => {
    const workspaceDir = await cloneFixture();
    const settingsPath = path.join(workspaceDir, ".claude", "settings.json");
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          extraKnownMarketplaces: {
            "alias-market": {
              source: "github:example/alias-market"
            }
          },
          enabledPlugins: {
            "alias-plugin@alias-market": true
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const extracted = await extractSettings(workspaceDir);
    expect(extracted.plugins).toEqual({
      format: "enabledPlugins",
      marketplaces: [{ id: "alias-market", source: "github:example/alias-market", autoUpdate: false }],
      enabled: [{ id: "alias-plugin@alias-market", scope: "user" }]
    });
  });

  it("supports array-form plugins and filters invalid lifecycle / mcp entries", async () => {
    const workspaceDir = await cloneFixture();
    const settingsPath = path.join(workspaceDir, ".claude", "settings.json");
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                hooks: [
                  { type: "command", command: "echo ok", timeout: 5 },
                  { type: "noop", command: "echo ignored" },
                  { type: "command", command: "   " }
                ]
              },
              "ignored"
            ]
          },
          mcpServers: {
            good: {
              command: "npx",
              args: ["-y", 123, "@good/server"],
              env: {
                TOKEN: "${TOKEN}",
                INVALID: 42
              }
            },
            bad: {
              args: ["missing command"]
            },
            noenv: {
              command: "uvx",
              env: "not-an-object"
            }
          },
          marketplaces: {
            valid: {
              source: "github:example/valid"
            },
            invalid: {
              autoUpdate: true
            }
          },
          plugins: [
            { plugin: "valid@market", scope: "project" },
            { plugin: "also-valid@market", scope: "unknown" },
            { plugin: "" },
            "ignored"
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const extracted = await extractSettings(workspaceDir);
    expect(extracted.hooks).toEqual({
      PostToolUse: [{ enabled: true, run: "echo ok", timeout: 5 }]
    });
    expect(extracted.mcp).toEqual({
      servers: {
        good: {
          command: "npx",
          args: ["-y", "@good/server"],
          env: { TOKEN: "${TOKEN}" }
        },
        noenv: {
          command: "uvx",
          args: [],
          env: {}
        }
      }
    });
    expect(extracted.plugins).toEqual({
      format: "plugins",
      marketplaces: [{ id: "valid", source: "github:example/valid", autoUpdate: false }],
      enabled: [
        { id: "valid@market", scope: "project" },
        { id: "also-valid@market", scope: "user" }
      ]
    });
  });

  it("accepts all 17 lifecycle hook names during reverse extraction", async () => {
    const workspaceDir = await cloneFixture();
    const settingsPath = path.join(workspaceDir, ".claude", "settings.json");
    const hooks = Object.fromEntries(
      CLAUDE_LIFECYCLE_HOOK_NAMES.map((hookName) => [
        hookName,
        [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `echo ${hookName}`,
                timeout: 5
              }
            ]
          }
        ]
      ])
    );
    await writeFile(settingsPath, `${JSON.stringify({ hooks }, null, 2)}\n`, "utf8");

    const extracted = await extractSettings(workspaceDir);
    expect(Object.keys(extracted.hooks ?? {})).toEqual([...CLAUDE_LIFECYCLE_HOOK_NAMES]);
  });

  it("skips missing settings.json with a warning instead of failing", async () => {
    const workspaceDir = await cloneFixture();
    const settingsPath = path.join(workspaceDir, ".claude", "settings.json");
    await rm(settingsPath);

    await expect(extractSettings(workspaceDir)).resolves.toEqual({
      warnings: [`Warning: settings.json not found: ${settingsPath}`]
    });
  });

  it("fails with a named error when settings.json is corrupt", async () => {
    const workspaceDir = await cloneFixture();
    const settingsPath = path.join(workspaceDir, ".claude", "settings.json");
    await writeFile(settingsPath, "", "utf8");

    await expect(extractSettings(workspaceDir)).rejects.toMatchObject({
      code: "ADOPT_INVALID_JSON"
    } satisfies Partial<HarnessError>);
  });

  it("preserves executable modes for adopted scripts", async () => {
    const workspaceDir = await cloneFixture();
    const script = (await extractScripts(workspaceDir)).files[0];

    expect(script?.mode & 0o111).not.toBe(0);
  });

  it("returns an empty reference-project extraction when the file is missing", async () => {
    const workspaceDir = await cloneFixture();
    await rm(path.join(workspaceDir, ".claude", "reference-project.json"));

    await expect(extractReferenceProjects(workspaceDir)).resolves.toEqual({
      capability: "reference_projects",
      files: []
    });
  });

  it("rethrows non-ENOENT errors while extracting reference-projects", async () => {
    const workspaceDir = await cloneFixture();
    const referenceProjectsPath = path.join(workspaceDir, ".claude", "reference-project.json");
    await rm(referenceProjectsPath);
    await writeFile(referenceProjectsPath, "", "utf8");
    await rm(referenceProjectsPath);
    await cp(path.join(workspaceDir, ".claude", "docs"), referenceProjectsPath, { recursive: true });

    await expect(extractReferenceProjects(workspaceDir)).rejects.toMatchObject({
      code: "EISDIR"
    });
  });
});

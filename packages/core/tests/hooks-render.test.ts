import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createClaudeCodeAdapter, parseHarnessConfig } from "../src/index.js";

async function createClaudeWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "harness-hooks-render-"));
  await writeFile(path.join(rootDir, "AGENTS.md.template"), "# Demo Agent Guide\n", "utf8");
  return rootDir;
}

describe("hooks render", () => {
  it("renders timeout and statusMessage on the inner command hook entry", async () => {
    const adapter = createClaudeCodeAdapter();
    const rootDir = await createClaudeWorkspace();
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  PostToolUse:
    - matcher: Edit|Write
      run: echo edit
      timeout: 300
      statusMessage: Lint...
`);

    const plan = await adapter.plan(config, rootDir);
    const settingsFile = plan.find((file) => file.path === ".claude/settings.json");
    const ownedValues = settingsFile && "ownedValues" in settingsFile ? settingsFile.ownedValues : undefined;

    expect(ownedValues).toEqual({
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              {
                type: "command",
                command: "echo edit",
                timeout: 300,
                statusMessage: "Lint..."
              }
            ]
          }
        ]
      }
    });
  });

  it("omits timeout and statusMessage when they are not declared", async () => {
    const adapter = createClaudeCodeAdapter();
    const rootDir = await createClaudeWorkspace();
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  WorktreeCreate:
    - run: echo created
`);

    const plan = await adapter.plan(config, rootDir);
    const settingsFile = plan.find((file) => file.path === ".claude/settings.json");
    const ownedValues = settingsFile && "ownedValues" in settingsFile ? settingsFile.ownedValues : undefined;
    const hookEntry = (ownedValues as { hooks: { WorktreeCreate: Array<{ hooks: Array<Record<string, unknown>> }> } }).hooks.WorktreeCreate[0];

    expect(hookEntry).toEqual({
      hooks: [
        {
          type: "command",
          command: "echo created"
        }
      ]
    });
    expect(hookEntry.hooks[0]).not.toHaveProperty("timeout");
    expect(hookEntry.hooks[0]).not.toHaveProperty("statusMessage");
  });

  it("warns and strips matcher for lifecycle events that do not use matcher", async () => {
    const adapter = createClaudeCodeAdapter();
    const rootDir = await createClaudeWorkspace();
    const warnings: string[] = [];
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  SessionStart:
    - matcher: ""
      run: echo session
      timeout: 10
      statusMessage: 环境健康扫描...
`);

    const plan = await adapter.plan(config, rootDir, {
      onWarning(message) {
        warnings.push(message);
      }
    });
    const settingsFile = plan.find((file) => file.path === ".claude/settings.json");
    const ownedValues = settingsFile && "ownedValues" in settingsFile ? settingsFile.ownedValues : undefined;
    const hookEntry = (ownedValues as { hooks: { SessionStart: Array<Record<string, unknown>> } }).hooks.SessionStart[0];

    expect(warnings).toEqual([
      "Warning: hook `SessionStart[0]` declares matcher but the event type does not use matcher; field will be ignored on render."
    ]);
    expect(hookEntry).not.toHaveProperty("matcher");
    expect(hookEntry).toEqual({
      hooks: [
        {
          type: "command",
          command: "echo session",
          timeout: 10,
          statusMessage: "环境健康扫描..."
        }
      ]
    });
  });
});

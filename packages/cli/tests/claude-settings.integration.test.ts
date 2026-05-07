import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { CLAUDE_LIFECYCLE_HOOK_NAMES, adaptersCapabilitiesReportSchema, loadManifest } from "@harness/core";

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

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);

  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

async function createWorkspace(tempRoot: string): Promise<string> {
  const workspaceDir = path.join(tempRoot, "demo");

  await withCwd(tempRoot, async () => {
    const initIo = createIo();
    expect(await runCli(["init", "demo"], initIo.io)).toBe(0);
  });

  return workspaceDir;
}

async function writeHarnessConfig(
  workspaceDir: string,
  tools: string[],
  options: {
    lifecycleHooks?: Record<string, Array<{ matcher?: string; run: string; timeout?: number; statusMessage?: string; enabled?: boolean }>>;
    mcp?: {
      servers: Record<
        string,
        {
          command: string;
          args?: string[];
          env?: Record<string, string>;
        }
      >;
    };
  } = {}
): Promise<void> {
  const harnessPath = path.join(workspaceDir, "harness.yaml");
  const source = await readFile(harnessPath, "utf8");
  const document = YAML.parse(source) as Record<string, unknown>;

  document.tools = tools;
  document.adapters = Object.fromEntries(
    tools.map((tool) => [
      tool,
      {
        enabled: true,
        target: "."
      }
    ])
  );

  const hooks = document.hooks && typeof document.hooks === "object" ? { ...(document.hooks as Record<string, unknown>) } : {};
  for (const hookName of CLAUDE_LIFECYCLE_HOOK_NAMES) {
    delete hooks[hookName];
  }

  if (options.lifecycleHooks) {
    for (const [hookName, entries] of Object.entries(options.lifecycleHooks)) {
      hooks[hookName] = entries;
    }
  }

  if (Object.keys(hooks).length > 0) {
    document.hooks = hooks;
  } else {
    delete document.hooks;
  }

  if (options.mcp) {
    document.mcp = options.mcp;
  } else {
    delete document.mcp;
  }

  await writeFile(harnessPath, YAML.stringify(document), "utf8");
}

function parseSettings(source: string): Record<string, unknown> {
  return JSON.parse(source) as Record<string, unknown>;
}

async function readSettings(workspaceDir: string): Promise<Record<string, unknown>> {
  return parseSettings(await readFile(path.join(workspaceDir, ".claude", "settings.json"), "utf8"));
}

async function writeSettings(workspaceDir: string, document: Record<string, unknown>): Promise<void> {
  await mkdir(path.join(workspaceDir, ".claude"), { recursive: true });
  await writeFile(path.join(workspaceDir, ".claude", "settings.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

describe.sequential("claude settings integration", () => {
  it("creates settings.json with hooks and mcpServers plus a partial-json manifest entry", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-create-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        PostToolUse: [{ matcher: "Edit|Write", run: "echo edit" }],
        Stop: [{ run: "echo stop" }]
      },
      mcp: {
        servers: {
          beta: {
            command: "node",
            args: ["beta.js"],
            env: {}
          },
          alpha: {
            command: "npx",
            args: ["alpha"],
            env: {
              TOKEN: "${TOKEN}"
            }
          }
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [
          { path: ".claude/settings.json", reason: "new" },
          { path: "CLAUDE.md", reason: "new" }
        ],
        modified: [],
        removed: [],
        unchanged: []
      });

      const settings = await readSettings(workspaceDir);
      expect(settings).toEqual({
        hooks: {
          PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "echo edit" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }]
        },
        mcpServers: {
          alpha: {
            command: "npx",
            args: ["alpha"],
            env: {
              TOKEN: "${TOKEN}"
            }
          },
          beta: {
            command: "node",
            args: ["beta.js"],
            env: {}
          }
        }
      });

      const manifest = await loadManifest(workspaceDir);
      expect(manifest.files).toEqual([
        {
          kind: "partial-json",
          mode: 0o644,
          owned_keys: ["hooks", "mcpServers"],
          owned_sha256: expect.any(String),
          path: ".claude/settings.json"
        },
        {
          mode: 0o644,
          path: "CLAUDE.md",
          sha256: expect.any(String)
        }
      ]);
    });
  });

  it("requires --adopt-settings before taking ownership of an existing shared settings file", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-adopt-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        SessionStart: [{ run: "echo session" }]
      },
      mcp: {
        servers: {
          alpha: {
            command: "npx",
            args: ["alpha"],
            env: {}
          }
        }
      }
    });
    await writeSettings(workspaceDir, { theme: "dark" });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync"], syncIo.io)).toBe(1);
      expect(syncIo.stdout).toEqual([]);
      expect(syncIo.stderr[0]).toContain("--adopt-settings");

      const adoptIo = createIo();
      expect(await runCli(["sync", "--adopt-settings", "--json"], adoptIo.io)).toBe(0);
      expect(JSON.parse(adoptIo.stdout[0] ?? "{}").modified).toEqual([{ path: ".claude/settings.json", reason: "sha256-mismatch" }]);

      const settings = await readSettings(workspaceDir);
      expect(settings).toEqual({
        theme: "dark",
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo session" }] }]
        },
        mcpServers: {
          alpha: {
            command: "npx",
            args: ["alpha"],
            env: {}
          }
        }
      });
    });
  });

  it("removes only harness-owned keys when claude-code is disabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-disable-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        Stop: [{ run: "echo stop" }]
      },
      mcp: {
        servers: {
          alpha: {
            command: "npx",
            args: ["alpha"],
            env: {}
          }
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    const existingSettings = await readSettings(workspaceDir);
    await writeSettings(workspaceDir, {
      theme: "dark",
      ...existingSettings
    });
    await writeHarnessConfig(workspaceDir, []);

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [],
        removed: [
          {
            path: ".claude/settings.json",
            reason: "manifest-owned-not-planned"
          },
          {
            path: "CLAUDE.md",
            reason: "manifest-owned-not-planned"
          }
        ],
        unchanged: []
      });

      const settings = await readSettings(workspaceDir);
      expect(settings).toEqual({ theme: "dark" });
    });
  });

  it("drops mcpServers while preserving hooks when the top-level mcp block is removed", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-drop-mcp-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        PostToolUse: [{ matcher: "Edit|Write", run: "echo edit" }]
      },
      mcp: {
        servers: {
          alpha: {
            command: "npx",
            args: ["alpha"],
            env: {}
          }
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        PostToolUse: [{ matcher: "Edit|Write", run: "echo edit" }]
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [{ path: ".claude/settings.json", reason: "sha256-mismatch" }],
        removed: [],
        unchanged: [{ path: "CLAUDE.md", reason: "sha256-match" }]
      });

      const settings = await readSettings(workspaceDir);
      expect(settings).toEqual({
        hooks: {
          PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "echo edit" }] }]
        }
      });
    });
  });

  it("treats owned-field edits as drift but ignores user-only field edits", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-drift-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        PostToolUse: [{ matcher: "Edit|Write", run: "echo edit" }]
      },
      mcp: {
        servers: {
          alpha: {
            command: "npx",
            args: ["alpha"],
            env: {}
          }
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    const tamperedSettings = await readSettings(workspaceDir);
    await writeSettings(workspaceDir, {
      ...tamperedSettings,
      hooks: {
        PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "echo tampered" }] }]
      }
    });

    await withCwd(workspaceDir, async () => {
      const diffIo = createIo();
      expect(await runCli(["diff", "--check"], diffIo.io)).toBe(1);
      expect(diffIo.stdout[0]).toContain("Drift detected.");

      const syncIo = createIo();
      expect(await runCli(["sync"], syncIo.io)).toBe(0);
    });

    const cleanSettings = await readSettings(workspaceDir);
    await writeSettings(workspaceDir, {
      theme: "light",
      ...cleanSettings
    });

    await withCwd(workspaceDir, async () => {
      const diffIo = createIo();
      expect(await runCli(["diff", "--check"], diffIo.io)).toBe(0);
      expect(diffIo.stdout[0]).toContain("No drift detected.");
    });
  });

  it("keeps capabilities add-only while claude-code gains hooks and MCP settings output", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-capabilities-"));

    await withCwd(tempRoot, async () => {
      const capabilitiesIo = createIo();
      expect(await runCli(["adapters", "capabilities", "--json"], capabilitiesIo.io)).toBe(0);

      const report = adaptersCapabilitiesReportSchema.parse(JSON.parse(capabilitiesIo.stdout[0] ?? "{}"));
      expect(report.schema_version).toBe(1);
      expect(report.adapters).toEqual([
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
      ]);
    });
  });

  it("re-requires adoption if a managed settings file is replaced without owned keys", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-readopt-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        SessionStart: [{ run: "echo session" }]
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    await writeSettings(workspaceDir, { theme: "dark" });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync"], syncIo.io)).toBe(1);
      expect(syncIo.stderr[0]).toContain("--adopt-settings");

      const adoptIo = createIo();
      expect(await runCli(["sync", "--adopt-settings"], adoptIo.io)).toBe(0);
    });
  });

  it("renders all supported lifecycle hook fields into Claude settings wire format", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-lifecycle-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        SessionStart: [
          {
            run: "bash .claude/scripts/session-start-check.sh",
            timeout: 10,
            statusMessage: "环境健康扫描..."
          }
        ],
        TaskCompleted: [
          {
            matcher: "",
            run: "bash .claude/scripts/task-completed-check.sh",
            timeout: 15,
            statusMessage: "检查 review 是否已执行..."
          }
        ],
        WorktreeCreate: [
          {
            run: "echo created",
            timeout: 5
          }
        ],
        PostToolUse: [
          {
            matcher: "Edit|Write",
            run: "echo edit",
            timeout: 300,
            statusMessage: "Lint..."
          }
        ],
        Stop: [
          {
            run: "echo stop",
            timeout: 8,
            statusMessage: "清理资源..."
          }
        ]
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync"], syncIo.io)).toBe(0);

      const settings = await readSettings(workspaceDir);
      expect(Object.keys((settings.hooks as Record<string, unknown>) ?? {}).sort((left, right) => left.localeCompare(right))).toEqual([
        "PostToolUse",
        "SessionStart",
        "Stop",
        "TaskCompleted",
        "WorktreeCreate"
      ]);
      expect(settings.hooks).toEqual({
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
        ],
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "bash .claude/scripts/session-start-check.sh",
                timeout: 10,
                statusMessage: "环境健康扫描..."
              }
            ]
          }
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "echo stop",
                timeout: 8,
                statusMessage: "清理资源..."
              }
            ]
          }
        ],
        TaskCompleted: [
          {
            hooks: [
              {
                type: "command",
                command: "bash .claude/scripts/task-completed-check.sh",
                timeout: 15,
                statusMessage: "检查 review 是否已执行..."
              }
            ]
          }
        ],
        WorktreeCreate: [
          {
            hooks: [
              {
                type: "command",
                command: "echo created",
                timeout: 5
              }
            ]
          }
        ]
      });
    });
  });

  it("preserves sailor-style command strings exactly as declared", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-sailor-command-"));
    const workspaceDir = await createWorkspace(tempRoot);
    const command = "jq -r '.result' /tmp/input.json | bash .claude/scripts/task-completed-check.sh";
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        TaskCompleted: [
          {
            run: command,
            timeout: 15,
            statusMessage: "检查 review 是否已执行..."
          }
        ]
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync"], syncIo.io)).toBe(0);

      const settings = await readSettings(workspaceDir);
      expect(settings.hooks).toEqual({
        TaskCompleted: [
          {
            hooks: [
              {
                type: "command",
                command,
                timeout: 15,
                statusMessage: "检查 review 是否已执行..."
              }
            ]
          }
        ]
      });
    });
  });

  it("warns and strips matcher when a non-matcher lifecycle event declares one", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-claude-settings-matcher-warning-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      lifecycleHooks: {
        SessionStart: [
          {
            matcher: "",
            run: "bash .claude/scripts/session-start-check.sh",
            timeout: 10,
            statusMessage: "环境健康扫描..."
          }
        ]
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync"], syncIo.io)).toBe(0);
      expect(syncIo.stderr).toContain(
        "Warning: hook `SessionStart[0]` declares matcher but the event type does not use matcher; field will be ignored on render."
      );

      const settings = await readSettings(workspaceDir);
      expect(settings.hooks).toEqual({
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "bash .claude/scripts/session-start-check.sh",
                timeout: 10,
                statusMessage: "环境健康扫描..."
              }
            ]
          }
        ]
      });
    });
  });
});

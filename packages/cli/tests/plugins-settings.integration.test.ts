import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { adaptersCapabilitiesReportSchema, loadManifest } from "@harness/core";

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
    hooks?: Record<string, Array<{ matcher?: string; run: string; enabled?: boolean }>>;
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
    plugins?: {
      format?: "plugins" | "enabledPlugins";
      marketplaces?: Array<{ id: string; source: string; autoUpdate?: boolean }>;
      enabled?: Array<string | { id: string; scope?: "user" | "project" | "local" }>;
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

  if (options.hooks) {
    document.hooks = options.hooks;
  } else {
    delete document.hooks;
  }

  if (options.mcp) {
    document.mcp = options.mcp;
  } else {
    delete document.mcp;
  }

  if (options.plugins) {
    document.plugins = options.plugins;
  } else {
    delete document.plugins;
  }

  await writeFile(harnessPath, YAML.stringify(document), "utf8");
}

async function readSettings(workspaceDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(workspaceDir, ".claude", "settings.json"), "utf8")) as Record<string, unknown>;
}

async function writeSettings(workspaceDir: string, document: Record<string, unknown>): Promise<void> {
  await mkdir(path.join(workspaceDir, ".claude"), { recursive: true });
  await writeFile(path.join(workspaceDir, ".claude", "settings.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

describe.sequential("plugins settings integration", () => {
  it("renders marketplaces and plugins into claude settings with partial ownership", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-create-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        marketplaces: [
          {
            id: "everything-claude-code",
            source: "github:affaan-m/everything-claude-code",
            autoUpdate: true
          }
        ],
        enabled: ["skill-health@everything-claude-code", { id: "everything-claude-code", scope: "local" }]
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
        marketplaces: {
          "everything-claude-code": {
            autoUpdate: true,
            source: "github:affaan-m/everything-claude-code"
          }
        },
        plugins: [
          {
            enabled: true,
            plugin: "everything-claude-code",
            scope: "local"
          },
          {
            enabled: true,
            plugin: "skill-health@everything-claude-code",
            scope: "user"
          }
        ]
      });

      const manifest = await loadManifest(workspaceDir);
      expect(manifest.files).toEqual([
        {
          kind: "partial-json",
          mode: 0o644,
          owned_keys: ["marketplaces", "plugins"],
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

  it("shrinks the rendered plugins array when one entry is removed", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-remove-entry-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        marketplaces: [{ id: "everything-claude-code", source: "github:affaan-m/everything-claude-code" }],
        enabled: ["skill-health@everything-claude-code", { id: "everything-claude-code", scope: "local" }]
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        marketplaces: [{ id: "everything-claude-code", source: "github:affaan-m/everything-claude-code" }],
        enabled: [{ id: "everything-claude-code", scope: "local" }]
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
        marketplaces: {
          "everything-claude-code": {
            source: "github:affaan-m/everything-claude-code"
          }
        },
        plugins: [
          {
            enabled: true,
            plugin: "everything-claude-code",
            scope: "local"
          }
        ]
      });
    });
  });

  it("removes marketplaces and plugins while preserving other settings-owned keys", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-remove-block-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      hooks: {
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
      },
      plugins: {
        marketplaces: [{ id: "everything-claude-code", source: "github:affaan-m/everything-claude-code" }],
        enabled: ["skill-health@everything-claude-code"]
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      hooks: {
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
          Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }]
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

  it("requires adoption before taking ownership of existing settings fields", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-adopt-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        marketplaces: [{ id: "everything-claude-code", source: "github:affaan-m/everything-claude-code" }],
        enabled: ["skill-health@everything-claude-code"]
      }
    });
    await writeSettings(workspaceDir, {
      marketplaces: {
        custom: {
          source: "file:/tmp/custom-marketplace"
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync"], syncIo.io)).toBe(1);
      expect(syncIo.stderr[0]).toContain("--adopt-settings");
    });
  });

  it("warns on undeclared marketplace references without failing sync", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-warning-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        marketplaces: [{ id: "everything-claude-code", source: "github:affaan-m/everything-claude-code" }],
        enabled: ["skill-health@everything-claude-code", { id: "swift-lsp@claude-plugins-official", scope: "user" }]
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(syncIo.stderr).toEqual(['Warning: plugin "swift-lsp@claude-plugins-official" references undeclared marketplace "claude-plugins-official".']);
    });
  });

  it("warns when plugins are declared but claude-code is not enabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-no-renderer-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, [], {
      plugins: {
        marketplaces: [{ id: "everything-claude-code", source: "github:affaan-m/everything-claude-code" }],
        enabled: ["skill-health@everything-claude-code"]
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(syncIo.stderr).toEqual(["Warning: plugins declared in harness.yaml but no enabled adapter renders them. Enable claude-code."]);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [],
        removed: [],
        unchanged: []
      });
    });
  });

  it("renders sailor-style enabledPlugins object format", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-enabled-plugins-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        format: "enabledPlugins",
        marketplaces: [{ id: "thedotmack", source: "github:thedotmack/claude-mem" }],
        enabled: ["claude-mem@thedotmack"]
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(syncIo.stderr).toEqual([]);

      const settings = await readSettings(workspaceDir);
      expect(settings).toEqual({
        enabledPlugins: {
          "claude-mem@thedotmack": true
        },
        marketplaces: {
          thedotmack: {
            source: "github:thedotmack/claude-mem"
          }
        }
      });
      expect(settings).not.toHaveProperty("plugins");

      const manifest = await loadManifest(workspaceDir);
      expect(manifest.files).toEqual([
        {
          kind: "partial-json",
          mode: 0o644,
          owned_keys: ["enabledPlugins", "marketplaces"],
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

  it("switches plugin settings format between plugins and enabledPlugins without keeping both keys", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-format-switch-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        marketplaces: [{ id: "thedotmack", source: "github:thedotmack/claude-mem" }],
        enabled: [{ id: "claude-mem@thedotmack", scope: "local" }]
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        format: "enabledPlugins",
        marketplaces: [{ id: "thedotmack", source: "github:thedotmack/claude-mem" }],
        enabled: [{ id: "claude-mem@thedotmack", scope: "local" }]
      }
    });

    await withCwd(workspaceDir, async () => {
      const enabledPluginsSync = createIo();
      expect(await runCli(["sync", "--json"], enabledPluginsSync.io)).toBe(0);
      expect(enabledPluginsSync.stderr).toEqual(["Note: enabledPlugins format does not support 'scope'; field will be dropped."]);

      const settings = await readSettings(workspaceDir);
      expect(settings).toEqual({
        enabledPlugins: {
          "claude-mem@thedotmack": true
        },
        marketplaces: {
          thedotmack: {
            source: "github:thedotmack/claude-mem"
          }
        }
      });
      expect(settings).not.toHaveProperty("plugins");
    });

    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      plugins: {
        format: "plugins",
        marketplaces: [{ id: "thedotmack", source: "github:thedotmack/claude-mem" }],
        enabled: ["claude-mem@thedotmack"]
      }
    });

    await withCwd(workspaceDir, async () => {
      const arraySync = createIo();
      expect(await runCli(["sync", "--json"], arraySync.io)).toBe(0);
      expect(arraySync.stderr).toEqual([]);

      const settings = await readSettings(workspaceDir);
      expect(settings).toEqual({
        marketplaces: {
          thedotmack: {
            source: "github:thedotmack/claude-mem"
          }
        },
        plugins: [
          {
            enabled: true,
            plugin: "claude-mem@thedotmack",
            scope: "user"
          }
        ]
      });
      expect(settings).not.toHaveProperty("enabledPlugins");
    });
  });

  it("keeps capability output add-only while adding claude plugins support", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-plugins-settings-capabilities-"));

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
});

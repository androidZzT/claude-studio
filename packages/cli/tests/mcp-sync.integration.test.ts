import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

async function configureWorkspace(
  workspaceDir: string,
  tools: string[],
  mcp:
    | {
        servers: Record<
          string,
          {
            command: string;
            args?: string[];
            env?: Record<string, string>;
          }
        >;
      }
    | undefined
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

  if (mcp) {
    document.mcp = mcp;
  } else {
    delete document.mcp;
  }

  await writeFile(harnessPath, YAML.stringify(document), "utf8");
}

async function createWorkspace(tempRoot: string): Promise<string> {
  const workspaceDir = path.join(tempRoot, "demo");

  await withCwd(tempRoot, async () => {
    const initIo = createIo();
    expect(await runCli(["init", "demo"], initIo.io)).toBe(0);
  });

  return workspaceDir;
}

describe.sequential("mcp sync integration", () => {
  it("renders MCP servers into cursor and codex outputs and keeps diff clean", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-mcp-sync-"));
    const workspaceDir = await createWorkspace(tempRoot);

    await configureWorkspace(workspaceDir, ["codex", "cursor"], {
      servers: {
        beta: {
          command: "node",
          args: ["beta.js"],
          env: {
            B_TOKEN: "${B_TOKEN}"
          }
        },
        alpha: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: {
            GITHUB_TOKEN: "${GITHUB_TOKEN}"
          }
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [
          { path: ".codex/config.toml", reason: "new" },
          { path: ".cursor/mcp.json", reason: "new" },
          { path: ".cursor/rules/main.mdc", reason: "new" },
          { path: "AGENTS.md", reason: "new" }
        ],
        modified: [],
        removed: [],
        unchanged: []
      });

      const cursorMcp = JSON.parse(await readFile(path.join(workspaceDir, ".cursor/mcp.json"), "utf8")) as {
        mcpServers: Record<string, unknown>;
      };
      const codexConfig = await readFile(path.join(workspaceDir, ".codex/config.toml"), "utf8");

      expect(Object.keys(cursorMcp.mcpServers)).toEqual(["alpha", "beta"]);
      expect(codexConfig.indexOf("[mcp_servers.alpha]")).toBeLessThan(codexConfig.indexOf("[mcp_servers.beta]"));
      expect(codexConfig).toContain('env = { GITHUB_TOKEN = "${GITHUB_TOKEN}" }');

      const diffIo = createIo();
      expect(await runCli(["diff", "--json"], diffIo.io)).toBe(0);
      expect(JSON.parse(diffIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [],
        removed: [],
        unchanged: [
          { path: ".codex/config.toml", reason: "sha256-match" },
          { path: ".cursor/mcp.json", reason: "sha256-match" },
          { path: ".cursor/rules/main.mdc", reason: "sha256-match" },
          { path: "AGENTS.md", reason: "sha256-match" }
        ]
      });
    });
  });

  it("updates both cursor and codex MCP renderings when one server is removed", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-mcp-remove-server-"));
    const workspaceDir = await createWorkspace(tempRoot);

    await configureWorkspace(workspaceDir, ["codex", "cursor"], {
      servers: {
        alpha: {
          command: "npx",
          args: ["alpha"],
          env: {}
        },
        beta: {
          command: "node",
          args: ["beta"],
          env: {}
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSyncIo = createIo();
      expect(await runCli(["sync"], initialSyncIo.io)).toBe(0);
    });

    await configureWorkspace(workspaceDir, ["codex", "cursor"], {
      servers: {
        alpha: {
          command: "npx",
          args: ["alpha"],
          env: {}
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      const result = JSON.parse(syncIo.stdout[0] ?? "{}") as {
        modified: Array<{ path: string; reason: string }>;
      };

      expect(result.modified).toEqual([
        { path: ".codex/config.toml", reason: "sha256-mismatch" },
        { path: ".cursor/mcp.json", reason: "sha256-mismatch" }
      ]);

      const cursorMcp = JSON.parse(await readFile(path.join(workspaceDir, ".cursor/mcp.json"), "utf8")) as {
        mcpServers: Record<string, unknown>;
      };
      const codexConfig = await readFile(path.join(workspaceDir, ".codex/config.toml"), "utf8");

      expect(Object.keys(cursorMcp.mcpServers)).toEqual(["alpha"]);
      expect(codexConfig).toContain("[mcp_servers.alpha]");
      expect(codexConfig).not.toContain("[mcp_servers.beta]");

      const diffIo = createIo();
      expect(await runCli(["diff", "--json"], diffIo.io)).toBe(0);
      expect(JSON.parse(diffIo.stdout[0] ?? "{}").modified).toEqual([]);
    });
  });

  it("removes cursor MCP json and strips codex MCP blocks when the MCP block is deleted", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-mcp-delete-block-"));
    const workspaceDir = await createWorkspace(tempRoot);

    await configureWorkspace(workspaceDir, ["codex", "cursor"], {
      servers: {
        alpha: {
          command: "npx",
          args: ["alpha"],
          env: {}
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSyncIo = createIo();
      expect(await runCli(["sync"], initialSyncIo.io)).toBe(0);
    });

    await configureWorkspace(workspaceDir, ["codex", "cursor"], undefined);

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [{ path: ".codex/config.toml", reason: "sha256-mismatch" }],
        removed: [{ path: ".cursor/mcp.json", reason: "manifest-owned-not-planned" }],
        unchanged: [
          { path: ".cursor/rules/main.mdc", reason: "sha256-match" },
          { path: "AGENTS.md", reason: "sha256-match" }
        ]
      });

      await expect(access(path.join(workspaceDir, ".cursor/mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
      const codexConfig = await readFile(path.join(workspaceDir, ".codex/config.toml"), "utf8");
      expect(codexConfig).not.toContain("[mcp_servers.");

      const manifest = await loadManifest(workspaceDir);
      expect(manifest.files.map((file) => file.path)).toEqual([".codex/config.toml", ".cursor/rules/main.mdc", "AGENTS.md"]);
    });
  });

  it("warns when MCP is declared but no enabled adapter renders it", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-mcp-claude-only-"));
    const workspaceDir = await createWorkspace(tempRoot);

    await configureWorkspace(workspaceDir, [], {
      servers: {
        alpha: {
          command: "npx",
          args: ["alpha"],
          env: {}
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(syncIo.stderr.some((line) => line.includes("no enabled adapter renders MCP"))).toBe(true);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [],
        removed: [],
        unchanged: []
      });
    });
  });

  it("keeps capabilities add-only while adding cursor MCP support", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-mcp-capabilities-"));

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

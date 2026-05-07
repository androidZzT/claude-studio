import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

async function createWorkspace(tempRoot: string, name = "demo"): Promise<string> {
  const workspaceDir = path.join(tempRoot, name);

  await withCwd(tempRoot, async () => {
    const initIo = createIo();
    expect(await runCli(["init", name], initIo.io)).toBe(0);
  });

  return workspaceDir;
}

async function writeHarnessConfig(
  workspaceDir: string,
  tools: string[],
  referenceProjects?: {
    description?: string;
    projects: Record<string, { path: string; git_url?: string; description?: string }>;
  }
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

  if (referenceProjects) {
    document.reference_projects = referenceProjects;
  } else {
    delete document.reference_projects;
  }

  await writeFile(harnessPath, YAML.stringify(document), "utf8");
}

async function readReferenceProjects(workspaceDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(workspaceDir, ".claude", "reference-project.json"), "utf8")) as Record<string, unknown>;
}

describe.sequential("reference projects integration", () => {
  it("renders a sailor-like reference-project registry", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-reference-projects-create-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      description: "test",
      projects: {
        sailor_fe_c_ios: {
          path: "../sailor_fe_c_ios",
          git_url: "ssh://git@example.com/ios",
          description: "iOS"
        },
        sailor_fe_c_android: {
          path: "../sailor_fe_c_android",
          git_url: "ssh://git@example.com/android"
        },
        sailor_fe_c_kmp: {
          path: "../sailor_fe_c_kmp"
        }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [
          { path: ".claude/reference-project.json", reason: "new" },
          { path: "CLAUDE.md", reason: "new" }
        ],
        modified: [],
        removed: [],
        unchanged: []
      });

      const rendered = await readReferenceProjects(workspaceDir);
      expect(rendered).toEqual({
        description: "test",
        projects: {
          sailor_fe_c_android: {
            path: "../sailor_fe_c_android",
            git_url: "ssh://git@example.com/android"
          },
          sailor_fe_c_ios: {
            path: "../sailor_fe_c_ios",
            git_url: "ssh://git@example.com/ios",
            description: "iOS"
          },
          sailor_fe_c_kmp: {
            path: "../sailor_fe_c_kmp"
          }
        }
      });

      const manifest = await loadManifest(workspaceDir);
      expect(manifest.files).toEqual([
        {
          mode: 0o644,
          path: ".claude/reference-project.json",
          sha256: expect.any(String)
        },
        {
          mode: 0o644,
          path: "CLAUDE.md",
          sha256: expect.any(String)
        }
      ]);
    });
  });

  it("rewrites the reference-project file when one project is removed", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-reference-projects-modify-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      projects: {
        proj_a: { path: "../a" },
        proj_b: { path: "../b" }
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      projects: {
        proj_b: { path: "../b" }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [{ path: ".claude/reference-project.json", reason: "sha256-mismatch" }],
        removed: [],
        unchanged: [{ path: "CLAUDE.md", reason: "sha256-match" }]
      });

      const rendered = await readReferenceProjects(workspaceDir);
      expect(rendered).toEqual({
        projects: {
          proj_b: {
            path: "../b"
          }
        }
      });
    });
  });

  it("removes the generated reference-project file when the top-level block is deleted", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-reference-projects-remove-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["claude-code"], {
      projects: {
        proj_a: { path: "../a" }
      }
    });

    await withCwd(workspaceDir, async () => {
      const initialSync = createIo();
      expect(await runCli(["sync"], initialSync.io)).toBe(0);
    });

    await writeHarnessConfig(workspaceDir, ["claude-code"]);

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [],
        modified: [],
        removed: [{ path: ".claude/reference-project.json", reason: "manifest-owned-not-planned" }],
        unchanged: [{ path: "CLAUDE.md", reason: "sha256-match" }]
      });
    });
  });

  it("warns and skips rendering when reference_projects are declared without claude-code enabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-reference-projects-no-renderer-"));
    const workspaceDir = await createWorkspace(tempRoot);
    await writeHarnessConfig(workspaceDir, ["codex"], {
      projects: {
        proj_a: { path: "../a" }
      }
    });

    await withCwd(workspaceDir, async () => {
      const syncIo = createIo();
      expect(await runCli(["sync", "--json"], syncIo.io)).toBe(0);
      expect(syncIo.stderr).toEqual([
        "Warning: reference_projects declared in harness.yaml but no enabled adapter renders them. Enable claude-code."
      ]);
      expect(JSON.parse(syncIo.stdout[0] ?? "{}")).toEqual({
        added: [
          { path: ".codex/config.toml", reason: "new" },
          { path: "AGENTS.md", reason: "new" }
        ],
        modified: [],
        removed: [],
        unchanged: []
      });
    });
  });

  it("keeps capability output add-only while adding claude reference projects support", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-reference-projects-capabilities-"));

    await withCwd(tempRoot, async () => {
      const capabilitiesIo = createIo();
      expect(await runCli(["adapters", "capabilities", "--json"], capabilitiesIo.io)).toBe(0);

      const report = adaptersCapabilitiesReportSchema.parse(JSON.parse(capabilitiesIo.stdout[0] ?? "{}"));
      expect(report.schema_version).toBe(1);
      expect(report.adapters).toEqual([
        {
          id: "claude-code",
          features: [
            "claude-agents-md",
            "claude-commands-md",
            "claude-docs",
            "claude-hooks",
            "claude-mcp",
            "claude-md",
            "claude-metrics",
            "claude-plugins",
            "claude-reference-projects",
            "claude-rules-md",
            "claude-scripts",
            "claude-skills"
          ]
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

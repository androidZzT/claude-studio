import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadHarnessConfig, parseHarnessConfig } from "../src/index.js";

describe("harness config", () => {
  it("parses a minimal harness config document", () => {
    const config = parseHarnessConfig(`
name: demo
tools:
  - codex
env:
  required:
    - cmd: node
      min: "20.0.0"
canonical:
  instructions: ./AGENTS.md
`);

    expect(config).toMatchObject({
      name: "demo",
      scope: "project",
      tools: ["codex"],
      canonical: {
        instructions: "./AGENTS.md"
      }
    });
  });

  it("loads harness.yaml from disk", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "harness-config-"));
    const configPath = path.join(directory, "harness.yaml");

    await writeFile(configPath, "name: fixture\n");

    const loaded = await loadHarnessConfig(directory);

    expect(loaded.path).toBe(configPath);
    expect(loaded.config).toMatchObject({
      name: "fixture",
      scope: "project",
      tools: [],
      canonical: {
        instructions: "./AGENTS.md.template"
      },
      hooks: {},
      adapters: {}
    });
  });

  it("deep-merges harness.local.yaml and lets lists override as a whole", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "harness-config-local-"));
    await writeFile(
      path.join(directory, "harness.yaml"),
      `
name: fixture
tools:
  - claude-code
models:
  default: sonnet
  agents:
    architect: opus
    android-coder: sonnet
projects:
  targets:
    android:
      path: ../transaction_android
      git_url: ssh://git@example.com/android
      module_paths:
        - app/**
        - feature/**
      commands:
        compile: ./scripts/harness/compile.sh
        package: ./scripts/harness/package-release.sh
    ios:
      path: ../transaction_ios
dispatch:
  patterns:
    - match: "\${targets.android.path}/**/*.kt"
      agent: android-coder
`,
      "utf8"
    );
    await writeFile(
      path.join(directory, "harness.local.yaml"),
      `
models:
  agents:
    architect: haiku
projects:
  targets:
    android:
      path: /tmp/test-android
      module_paths:
        - app-local/**
`,
      "utf8"
    );

    const loaded = await loadHarnessConfig(directory);

    expect(loaded.localPath).toBe(path.join(directory, "harness.local.yaml"));
    expect(loaded.config.projects?.targets.android?.path).toBe("/tmp/test-android");
    expect(loaded.config.projects?.targets.android?.git_url).toBe("ssh://git@example.com/android");
    expect(loaded.config.projects?.targets.android?.module_paths).toEqual(["app-local/**"]);
    expect(loaded.config.projects?.targets.android?.commands).toEqual({
      compile: "./scripts/harness/compile.sh",
      package: "./scripts/harness/package-release.sh"
    });
    expect(loaded.config.projects?.targets.ios?.path).toBe("../transaction_ios");
    expect(loaded.config.models?.["claude-code"]?.agents.architect).toBe("haiku");
    expect(loaded.config.models?.["claude-code"]?.agents["android-coder"]).toBe("sonnet");
    expect(loaded.config.dispatch?.patterns[0]?.match).toBe("/tmp/test-android/**/*.kt");
  });

  it("parses schema v2 agent tool routing and per-tool model profiles", () => {
    const config = parseHarnessConfig(`
schema_version: 2
name: fixture
tools:
  - claude-code
  - codex
agent_tools:
  default: claude-code
  agents:
    architect: claude-code
    android-coder: codex
models:
  claude-code:
    default: sonnet
    agents:
      architect:
        model: opus
  codex:
    default:
      model: gpt-5-codex
      effort: high
      sandbox_mode: workspace-write
      approval_policy: never
    agents:
      android-coder:
        effort: high
        sandbox_mode: workspace-write
`);

    expect(config.schema_version).toBe(2);
    expect(config.agent_tools).toEqual({
      default: "claude-code",
      agents: {
        architect: "claude-code",
        "android-coder": "codex"
      }
    });
    expect(config.models?.["claude-code"]?.default).toBe("sonnet");
    expect(config.models?.["claude-code"]?.agents.architect).toEqual({ model: "opus" });
    expect(config.models?.codex?.default).toEqual({
      model: "gpt-5-codex",
      effort: "high",
      sandbox_mode: "workspace-write",
      approval_policy: "never"
    });
    expect(config.models?.codex?.agents["android-coder"]).toEqual({
      effort: "high",
      sandbox_mode: "workspace-write"
    });
  });

  it("normalizes legacy v1 models with a deprecation warning", () => {
    const warnings: string[] = [];
    const config = parseHarnessConfig(
      `
name: fixture
tools:
  - claude-code
models:
  default: sonnet
  agents:
    architect: opus
`,
      {
        onWarning(message) {
          warnings.push(message);
        }
      }
    );

    expect(config.models).toEqual({
      "claude-code": {
        default: "sonnet",
        agents: {
          architect: "opus"
        }
      }
    });
    expect(warnings).toEqual([
      "Warning: harness.yaml models.default/models.agents are deprecated; use schema_version: 2 models.<tool>.default/models.<tool>.agents."
    ]);
  });

  it("rejects agent tool assignments that are invalid or not enabled", () => {
    expect(() =>
      parseHarnessConfig(`
schema_version: 2
name: fixture
tools:
  - claude-code
agent_tools:
  default: unknown-tool
`)
    ).toThrow();

    expect(() =>
      parseHarnessConfig(`
schema_version: 2
name: fixture
tools:
  - claude-code
agent_tools:
  default: claude-code
  agents:
    android-coder: codex
`)
    ).toThrow(/must be listed in tools/);
  });

  it("rejects model buckets for invalid tool names", () => {
    expect(() =>
      parseHarnessConfig(`
schema_version: 2
name: fixture
tools:
  - claude-code
models:
  unknown-tool:
    default: opus
`)
    ).toThrow();
  });

  it("skips harness.local.yaml when requested", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "harness-config-no-local-"));
    await writeFile(
      path.join(directory, "harness.yaml"),
      `
name: fixture
projects:
  targets:
    android:
      path: ../transaction_android
dispatch:
  patterns:
    - match: "\${targets.android.path}/**/*.kt"
      agent: android-coder
`,
      "utf8"
    );
    await writeFile(
      path.join(directory, "harness.local.yaml"),
      `
projects:
  targets:
    android:
      path: /tmp/test-android
`,
      "utf8"
    );

    const loaded = await loadHarnessConfig(directory, undefined, { noLocal: true });

    expect(loaded.localPath).toBeUndefined();
    expect(loaded.config.projects?.targets.android?.path).toBe("../transaction_android");
    expect(loaded.config.dispatch?.patterns[0]?.match).toBe("../transaction_android/**/*.kt");
  });

  it("preserves unresolved placeholders during interpolation", () => {
    const config = parseHarnessConfig(`
name: fixture
dispatch:
  patterns:
    - match: "\${targets.missing.path}/**/*.kt"
      agent: android-coder
`);

    expect(config.dispatch?.patterns[0]?.match).toBe("${targets.missing.path}/**/*.kt");
  });

  it("parses isolated parallel cross-platform dispatch policy", () => {
    const config = parseHarnessConfig(`
name: fixture
dispatch:
  patterns: []
  cross_platform_policy: split_isolated_parallel
`);

    expect(config.dispatch?.cross_platform_policy).toBe("split_isolated_parallel");
  });

  it("parses no-active-context visibility rules", () => {
    const config = parseHarnessConfig(`
name: fixture
context:
  no_active_context:
    - path: docs/archive/
      reason: Historical experiment output.
    - path: docs/research/**
      mode: soft_ignore
`);

    expect(config.context?.no_active_context).toEqual([
      {
        path: "docs/archive/",
        reason: "Historical experiment output.",
        mode: "deny_read"
      },
      {
        path: "docs/research/**",
        mode: "soft_ignore"
      }
    ]);
  });

  it("parses claude lifecycle hooks with defaults and matchers", () => {
    const config = parseHarnessConfig(`
name: demo
tools:
  - claude-code
hooks:
  SessionStart:
    - run: echo session
  PostToolUse:
    - matcher: Edit|Write
      run: echo edit
    - run: echo any
      enabled: false
`);

    expect(config.hooks).toEqual({
      SessionStart: [{ enabled: true, run: "echo session" }],
      PostToolUse: [
        { enabled: true, matcher: "Edit|Write", run: "echo edit" },
        { enabled: false, run: "echo any" }
      ]
    });
  });
});

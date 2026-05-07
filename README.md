<div align="center">
  <img src="docs/assets/screenshots/welcome.png" width="720" alt="harness-studio" style="border-radius: 16px;">
  <h1>harness-studio</h1>
  <p><strong>Cross-platform harness environment manager for agentic coding teams.</strong></p>
  <p><em>Map one harness project to Claude Code, Codex, Cursor, and other agent runtimes while managing multi-agent workflows visually.</em></p>

  <p>
    <a href="https://www.npmjs.com/package/harness-studio"><img src="https://img.shields.io/npm/v/harness-studio?color=blue&style=flat-square&logo=npm" alt="npm"></a>
    <a href="https://www.npmjs.com/package/harness-studio"><img src="https://img.shields.io/npm/dm/harness-studio?color=green&style=flat-square" alt="Downloads"></a>
    <a href="https://github.com/androidZzT/harness-studio/stargazers"><img src="https://img.shields.io/github/stars/androidZzT/harness-studio?style=flat-square" alt="Stars"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/androidZzT/harness-studio?style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="Platform">
  </p>

  <p>If you find this useful, please ⭐ <a href="https://github.com/androidZzT/claude-studio/stargazers">star this repo</a> — it helps others discover it!</p>

  <p>
    <a href="#features">Features</a> &bull;
    <a href="#positioning">Positioning</a> &bull;
    <a href="#screenshots">Screenshots</a> &bull;
    <a href="#quick-start">Quick Start</a> &bull;
    <a href="#how-it-works">How It Works</a> &bull;
    <a href="README_CN.md">中文</a>
  </p>
</div>

---

## Features

- 🧭 **Harness Project Model** — Treat one repository-level harness project as the source of truth for agents, workflows, skills, prompts, run history, and platform mappings
- 🔁 **Platform Adapters** — Materialize the same harness intent into Claude Code (`.claude/`), Codex, Cursor, and future agent runtime environments
- 🔀 **Visual Workflow Editor** — Drag-and-drop DAG editor for multi-agent phase orchestration, dependencies, checkpoints, and parallel branches
- 📈 **Run Visualization** — Inspect `.harness/runs` with node status, prompts, logs, tool calls, skill use, validation, rollback, and artifacts
- 🤖 **Agent Management** — Create, edit, delete agents with built-in templates and platform-aware metadata
- ⚡ **Skill & Tooling Management** — Create reusable skills and bind MCP/tools to workflow nodes
- 🚀 **Execution View** — Track running/succeeded/failed/blocked phases with real-time-ish run store inspection
- 🪄 **AI Generation** — Describe what you want and generate workflow/agent/skill drafts for the harness project
- 🔌 **MCP & Settings** — Visual config for MCP servers, hooks, permissions, and runtime-specific settings
- 📦 **Environment Export** — Export or sync the harness project into platform-specific files
- 🧠 **Memory Inspector** — Read-only view of project memories with delete capability
- 🎯 **CLAUDE.md Sync** — Current Claude Code adapter syncs workflows into `CLAUDE.md`
- 🌓 **Theme Switching** — Dark, Light, and System theme modes
- ⚙️ **Project-level Config** — Manage shared and local agent-runtime configuration per project

---

## Positioning

harness-studio is not just a GUI for one agent CLI. The target product is a **cross-platform harness environment management platform**:

| Layer | Purpose |
|---|---|
| Harness project | The shared source of truth: workflow phases, agent roles, skills, prompts, run store, validation, rollback, and platform mappings |
| Platform adapters | Translate the harness project into runtime-specific environments such as Claude Code `.claude/`, Codex config, Cursor rules/prompts, and future tools |
| Workflow visualizer | Shows both design-time DAGs and real execution runs from `.harness/runs` |
| Multi-agent operations | Manages phase status, prompts, logs, tool traces, skill use, artifacts, gates, checkpoints, and recovery paths |

Current implementation already supports the Claude Code-compatible `.claude/` adapter and real `.harness/runs` visualization. Codex and Cursor are the next adapter targets: the model should stay platform-neutral even when an individual adapter writes platform-specific files.

See [docs/product/positioning.md](docs/product/positioning.md) for the platform model.

---

## Harness CLI Integration

harness-studio is the control plane; `harness-cli` is the execution and governance data plane.

| Responsibility | Owner |
|---|---|
| Parse compound `SKILL.md` phases, gates, audits, checkpoints, TaskCard, dry-run preflight | `harness-cli` |
| Execute autonomous runs across Claude Code / Codex tools | `harness-cli` |
| Write `.harness/runs` artifacts, trajectories, validation, rollback, run-family metadata | `harness-cli` |
| Read and visualize run DAGs, node status, prompts, logs, traces, skills, tools, artifacts | `harness-studio` |
| Project one harness environment into platform-specific files | `harness-studio` adapters |

The Studio API now includes project-scoped `harness-cli` bridge endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/projects/:id/harness-cli` | Check whether `harness` is available for this project |
| `POST /api/projects/:id/harness-cli/dry-run` | Run `harness run --dry-run ... --json` |
| `POST /api/projects/:id/harness-cli/inspect` | Run `harness run inspect <threadId> --json` |
| `POST /api/projects/:id/harness-cli/view` | Run `harness run view <threadId> --json` |

Use `HARNESS_CLI_BIN=/path/to/harness` when the executable is not on `PATH`.

Long-running real execution should be wired as a streamed job on top of `harness run`; the existing Studio `/api/execute` runner remains legacy and should not become the source of truth.

## Monorepo Layout

This repository now contains both the Studio control plane and the Harness CLI data plane.

| Path | Purpose |
|---|---|
| `src/` | Next.js web app, API routes, and Studio UI |
| `extensions/vscode/` | VS Code extension host integration |
| `packages/studio-core/` | Shared Studio readers/parsers used by Web and VS Code |
| `packages/core/` | Imported `@harness/core` runtime model and shared CLI logic |
| `packages/cli/` | Imported `harness` CLI package |
| `docs/` | Product, architecture, guides, and organized Harness CLI/Core docs |
| `scripts/harness-cli/` | Monorepo-aware build helpers for the CLI packages |

Useful commands:

```bash
npm run harness:build       # Build packages/core + packages/cli
npm run harness:typecheck   # Type-check the CLI/core packages
npm run harness:test        # Run imported harness-cli test suite
npm run verify:visual-workflow
npm run monorepo:build      # Build CLI, studio-core, and the web app
```

Studio can call the in-repo CLI directly with:

```bash
HARNESS_CLI_BIN=$PWD/packages/cli/dist/cli.js npm run dev -- -p 3100
```

---

## Screenshots

<table>
  <tr>
    <td align="center"><strong>Dark Mode</strong></td>
    <td align="center"><strong>Light Mode</strong></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/guide-dark.png" alt="Dark Mode" width="100%"></td>
    <td><img src="docs/assets/screenshots/guide-light.png" alt="Light Mode" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>Workflow DAG</strong></td>
    <td align="center"><strong>Project Workspace</strong></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/workflow-dag.png" alt="Workflow DAG" width="100%"></td>
    <td><img src="docs/assets/screenshots/project-workspace.png" alt="Project Workspace" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>Node Editor</strong></td>
    <td align="center"><strong>Project Config</strong></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/agent-node.png" alt="Node Editor" width="100%"></td>
    <td><img src="docs/assets/screenshots/project-settings.png" alt="Project Config" width="100%"></td>
  </tr>
</table>

---

## Quick Start

```bash
npx harness-studio
```

Or with custom port:

```bash
npx harness-studio --port 3200
```

### Development

```bash
git clone https://github.com/androidZzT/harness-studio.git
cd harness-studio
npm install
npm run dev -- -p 3100
```

### VS Code Extension (MVP)

A starter VS Code extension is available under `extensions/vscode`.

```bash
npm install
npm --prefix extensions/vscode install
npm run vscode:build
```

Then open `extensions/vscode` in VS Code and press `F5` to launch an Extension Development Host.
Use command palette:

- `Harness Studio: Start Server`
- `Harness Studio: Open`
- `Harness Studio: Show Logs`

For iterative extension development, run `npm run vscode:watch` in the repo root.

---

## How It Works

harness-studio treats the harness project as the canonical model, then maps that model into platform-specific runtime files.

| Harness concept | Current Claude Code adapter | Codex / Cursor adapter direction |
|---|---|---|
| Agent | `.claude/agents/name.md` | Runtime-specific agent prompt/profile files |
| Skill | `.claude/skills/name.md` | Reusable command/tool instructions |
| Workflow | `.claude/workflows/name.md` and `CLAUDE.md` references | Platform-neutral phase graph projected into platform rules/tasks |
| Run store | `.harness/runs/<runId>` | Shared execution telemetry source |
| Settings | `.claude/settings.json` | Runtime-specific settings, permissions, MCP/tool bindings |

### Workflow

1. **Open a harness project** — point to a repository with `.harness/`, `.claude/`, or an existing agent setup
2. **Create agents** — from built-in templates or AI generation
3. **Build workflow** — drag agents onto canvas, connect dependencies, model parallel groups, or **use Generate** (see below)
4. **Bind skills & tools** — attach skills, MCP servers, and runtime tool capabilities to nodes
5. **Inspect runs** — select a `.harness/runs` execution and inspect node status, prompts, logs, traces, validation, and artifacts
6. **Materialize environments** — sync/export the harness project to Claude Code today, and to Codex/Cursor adapters as they land

### AI Generate

Describe what you want in plain text and generate a complete workflow draft. No manual node creation needed — type a description like *"Code review pipeline with security check"* or *"TDD workflow for KMP project"*, hit **Generate**, and get a full DAG with agents, edges, skills, and checkpoints. You can then fine-tune the result visually.

### Platform Adapters

The current adapter writes Claude Code-compatible files and can sync workflows into `CLAUDE.md`. The intended architecture keeps this as one adapter among several:

```
harness project (source of truth)
  → Claude Code adapter (.claude/, CLAUDE.md)
  → Codex adapter (planned)
  → Cursor adapter (planned)
  → .harness/runs (shared execution telemetry)
```

---

## Architecture

```
┌─────────────────────────────────┐
│  GUI (React + React Flow v12)   │
├─────────────────────────────────┤
│  Studio Core + API / VS Code    │
├─────────────────────────────────┤
│  Harness Project Model          │
├─────────────────────────────────┤
│  harness-cli Runtime/Governance │
├─────────────────────────────────┤
│  Platform Adapters              │
│  Claude Code · Codex · Cursor   │
├─────────────────────────────────┤
│  .harness/runs telemetry        │
└─────────────────────────────────┘
```

Tech stack: Next.js · React Flow v12 · Monaco Editor · TypeScript · Tailwind CSS · Lucide Icons

Architecture migration is in progress toward a `studio-core` + adapter model:
see [docs/architecture/studio-core-migration.md](docs/architecture/studio-core-migration.md).

## Edge Types

| Type | Visual | Purpose |
|------|--------|---------|
| Dispatch | Solid gray | Task assignment, execution dependency |
| Report | Dashed cyan | Feedback / results reporting |
| Sync | Dotted purple | Peer-to-peer collaboration |
| Roundtrip | Solid teal, double arrow | Bidirectional dispatch + report |

## License

MIT

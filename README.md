<div align="center">
  <img src="docs/welcome.png" width="720" alt="claude-studio" style="border-radius: 16px;">
  <h1>claude-studio</h1>
  <p><strong>Visual orchestration platform for Claude Code Agent Teams.</strong></p>
  <p><em>Design, manage, and execute multi-agent workflows through an intuitive DAG editor.</em></p>

  <p>
    <a href="https://www.npmjs.com/package/claude-code-studio"><img src="https://img.shields.io/npm/v/claude-code-studio?color=blue&style=flat-square&logo=npm" alt="npm"></a>
    <a href="https://www.npmjs.com/package/claude-code-studio"><img src="https://img.shields.io/npm/dm/claude-code-studio?color=green&style=flat-square" alt="Downloads"></a>
    <a href="https://github.com/androidZzT/claude-studio/stargazers"><img src="https://img.shields.io/github/stars/androidZzT/claude-studio?style=flat-square" alt="Stars"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/androidZzT/claude-studio?style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="Platform">
  </p>

  <p>
    <a href="#-features">Features</a> &bull;
    <a href="#%EF%B8%8F-screenshots">Screenshots</a> &bull;
    <a href="#-quick-start">Quick Start</a> &bull;
    <a href="#-how-it-works">How It Works</a> &bull;
    <a href="README_CN.md">中文</a>
  </p>
</div>

---

## Features

- 🔀 **Visual Workflow Editor** — Drag-and-drop DAG editor with 4 edge types (dispatch / report / sync / roundtrip)
- 🤖 **Agent Management** — Create, edit, delete agents with 9 built-in templates
- ⚡ **Skill Management** — Create skills with templates, bind to agent nodes
- 🚀 **Execution Engine** — Run workflows with real-time status, checkpoint approval
- 🪄 **AI Generation** — Describe what you want, Claude generates workflow/agent/skill via `claude -p`
- 🔌 **MCP & Settings** — Visual config for MCP servers, hooks, permissions
- 📦 **Plugin Export** — Export project as standard Claude Code plugin package
- 🧠 **Memory Inspector** — Read-only view of project memories with delete capability
- 🎯 **CLAUDE.md Sync** — Workflows auto-sync to CLAUDE.md for Claude Code integration
- 🌓 **Theme Switching** — Dark, Light, and System theme modes
- ⚙️ **Project-level Config** — Manage shared and local Claude configuration per project

---

## Screenshots

<table>
  <tr>
    <td align="center"><strong>Dark Mode</strong></td>
    <td align="center"><strong>Light Mode</strong></td>
  </tr>
  <tr>
    <td><img src="docs/guide-dark.png" alt="Dark Mode" width="100%"></td>
    <td><img src="docs/guide-light.png" alt="Light Mode" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>Workflow DAG</strong></td>
    <td align="center"><strong>Project Workspace</strong></td>
  </tr>
  <tr>
    <td><img src="docs/workflow-dag.png" alt="Workflow DAG" width="100%"></td>
    <td><img src="docs/project-workspace.png" alt="Project Workspace" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>Node Editor</strong></td>
    <td align="center"><strong>Project Config</strong></td>
  </tr>
  <tr>
    <td><img src="docs/agent-node.png" alt="Node Editor" width="100%"></td>
    <td><img src="docs/project-settings.png" alt="Project Config" width="100%"></td>
  </tr>
</table>

---

## Quick Start

```bash
npx claude-code-studio
```

Or with custom port:

```bash
npx claude-code-studio --port 3200
```

### Development

```bash
git clone https://github.com/androidZzT/claude-studio.git
cd claude-studio
npm install
npm run dev -- -p 3100
```

---

## How It Works

claude-studio is a GUI for the `~/.claude/` directory — the same directory Claude Code reads at runtime. Everything you create in the studio is written directly to `.claude/` as standard files:

| You create in studio | Saved as | Claude Code reads it as |
|---|---|---|
| Agent | `.claude/agents/name.md` | Agent definition (spawnable via `Agent` tool) |
| Skill | `.claude/skills/name.md` | Slash command (`/skill-name`) |
| Workflow | `.claude/workflows/name.yaml` | Team orchestration blueprint |
| CLAUDE.md edits | `CLAUDE.md` | Project instructions |
| Settings | `.claude/settings.json` | MCP servers, hooks, permissions |

### Workflow

1. **Open a project** — point to any directory with `.claude/` (or create one)
2. **Create agents** — from 9 built-in templates or AI generation
3. **Build workflow** — drag agents onto canvas, connect with 4 edge types, or **use Generate** (see below)
4. **Bind skills & MCPs** — drag from panel onto agent nodes
5. **Run** — execute with real-time status and checkpoint approval
6. **Use in Claude Code** — open the same project in Claude Code, your agents/skills/workflows are ready

### AI Generate

Describe what you want in plain text, and Claude generates a complete workflow for you via `claude -p`. No manual node creation needed — just type a description like *"Code review pipeline with security check"* or *"TDD workflow for KMP project"*, hit **Generate**, and get a full DAG with agents, edges, skills, and checkpoints. You can then fine-tune the result visually.

### Integration with CLAUDE.md

When you save a workflow, claude-studio **auto-syncs** it into `CLAUDE.md`. This means Claude Code automatically sees your team structure, agent roles, and workflow definitions when it starts. You design the team visually, Claude Code executes it.

```
claude-studio (design) → ~/.claude/ (files) → Claude Code (runtime)
```

---

## Architecture

```
┌─────────────────────────────────┐
│  GUI (React + React Flow v12)   │
├─────────────────────────────────┤
│  Next.js API Routes             │
├─────────────────────────────────┤
│  ~/.claude/ (source of truth)   │
├─────────────────────────────────┤
│  Claude Code (runtime)          │
└─────────────────────────────────┘
```

Tech stack: Next.js · React Flow v12 · Monaco Editor · TypeScript · Tailwind CSS · Lucide Icons

## Edge Types

| Type | Visual | Purpose |
|------|--------|---------|
| Dispatch | Solid gray | Task assignment, execution dependency |
| Report | Dashed cyan | Feedback / results reporting |
| Sync | Dotted purple | Peer-to-peer collaboration |
| Roundtrip | Solid teal, double arrow | Bidirectional dispatch + report |

## License

MIT

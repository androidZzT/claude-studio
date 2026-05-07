# Harness Studio Product Positioning

## One-liner

Harness Studio is a cross-platform harness environment manager for agentic coding teams. It uses one harness project to manage agents, skills, prompts, workflows, run telemetry, and platform-specific projections for Claude Code, Codex, Cursor, and future agent runtimes.

## Product Thesis

Agent coding tools are converging on the same operational needs:

- A stable project-level environment for agents, skills, tools, prompts, permissions, and memory.
- A way to map that environment into each runtime's native file format.
- A multi-agent workflow model that can be designed, inspected, and recovered.
- A real run store that captures prompts, logs, tool calls, skill use, validation, rollback, and final artifacts.

Harness Studio should own the layer above individual agent CLIs. Claude Code, Codex, and Cursor become platform adapters, not separate product silos. `harness-cli` is the runtime/governance engine below Studio: it executes phases, captures run artifacts, and writes the run store that Studio visualizes.

## Core Model

| Concept | Meaning |
|---|---|
| Harness project | The source of truth for a repository's agent environment. |
| Platform adapter | A projection from the harness project into one runtime's native files and conventions. |
| Workflow | A platform-neutral multi-agent DAG made of phases, dependencies, parallel groups, checkpoints, and gates. |
| Run store | `.harness/runs/<runId>`, the shared execution telemetry and artifact source. |
| Visualizer | The UI layer that shows design-time workflows and real execution state. |
| Harness CLI runtime | The execution/governance data plane that runs phase graphs and writes `.harness/runs`. |

## Studio + CLI Split

| Area | harness-cli | harness-studio |
|---|---|---|
| Phase execution | Owns `harness run`, resume, checkpoints, gates, audits, provider stall handling, validation, rollback guidance | Starts/observes execution through CLI bridge or run store |
| Data source | Writes `phase_graph.json`, `state.json`, `events.jsonl`, `phases/*`, `trajectory/*`, `validation/*`, `rollback/*` | Reads run store into a visual model |
| Environment model | Consumes compound `SKILL.md`, TaskCard, config, tool/profile routing | Edits, maps, and visualizes one harness environment across platforms |
| UX | CLI commands and generated HTML/Mermaid reports | Interactive DAG, inspector, VS Code/web panels, platform projection views |

The product should avoid creating a second execution engine in Studio. The old Studio live runner can remain for legacy/manual workflows, but the canonical autonomous runtime is `harness-cli`.

## Monorepo Boundary

The product should now evolve as one monorepo, with clear package ownership:

| Package / area | Boundary |
|---|---|
| Root `src/` | Interactive Studio product: web UI, API routes, visualizer, project settings, and platform adapter UX. |
| `extensions/vscode/` | VS Code shell for opening Studio against a local workspace. |
| `packages/studio-core/` | Read-only Studio domain model, workflow readers, run-store readers, and CLI bridge helpers shared by Web and VS Code. |
| `packages/core/` | Harness runtime schema, project model, validation, templates, and reusable execution primitives. |
| `packages/cli/` | `harness` command-line surface for execution, inspection, dry-run, reports, and governance workflows. |

The merge should not blur responsibilities. Studio may start, inspect, and visualize CLI runs, but execution semantics, run-store schema, checkpoints, gates, and rollback guidance should remain owned by the CLI/runtime packages.

## Platform Adapters

| Adapter | Target files | Current status |
|---|---|---|
| Claude Code | `.claude/agents`, `.claude/skills`, `.claude/workflows`, `CLAUDE.md`, `.claude/settings.json` | Implemented as the first adapter. |
| Harness CLI / run store | `harness run`, `.harness/runs`, `phase_graph.json`, `phases/*`, `trajectory/*`, `validation/*`, `rollback/*` | CLI bridge and read-only visualization implemented. |
| Codex | Codex-specific project prompts, agent profiles, skills, tool policy, and run wiring | Planned. |
| Cursor | Cursor rules/prompts and project agent conventions | Planned. |

The Studio UI should avoid hard-coding one platform as the product identity. Platform-specific language belongs inside adapter names, settings panels, and export/sync actions.

## User Promise

With one harness project, a user should be able to:

- Define multi-agent workflows once.
- See which phase is pending, running, succeeded, failed, cancelled, blocked, or skipped.
- Inspect what prompt an agent received.
- Inspect logs, tool calls, tool results, skill use, token summaries, validations, rollback guidance, and output artifacts.
- Sync the same environment to the agent runtime they are using today.
- Move between Claude Code, Codex, Cursor, and future tools without rewriting the workflow model.

## Naming Guidance

Prefer:

- Harness project
- Harness environment
- Platform adapter
- Runtime projection
- Workflow run
- Multi-agent workflow

Avoid product-level phrasing that makes Harness Studio sound like only:

- A `.claude/` GUI
- A Claude Code plugin manager
- A workflow YAML editor

Those are adapter features, not the product category.

## Near-term Implementation Direction

1. Keep `.harness/runs` as the primary source for execution visualization.
2. Treat `.claude/` as the first platform adapter rather than the core model.
3. Introduce adapter metadata in the model before adding Codex/Cursor writers.
4. Add environment projection views: "Harness source" -> "Claude Code" -> "Codex" -> "Cursor".
5. Keep workflow files human-readable Markdown so agent CLIs can consume and edit them.
6. Replace Studio's legacy live runner with a streamed `harness run` job once the bridge API is ready for long-running processes.

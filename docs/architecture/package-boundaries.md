# Package Boundaries

Harness Studio keeps two similarly named core packages because they own different layers.

## Summary

| Package | Layer | Primary owner | Main consumers |
|---|---|---|---|
| `packages/core` (`@harness/core`) | Harness data plane | Harness CLI/runtime | `packages/cli`, tests, future Studio execution bridges |
| `packages/studio-core` (`@harness-studio/studio-core`) | Studio control-plane core | Web app and VS Code extension | Next API routes, VS Code extension host, visual workflow verification |

## `packages/core`

`packages/core` is the platform-neutral Harness engine. It should know how a Harness project works, but it should not know about React, VS Code webviews, Next.js API routes, or Studio panels.

It owns:

- `harness.yaml` schema and config loading.
- Platform adapters for Claude Code, Codex, and Cursor projections.
- Generated-file ownership, manifests, reconciler, and partial JSON merge.
- `harness init`, `sync`, `doctor`, `adopt` primitives.
- Autonomous runtime primitives: phase execution, run store, gates, checkpoints, rollback, task cards, and run reports.
- Eval and trajectory primitives: `CommonEvent`, parsers, EvalLog writer, ingest, and funnel scorer.

Dependency rule:

- `packages/cli` may depend on `packages/core`.
- `packages/core` must not depend on `packages/cli`, `packages/studio-core`, `src/`, or `extensions/vscode/`.

## `packages/studio-core`

`packages/studio-core` is the headless Studio service layer shared by the web app and VS Code extension. It should know how Studio reads and edits local projects, but it should avoid becoming a second Harness execution engine.

It owns:

- Claude-home and project `.claude/` resource scanning.
- Studio resource file read/write helpers for agents, skills, workflows, settings, and project files.
- Project creation and project scanner utilities used by Web and VS Code.
- Workflow document parsing/validation for Studio editing flows.
- Legacy Studio execution facade used by the old UI runner.
- Harness CLI bridge helpers: availability, dry-run, inspect, and view.
- Visual workflow readers that map `.harness/runs` into Studio DAG/inspector models.

Dependency rule:

- Web/Next API routes and VS Code extension can depend on `packages/studio-core`.
- `packages/studio-core` can call the Harness CLI bridge or read `.harness/runs`, but should not duplicate runtime semantics already owned by `packages/core`.

## Why Not Merge Immediately

They split along product responsibility:

- `core` answers: "What is a Harness project, how is it projected, executed, validated, and recorded?"
- `studio-core` answers: "How does Studio read, edit, visualize, and bridge that project in Web/VS Code?"

Keeping both packages prevents UI concerns from leaking into the CLI/runtime and prevents the Studio bridge from becoming a parallel execution engine.

## Future Direction

Some types may move from `studio-core` to `core` when they become true Harness contracts rather than Studio view models. Good candidates:

- Stable run-store schemas.
- Platform-neutral visual workflow DTOs.
- Shared workflow phase graph parsing.

Until then, treat `studio-core` as the Studio adapter/service layer over `core` and over the local filesystem.

# Documentation Map

Harness Studio documentation is split by audience and lifecycle. Keep durable product, architecture, and user guides close to the top; keep historical implementation notes under `history/`.

## Main Docs

| Path | Purpose |
|---|---|
| [product/positioning.md](./product/positioning.md) | Product positioning and Studio / CLI boundary. |
| [architecture/studio-core-migration.md](./architecture/studio-core-migration.md) | Studio Core architecture and migration notes. |
| [architecture/package-boundaries.md](./architecture/package-boundaries.md) | Difference between `packages/core` and `packages/studio-core`. |
| [guides/demo-script.md](./guides/demo-script.md) | Demo recording script. |
| [harness-cli/README.md](./harness-cli/README.md) | Harness CLI/Core user-facing guide. |

## Harness CLI/Core Docs

| Path | Purpose |
|---|---|
| [harness-cli/architecture/](./harness-cli/architecture/) | Long-lived architecture notes for execution, trajectory, routing, and roadmap. |
| [harness-cli/research/](./harness-cli/research/) | Research inputs and external capability comparisons. |
| [harness-cli/history/](./harness-cli/history/) | Archived plan and stage-by-stage implementation notes. |
| [harness-cli/diagrams/](./harness-cli/diagrams/) | Diagram source notes and final rendered assets. |
| [assets/screenshots/](./assets/screenshots/) | README and product screenshots. |

## Cleanup Rule

- Keep product decisions, architecture boundaries, CLI contracts, and user-facing guides.
- Move stage-by-stage development records to `history/` once implemented.
- Delete generation scratch files such as diagram prompts, transient structured-content drafts, and local build outputs.

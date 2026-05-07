# Studio Core Migration

This document tracks the migration from a Next.js-centric local server design to a layered architecture:

- `studio-core` (headless core capabilities)
- transport adapters (in-process / daemon)
- UI clients (VS Code webview / browser)

## Current State (Phase 3 In Progress)

`packages/studio-core/src` now owns file-system core primitives:

- `claude-home.ts`
- `resource-paths.ts`
- `path-utils.ts`
- `file-ops.ts`
- `types.ts`
- `project-scanner.ts`
- `project-creation.ts`
- `agent-templates.ts`
- `project-templates.ts`
- `workflow-validation.ts`
- `topology.ts`
- `execution-engine.ts`

The existing app keeps compatibility via thin adapters in `src/lib/*`.
API routes now import core modules directly where applicable (`file-ops`, `path-utils`, `claude-home`, `resource-paths`, `project-scanner`).
Project creation is now unified in `studio-core` (`createProject`) and reused by both Next API and VS Code in-process bridge.
`studio-core.ts` now provides a unified `createStudioCore()` service facade.
VS Code extension now depends on `@harness-studio/studio-core` and uses an in-process bridge handler with expanded route coverage:

- `resources/*`
- `settings` (global + project scopes)
- `projects/open`, `projects/create`, `projects/:id`, `projects/browse`, `projects/pick-directory`
- `projects/:id/(agents|skills|workflows|claudemd)`
- `files` (path-based memory file update/delete)
- `watch` SSE stream (in-process file watcher mode)
- `execute/*` (start/get/cancel/checkpoint + execution stream SSE in-process mode)

`nativePreview` is now the default open mode and no longer requires an external local daemon to start.

## Why This Step

- Removes core file I/O logic from framework-bound folders.
- Creates a reusable foundation for VS Code in-process execution.
- Keeps current behavior stable while preparing adapter split.

## Next Phases

### Phase 2

- Extract project scanning and workflow parsing/validation into `studio-core`. ✅
- Introduce a stable `StudioCore` service interface. ✅ (`createStudioCore`)
- Make API routes and extension consume the same service surface. ✅ (partial route coverage, HTTP fallback retained)

### Phase 3

- Add in-process adapter in VS Code extension host (no mandatory daemon). ✅ (native preview path)
- Keep daemon/web adapter optional for external browser access.
- Unify event stream contracts (watch + execution) across adapters. ✅ (watch + execute stream in extension bridge)

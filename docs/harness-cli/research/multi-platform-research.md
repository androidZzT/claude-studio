# Multi-Platform AI Coding Capability Research

Date: 2026-04-30

This report compares Claude Code, OpenAI Codex CLI, and Cursor across six harness-relevant capability surfaces: agents, skills, rules, MCP, hooks, and plugins. It separates official platform capability from the current `harness-cli` adapter implementation so that future adapter work does not confuse "the platform cannot do this" with "harness has not implemented this yet".

## Sources

- Claude Code official docs: [subagents](https://code.claude.com/docs/en/subagents), [skills](https://code.claude.com/docs/en/skills), [memory / rules](https://code.claude.com/docs/en/memory), [MCP](https://code.claude.com/docs/en/mcp), [hooks](https://code.claude.com/docs/en/hooks), [plugins](https://code.claude.com/docs/en/plugins)
- Codex official docs: [AGENTS.md](https://developers.openai.com/codex/guides/agents-md), [subagents](https://developers.openai.com/codex/subagents), [skills](https://developers.openai.com/codex/skills), [hooks](https://developers.openai.com/codex/hooks), [plugins](https://developers.openai.com/codex/plugins), [configuration reference](https://developers.openai.com/codex/config-reference), [openai/codex config docs](https://github.com/openai/codex/blob/main/docs/config.md)
- Cursor official docs / product pages: [rules](https://docs.cursor.com/context/rules), [MCP](https://docs.cursor.com/context/model-context-protocol), [CLI usage](https://docs.cursor.com/cli/using), [background agents](https://docs.cursor.com/en/background-agents), [product overview](https://cursor.com/product/), [enterprise hooks announcement](https://cursor.com/blog/enterprise/), [Cursor 2.4 changelog](https://cursor.com/changelog/2-4)
- Local harness docs and source: `docs/harness-cli/history/stages/stage1-*.md`, `packages/core/src/adapters/{claude-code,codex,cursor}.ts`, `packages/core/src/adapters/capabilities.ts`

Legend:

- ✅ Full: documented, file/config-addressable, and suitable for deterministic adapter output.
- ⚠️ Partial: supported but schema/scope differs, is feature-gated, or has incomplete public docs.
- ❌ Not supported: no official equivalent found.
- ❓ Unclear: product/marketplace evidence exists, but stable authoring contract is not clear enough for harness ownership.

## Capability Matrix

| Capability | Claude Code | Codex CLI | Cursor |
| --- | --- | --- | --- |
| agents | ✅ Project/user/plugin subagents. Location: `.claude/agents/*.md`, `~/.claude/agents/*.md`, or plugin `agents/`. Format: Markdown plus YAML frontmatter. Required fields: `name`, `description`; optional fields include `tools`, `model`, `skills`, `memory`, background/permission-related fields. Loading: discovered from project/user/plugin scopes; project wins on name conflicts. Invocation: automatic delegation by description, natural-language request, `@agent-...`, `--agent`, or project `agent` setting. Limits: separate context window; background subagents have pre-approval behavior; subagent skill inheritance is explicit, not automatic. | ✅ Custom agents/subagents. Location: `.codex/agents/*.toml` project scope and `~/.codex/agents/*.toml` user scope. Format: standalone TOML config layer. Required fields: `name`, `description`, `developer_instructions`; optional fields include `nickname_candidates`, `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, and `skills.config`. Loading: available to Codex app/CLI, explicitly spawned; built-ins include `default`, `worker`, and `explorer`. Invocation: ask Codex to spawn agents, `/agent` to inspect/switch. Limits: explicit only; custom agent files are heavier config layers rather than small frontmatter manifests. | ⚠️/❓ Product and changelog show subagents and Cursor marketplace entries expose subagents. Public stable project-file contract is less clear than Claude/Codex. Community reports mention `.cursor/agents/*.md` with YAML frontmatter (`name`, `description`, `model`) on nightly, but this should not be treated as a stable harness target yet. Invocation appears via Cursor agent orchestration / marketplace plugins rather than a documented repo-owned schema. |
| skills | ✅ Agent Skills. Location: `.claude/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md`, or plugin `skills/`. Format: directory tree with `SKILL.md` Markdown plus YAML frontmatter. Required fields: `name`, `description`; optional `allowed-tools`; plugin examples also show `disable-model-invocation`. Loading: progressive disclosure; Claude sees metadata and loads full skill when relevant. Invocation: automatic by description or explicit plugin/skill command patterns. Limits: supporting files load on demand; `allowed-tools` is Claude Code CLI specific. | ✅ Agent Skills. Location: `.agents/skills` scanned from CWD up to repo root, `$HOME/.agents/skills`, `/etc/codex/skills`, and bundled system skills. Format: directory with `SKILL.md`; required frontmatter `name`, `description`; optional `agents/openai.yaml` for display, invocation policy, and dependencies. Loading: progressive disclosure; initial skills list is budgeted. Invocation: implicit by description, `/skills`, or `$` mention. Limits: duplicate names are not merged; symlinks are followed; disablement uses `[[skills.config]]` in `~/.codex/config.toml`. | ⚠️ Cursor product pages and marketplace show Skills and `/add-plugin` bundles; exact repo-owned `.cursor/skills` authoring contract is not yet as clearly documented in stable docs. Treat as product-supported but adapter-risky until the official docs expose file layout, frontmatter, loading, and invocation guarantees. |
| rules | ✅ Project/user memory rules. Locations: `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/**/*.md`, `~/.claude/rules/**/*.md`. Format: Markdown; `.claude/rules` may have YAML frontmatter `paths: [...]`. Loading: `CLAUDE.md` files load by walking directory tree; `.claude/rules` without `paths` load at launch, path-scoped rules load when matching files are opened. Invocation: automatic context loading; `/memory` to inspect/edit. Limits: instructions shape behavior but are not enforcement; `.claude/rules` supports recursive discovery and symlinks. | ✅ AGENTS.md instruction chain. Locations: `~/.codex/AGENTS.md` or `AGENTS.override.md`; project `AGENTS.md`, `AGENTS.override.md`, or configured fallback names along root-to-CWD path. Format: Markdown, no frontmatter. Loading: once per run/session, concatenated from root to current directory; closer files appear later and effectively override earlier guidance. Invocation: automatic at session start. Limits: combined size cap (`project_doc_max_bytes`, 32 KiB default); no per-file glob frontmatter equivalent in public docs. | ✅ Cursor Rules. Location: `.cursor/rules/*.mdc`, nested `.cursor/rules`, user rules in settings, plus `AGENTS.md` as a simple alternative and deprecated `.cursorrules`. Format: MDC with metadata and content. Frontmatter fields: `description`, `globs`, `alwaysApply`; rule types map to Always, Auto Attached, Agent Requested, and Manual. Loading: always, path/glob auto-attach, model-requested, or manual. Invocation: automatic by type or `@ruleName` for Manual. Limits: `.mdc` metadata semantics differ from Claude `paths`; nested rules auto-scope by directory. |
| mcp | ✅ MCP servers. Locations: project `.mcp.json`, local/user storage in `~/.claude.json`, managed `managed-mcp.json`, plugin `.mcp.json` or `plugin.json`. Format: JSON `mcpServers`; supports stdio/http/SSE-style config, OAuth, headers helpers, env interpolation in `.mcp.json`. Loading: scoped local/project/user/plugin/managed; `/mcp` manages connections. Invocation: tools/prompts become available to Claude; project servers require approval. Limits: multiple scopes and trust prompts; project scope is `.mcp.json`, not `.claude/settings.json` in current docs. | ✅ MCP through TOML config. Location: `~/.codex/config.toml`, `.codex/config.toml`, and profile/custom agent config layers. Format: `[mcp_servers.<id>]` TOML; documented keys include `command`, `args`, `env`, `url`, `http_headers`, `bearer_token_env_var`, `enabled`, `enabled_tools`, `disabled_tools`, startup/tool timeouts, OAuth scopes, and approval modes. Loading: config layer at startup; tools exposed to Codex. Invocation: model/tool use through Codex, with approval settings. Limits: per-project full config semantics are richer than current harness command/args/env schema. | ✅ MCP. Locations: project `.cursor/mcp.json`, global `~/.cursor/mcp.json`, extension API. Format: JSON `mcpServers`; supports stdio, SSE, and Streamable HTTP; fields include command/args/env or remote URL/header config. Loading: IDE and CLI respect the same `mcp.json`. Invocation: Agent automatically uses available tools when relevant; user can ask for a tool by name; tools can be toggled and auto-run controlled. Limits: Cursor resolves variables in several fields; harness currently emits only command-based JSON. |
| hooks | ✅ Lifecycle hooks. Location: `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, plugin `hooks/hooks.json`, session/built-in. Format: settings JSON `hooks` with event -> matcher group -> hook handlers. Handler types include command, HTTP, and MCP tool hooks. Fields include `type`, `command` or `url`/MCP target, `timeout`, `statusMessage`, `shell`, async fields, etc. Loading: settings hierarchy and plugin/session sources. Invocation: lifecycle events such as `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, subagent events, task events, and more. Limits: event blocking semantics vary; exit code 2 is the policy block path for many events. | ⚠️ Hooks are documented but feature-gated. Location: `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`. Format: JSON or inline TOML `hooks`; event -> matcher group -> command hooks. Fields include `command`, `timeout`, `statusMessage`. Loading: active config layers; multiple hook files all run, higher-precedence layers do not replace lower layers. Invocation: events include `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop`; commands receive JSON on stdin. Limits: requires `[features] codex_hooks = true`; matching hooks can run concurrently. | ⚠️ Cursor enterprise/product pages and marketplace show hooks. Public examples use `version: 1` and events such as `beforeSubmitPrompt` and `beforeShellCommand`; marketplace entries show hook event names like `sessionStart`, `beforeMCPExecution`, `beforeReadFile`, and subagent hooks. Loading/config location and stable project-owned schema are not as well documented in the public docs as Claude/Codex, so harness should not yet assume full parity. |
| plugins | ✅ Plugin system and marketplaces. Location: marketplace plugin root with `.claude-plugin/plugin.json`; components at plugin root (`skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`). Settings include `enabledPlugins` and `extraKnownMarketplaces`. Format: JSON manifest plus component files. Loading: installed/enabled via `/plugin`, marketplace, `--plugin-dir`, and settings. Invocation: plugin skills/commands/agents appear in their native interfaces; plugin MCP auto-connects after reload/session start. Limits: install/cache is separate from project settings; harness should declare settings but not install. | ✅ Plugin system. Distribution unit bundles skills, app integrations, and MCP servers. CLI has `/plugins`; config can disable installed plugins with `[plugins."name@marketplace"] enabled = false`. Invocation: ask naturally or mention with `@`; bundled skills are available after install. Limits: official docs emphasize install/use through Codex app/CLI directory; repo-declared marketplace/lockfile semantics are not equivalent to Claude `enabledPlugins`. | ⚠️ Cursor marketplace and product pages expose plugins that bundle skills, subagents, MCP, hooks, rules, and commands; install command is `/add-plugin`. Public stable project-file schema for declaring enabled plugins is not yet clear enough for deterministic harness sync. Treat as platform-supported but adapter-specific until docs settle. |

## Mechanism Differences by Capability

### Agents

Agents are not a 1:1 abstraction:

- Claude Code agents are Markdown/frontmatter files with a body prompt. They are discoverable and can be auto-delegated by description.
- Codex agents are TOML config layers for explicitly spawned subagents. They can override model, sandbox, MCP, and skills settings.
- Cursor has product-level subagents and marketplace subagents, but a stable repo-owned file schema is not sufficiently documented for adapter implementation.

Harness strategy: keep `claude/agents/*.md` as Claude-specific for now; add a new canonical `agents` abstraction only if we are ready to model at least two backends. A future Codex adapter should render `.codex/agents/<name>.toml` from a structured schema rather than trying to reuse Claude Markdown body verbatim.

### Skills

Skills are closer across Claude Code and Codex than agents:

- Both use directory trees with `SKILL.md`.
- Both use `name` and `description`.
- Both rely on progressive disclosure and description-based activation.

But details still differ:

- Claude Code uses `.claude/skills/<name>/SKILL.md`; Codex uses `.agents/skills/<name>/SKILL.md`.
- Claude supports `allowed-tools`; Codex supports optional `agents/openai.yaml` for display, invocation policy, and tool dependencies.
- Cursor has marketplace/product support, but the stable repository source layout is not clear from public docs.

Harness strategy: a canonical `skills/<name>/SKILL.md` source is plausible, with adapter-specific metadata overlays for Claude `allowed-tools` and Codex `agents/openai.yaml`. Do not block on Cursor until its authoring contract stabilizes.

### Rules

Rules are the most mature cross-platform target, but transformations are required:

- Claude Code: `CLAUDE.md` plus `.claude/rules/**/*.md`, optional `paths` frontmatter.
- Codex: `AGENTS.md` instruction chain, no frontmatter, no documented path glob rule surface.
- Cursor: `.cursor/rules/*.mdc` with `description`, `globs`, and `alwaysApply`; also supports `AGENTS.md`.

Harness strategy: keep canonical instructions as Markdown, but add a structured `rules` layer if we need path-aware behavior. Map `paths` to Claude `paths`, Cursor `globs`, and either flatten or comment-preserve for Codex `AGENTS.md`.

### MCP

MCP can be canonical, but current harness schema is too small:

- All three platforms can consume `mcpServers`.
- Claude Code project scope currently centers on root `.mcp.json`, with local/user storage elsewhere.
- Codex uses TOML `[mcp_servers.<id>]`.
- Cursor uses `.cursor/mcp.json`.

Harness strategy: top-level `mcp.servers` remains correct, but schema should expand beyond command/args/env to model `url`, headers, OAuth/bearer env, enabled/required, timeout, and allowed/disabled tools. Adapters should down-convert or warn when a target cannot express a field.

### Hooks

Hooks are not yet a safe single canonical abstraction:

- Claude Code hooks are mature, broad, and have complex command/HTTP/MCP handlers and event-specific blocking semantics.
- Codex hooks are documented but feature-gated; event names overlap with Claude but runtime merge semantics differ.
- Cursor hooks appear in enterprise/marketplace surfaces with different event names.

Harness strategy: keep `hooks.pre-commit` canonical as git hook, but split lifecycle hooks by platform namespace: `hooks.claude`, `hooks.codex`, `hooks.cursor`, or add explicit `targets`. A shared event enum would hide important behavioral differences.

### Plugins

Plugins are distribution systems, not merely config fields:

- Claude Code plugin settings are project-addressable via `enabledPlugins` / marketplaces and component directories.
- Codex plugins are installed through Codex plugin directory and can be disabled in `~/.codex/config.toml`.
- Cursor plugins exist through marketplace `/add-plugin`, but deterministic repo declaration is not clear.

Harness strategy: do not force one plugin schema across all platforms. Keep Claude plugin declarations as Claude-specific until Codex/Cursor expose a stable project-owned declaration surface.

## Current Harness Adapter Status

| Adapter | Published features | Implemented fields / outputs | Major gaps against platform docs |
| --- | --- | --- | --- |
| `claude-code` | `claude-md`, `claude-agents-md`, `claude-commands-md`, `claude-rules-md`, `claude-scripts`, `claude-skills`, `claude-hooks`, `claude-mcp`, `claude-plugins`, `claude-reference-projects`, `claude-docs`, `claude-metrics` | Renders `CLAUDE.md`; mirrors agents/commands/rules/scripts/skills/docs/metrics; injects `model` frontmatter into agents; renders dispatch table into rules; renders `.claude/settings.json` partial-owned keys for hooks, `mcpServers`, marketplaces/plugins/`enabledPlugins`; renders `.claude/reference-project.json`. | Claude MCP official project scope is root `.mcp.json`, while harness writes `mcpServers` into `.claude/settings.json`; no support for Claude HTTP/MCP hook handlers, hook async fields, `shell: powershell`, agent `skills`/`memory`/permission frontmatter, skill `allowed-tools`, recursive `.claude/rules`, or plugin install/cache. |
| `codex` | `agents-md`, `codex-config-toml` | Renders `AGENTS.md` from canonical instructions; renders `.codex/config.toml` template and appends command-based `[mcp_servers.<name>]` blocks. | Does not render `.codex/agents/*.toml`, `.agents/skills/**`, `.codex/hooks.json`, Codex plugin config, richer MCP fields (`url`, headers, OAuth, approval/tool filters, enabled/required/timeouts), AGENTS override/fallback hierarchy, or Codex-specific config profiles. |
| `cursor` | `cursor-rules-mdc`, `cursor-mcp-json` | Renders a single `.cursor/rules/main.mdc` with `description` and `alwaysApply: true`; renders `.cursor/mcp.json` from command-based `mcp.servers`. | Does not support multiple rules, `globs`, Manual/Agent Requested/Auto Attached modes, nested rules, `AGENTS.md` alternative, Cursor skills/subagents/hooks/plugins marketplace surfaces, MCP transports beyond command style, or Cursor variable/header semantics. |

## Harness Adaptation Strategy

### Schema Expansion Recommendations

1. Add a structured canonical `rules` model:
   - `name`, `body`, `paths/globs`, `description`, `apply` (`always | path | agent_requested | manual`).
   - Map to Claude `.claude/rules`, Cursor `.cursor/rules/*.mdc`, and Codex `AGENTS.md` fallback with warnings for path-only semantics.

2. Expand `mcp.servers` to a transport-aware shape:
   - Common: `command`, `args`, `env`, `url`, `headers`, `enabled`, `required`, `startup_timeout`, `tool_timeout`.
   - Adapter-specific pass-through namespaces: `mcp.servers.<id>.claude`, `.codex`, `.cursor`.

3. Introduce platform-specific lifecycle hooks:
   - Keep `hooks.pre-commit` as tool-agnostic git hook.
   - Use `hooks.claude`, `hooks.codex`, `hooks.cursor` for agent lifecycle hooks to avoid pretending event semantics are identical.

4. Split reusable knowledge from platform execution:
   - Canonical skills source can be shared (`skills/<name>/SKILL.md`), but tool permissions, invocation policies, and plugin packaging should be adapter overlays.

5. Add adapter-specific plugin declarations only where stable:
   - Continue Claude `plugins` as implemented.
   - Add Codex/Cursor plugin config only after their repo-owned declaration contracts are explicit enough to avoid install/cache side effects.

### Adapter Priority

1. Cursor rules should be first. Cursor's rules are officially documented, repository-scoped, and the current adapter collapses all rules into one always-on file. This is the highest value / lowest uncertainty gap.
2. Codex skills and agents should be next. Codex now has documented `.agents/skills` and `.codex/agents` surfaces, and harness already has analogous Claude source trees.
3. Codex hooks should follow, but behind an explicit feature flag in generated config because Codex requires `[features] codex_hooks = true`.
4. MCP schema widening should happen before adding more tool-specific MCP features; otherwise every adapter will keep reimplementing partial fields.
5. Cursor hooks/plugins should wait for stable project-file docs. Product support exists, but deterministic harness ownership needs a stronger contract.

### Unified vs Platform-Specific

Unify:

- Canonical instructions and rule body text.
- MCP server identity and common connection fields.
- Skill directory tree where both platforms use `SKILL.md`.
- Docs/metrics passthrough and project reference metadata.

Keep platform-specific:

- Claude Code settings ownership, hooks, plugins, agent memory, and permissions.
- Codex agent config TOML, sandbox/approval/model profiles, and hook feature flag.
- Cursor rule application mode (`alwaysApply`, `globs`, Manual/Agent Requested), cloud/background-agent environment, hooks, and plugin marketplace declarations.

## Candidate Stages

1. **Stage 1.18: Cursor rules schema and multi-rule renderer**
   - Add canonical or Cursor-specific rule sources.
   - Render multiple `.cursor/rules/*.mdc`.
   - Support `description`, `globs`, `alwaysApply`, and Manual / Agent Requested / Auto Attached mapping.

2. **Stage 1.19: Codex skills and custom agents adapter**
   - Render `.agents/skills/<name>/SKILL.md` from canonical skills.
   - Render `.codex/agents/<name>.toml` from structured agent config.
   - Map Claude-style agent body to Codex `developer_instructions` only with explicit schema, not by raw file copy.

3. **Stage 1.20: MCP schema widening and adapter parity**
   - Extend `harness.yaml` MCP schema to include HTTP/URL, headers, OAuth/bearer env, enable/disable, required, timeouts, and tool filters.
   - Render to Claude `.mcp.json`, Codex TOML, Cursor `.cursor/mcp.json`.
   - Preserve current command-based behavior as the compatibility subset.

4. **Stage 1.21: Codex hooks adapter**
   - Render `.codex/hooks.json` and/or inline config tables.
   - Require explicit `codex_hooks` feature flag.
   - Keep Codex hook event names separate from Claude hook event names.

5. **Stage 1.22: Cursor/Codex adopt**
   - Reverse-migrate `.cursor/rules`, `.cursor/mcp.json`, `.codex/config.toml`, `.codex/agents`, and `.agents/skills`.
   - Keep this separate from Claude adopt because source layouts and ownership semantics differ.

## Key Findings

- The biggest surprise is Codex parity: modern Codex docs include subagents, skills, hooks, plugins, AGENTS.md, and MCP. The current harness Codex adapter is therefore far behind the platform, not just intentionally minimal.
- Cursor is strongest in rules and MCP. It clearly supports project rules and MCP config, while skills/subagents/hooks/plugins exist in product/marketplace surfaces but need a more stable project-file contract before harness should own them.
- Claude Code remains the most complete harness target today, but even it has divergences: official MCP project sharing is `.mcp.json`, and official `.claude/rules` is recursive/path-scoped, while harness currently renders flat rules and settings-owned MCP.
- The safest next step is not "make one universal schema for everything"; it is "unify instructions/rules/MCP where semantics match, and keep lifecycle/plugin systems platform-specific until contracts converge."

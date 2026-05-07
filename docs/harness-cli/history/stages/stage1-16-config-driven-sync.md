# Stage 1.16 Config-Driven Sync

## Scope

Stage 1.16 makes `harness.yaml` the single source of truth for Sailor-style role routing and model selection:

- `harness.local.yaml` can override local paths and model choices without changing the shared harness repo.
- `${...}` placeholders in string values are resolved after the local override is merged.
- `dispatch.patterns` renders the dispatch table inside `.claude/rules/agent-role.md`.
- `models.default` and `models.agents.<name>` inject `model:` into `.claude/agents/*.md` frontmatter.

This stage does not implement runtime dispatch. Claude Code still reads the rendered rules; harness only materializes files.

## Local Override Loading

`loadHarnessConfig()` now checks for `harness.local.yaml` beside the selected `harness.yaml` unless the caller passes `noLocal: true`.

Merge rules:

- Scalars replace base values.
- Objects merge recursively.
- Arrays replace the whole base array.
- `harness.local.yaml` has higher priority than `harness.yaml`.

This is intentionally simple and predictable for path overrides such as:

```yaml
projects:
  targets:
    android:
      path: /tmp/test-android
```

`harness sync --no-local` and `harness diff --no-local` skip this local layer for CI-style consistency checks.

## Placeholder Interpolation

After merge and schema defaults, harness walks all string fields and replaces `${...}` placeholders when the referenced value exists.

Supported forms:

- `${projects.targets.android.path}`
- `${targets.android.path}` as shorthand for `${projects.targets.android.path}`
- `${projects.references.machpro.path}`
- `${references.machpro.path}` as shorthand for `${projects.references.machpro.path}`

Unresolved placeholders are preserved literally instead of failing sync. This keeps partially portable specs usable while local paths are still being filled in.

## Dispatch Table Rendering

Any rule markdown containing:

```markdown
<!-- HARNESS_DISPATCH_TABLE:START -->
<!-- HARNESS_DISPATCH_TABLE:END -->
```

has the block replaced during `sync`/`diff` planning.

The generated table uses three columns:

- `改动路径`
- `agent`
- `说明`

After configured patterns, harness appends two fixed rows:

- `cross_platform_policy: split_serial` becomes `跨平台改动 → 拆分串行`.
- `cross_platform_policy: split_isolated_parallel` becomes `跨平台改动 → 先 architect 写 C0-C12 双端统一契约 + contract_id todo，再 Android/iOS 拆分隔离并行`.
- `纯 markdown / rules / memory → team-lead 直改` is always present as the fallback rule.

Files without markers are copied unchanged for backward compatibility.

## Agent Model Injection

For each `agents/*.md` source file, the filename stem selects the model:

1. `models.agents.<agent_name>` wins.
2. `models.default` is used as fallback.
3. If neither exists, the source frontmatter is preserved unchanged.

When a `model:` line already exists, harness changes only the value and preserves trailing comments. When the frontmatter exists but has no `model:`, harness inserts the field after `name:` or `description:`. If no frontmatter exists and a model is configured, harness creates a minimal frontmatter block.

## Sailor Validation

The Sailor harness uses:

- `models.default` plus per-agent overrides for `architect`, `android-coder`, and related agents.
- `projects.targets.android.path` / `projects.targets.ios.path` as dispatch interpolation sources.
- `projects.targets.<name>.commands` as optional named command metadata for target-specific compile, package, smoke, or release entrypoints. Harness validates and preserves this map, but Stage 1.16 does not execute it.
- `rules/agent-role.md` as the dispatch table template.

Validation flow:

```bash
cd ~/Claude/sailor-harness
cp harness.local.yaml.example harness.local.yaml
node ~/Claude/harness-cli/packages/cli/dist/cli.js sync --harness-repo .
node ~/Claude/harness-cli/packages/cli/dist/cli.js sync --harness-repo . --no-local
```

The first command should render local target paths; the second should return to shared `harness.yaml` defaults.

## Boundaries

- No runtime agent routing is implemented.
- Codex and Cursor adapters are unchanged.
- `harness adopt`, `harness init`, and eval trajectory parsing are unchanged.
- Existing `.claude/settings.json` partial ownership semantics are unchanged.

## Capability Path Completion And Reference Project Consolidation

Follow-up fixes in this stage closed two gaps in the explicit `adapters.claude-code.capabilities` path.

### `claude_md`

When a harness declares an explicit capability subset, `claude_md` now renders root `CLAUDE.md` from `canonical.instructions`.

This keeps the config capability aligned with the public adapter feature `claude-md`: the public feature name remains kebab-case, while the config capability follows the existing snake_case style used by `reference_projects`.

### Reference Projects

Reference projects now prefer the config-driven source:

```yaml
projects:
  references:
    machpro:
      path: ../sailor_fe_c_transaction_dynamic
      git_url: ssh://git@example.com/machpro
      description: Legacy reference app
      optional: true
```

That renders `.claude/reference-project.json` as a full-ownership JSON document. The output preserves the legacy file shape:

```json
{
  "projects": {
    "machpro": {
      "path": "../sailor_fe_c_transaction_dynamic",
      "git_url": "ssh://git@example.com/machpro",
      "description": "Legacy reference app"
    }
  }
}
```

The `optional` flag is intentionally not emitted because Claude Code's reference-project file does not consume it; it remains harness-side metadata.

Backward compatibility:

- If `projects.references` is present, it wins.
- If `projects.references` is absent and `adapters.claude-code.reference_projects_source` points to an existing JSON file, harness mirrors that file as before.
- If both are present, harness uses `projects.references` and emits a deprecation warning for the JSON source.
- If neither exists, no reference-project file is planned.

### Source/Capability Mismatch Warning

For explicit capability subsets, harness warns when a source field points at an existing file or directory but the matching capability is missing. Example:

```text
Warning: adapters.claude-code.reference_projects_source is set but reference_projects capability is not enabled; field will be ignored.
```

This is advisory only; sync/diff still succeed.

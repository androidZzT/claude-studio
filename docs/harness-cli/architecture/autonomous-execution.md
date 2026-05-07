# Autonomous Execution Design - TS-first incremental plan

> Deliverable: a decision-complete design for implementing autonomous multi-phase execution in the existing TypeScript `harness-cli`. This document is for future Codex agents and maintainers. It is not a Python rewrite plan.

## Summary

This plan keeps the current TypeScript CLI as the production entrypoint and adds autonomous execution in small, reviewable steps:

1. `harness.yaml` schema v2 for agent-to-tool routing and per-tool model/profile configuration.
2. Safe TypeScript runtime primitives: run store, command runner, phase executor, deterministic gates, checkpoint judge, drift check, and file-based pause/resume.
3. Mock-first integration tests before any real `sailor-harness` run.

Python and LangGraph remain future ADR candidates. They are not part of this implementation plan.

## Core decisions

- **TS-first**: implement in the existing TypeScript packages. Do not move `packages/` to `packages-deprecated/` in this plan.
- **Schema migration, not schema freeze**: `schema_version: 2` introduces `agent_tools` and per-tool `models`; v1 remains readable with warnings.
- **One phase per Codex turn**: each M-phase must commit, print verdict, and stop. A later user prompt starts the next phase.
- **No shell-style gate commands**: checkpoint and deterministic gates run structured argv commands only.
- **No cwd `runs/` pollution**: runtime artifacts default to `<harness_repo>/.harness/runs/<thread_id>/`.
- **No LangGraph client**: MVP uses local TS state files, not `langgraph_client`.
- **No hardcoded sailor-harness agent table**: cwd and permissions are derived from `harness.yaml` plus phase specs.

## Schema v2

`harness.yaml` v2 adds explicit agent routing:

```yaml
schema_version: 2

tools:
  - claude-code
  - codex

agent_tools:
  default: claude-code
  agents:
    architect: claude-code
    android-coder: codex
    ios-coder: codex
    code-reviewer: codex

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
      code-reviewer:
        effort: high
        sandbox_mode: read-only
        approval_policy: on-request
```

Validation rules:

- `agent_tools.default` and every `agent_tools.agents.*` value must be in `tools`.
- Missing `agent_tools` is equivalent to `{ default: "claude-code", agents: {} }` for v1 compatibility.
- Existing v1 `models.default` and `models.agents` remain readable, but parsing emits a deprecation warning and maps them to the default tool bucket.
- Codex profile rendering must only create profiles for agents routed to `codex`.
- Claude Code agent projection must only include agents routed to `claude-code`; Codex agent projection follows the same filtering if Codex agent markdown files are enabled.

## Runtime architecture

```text
brief.md
  |
  v
harness run <compound> --brief <path> --autonomous
  |
  v
TS autonomous orchestrator
  |
  +-- run store: .harness/runs/<thread_id>/
  +-- phase executor: claude/codex subprocess dispatch
  +-- safe command runner: structured argv only
  +-- deterministic gate: compile/test/lint/diff/review/drift
  +-- checkpoint judge: advisory only
  +-- pause/resume: file protocol
```

Runtime artifacts:

```text
.harness/runs/<thread_id>/
  brief.md
  state.json
  events.jsonl
  phase_graph.json
  lock
  phases/
    01-architect/
      prompt.md
      output.md
      partial-output.md
      stdout.log
      stderr.log
      exit_code.json
      session.json
      trajectory.json
      cost.json
  trajectory/
    01-architect/
      common-events.jsonl
      events.jsonl
      summary.json
  audits/
    01-architect/
      default.json
      default.md
  visualization/
    workflow.mmd
    run.html
  gates/
    01-architect.json
  checkpoints/
    01-02.json
  notifications/
    <ts>.request.md
    <ts>.decision.md
  summary.md
```

`events.jsonl` schema:

```ts
interface RunEvent {
  ts: string; // ISO8601
  kind:
    | "phase_start"
    | "phase_end"
    | "checkpoint"
    | "escalate"
    | "resume"
    | "gate_fail"
    | "trajectory"
    | "audit"
    | "visualization";
  phase_id: string;
  payload: Record<string, unknown>;
}
```

`lock` schema:

```json
{
  "pid": 12345,
  "hostname": "host.local",
  "started_at_iso": "2026-05-03T10:00:00.000Z",
  "run_id": "..."
}
```

Preflight:

- Before creating a run, verify `.harness/` is ignored by the harness repo git ignore rules.
- If `--run-root <path>` is provided, verify that path is ignored or is outside all managed worktrees.
- If preflight fails, abort before spawning agents or writing artifacts.
- If a lock exists and `pid` is still alive on the same host, fail unless this is the same resume process. If the PID is dead, clear the stale lock and append a `resume` event.

## Phase spec and cwd resolution

Phase specs are data, not hardcoded switch statements. The source of truth is the compound skill frontmatter:

```yaml
# skills/compound/<name>/SKILL.md
---
name: compound-example
phases:
  - phase_id: android-coder
    agent: android-coder
    tool: codex
    cwd_ref: target:android
    profile: android-coder
    mode: plan
    parallel_group: platform-coders
    trajectory_capture: true
    audit_blocking_policy: critical_only
    post_phase_audits:
      - audit_id: default
    allowed_write_roots:
      - "."
    gate_commands:
      - id: compile_android
        kind: compile
        cwd_ref: target:android
        argv: ["./gradlew", ":foundation:mvvm:compileDebugKotlin"]
        timeout_seconds: 600
---
```

`harness sync` must preserve this frontmatter without interpreting or rewriting it. The autonomous runtime reads `SKILL.md` frontmatter directly when building the phase graph.

One phase spec object:

```yaml
phase_id: android-coder
agent: android-coder
tool: codex
cwd_ref: target:android
profile: android-coder
mode: plan
parallel_group: platform-coders
trajectory_capture: true
audit_blocking_policy: critical_only
post_phase_audits:
  - audit_id: default
allowed_write_roots:
  - "."
gate_commands:
  - id: compile_android
    kind: compile
    cwd_ref: target:android
    argv: ["./gradlew", ":foundation:mvvm:compileDebugKotlin"]
    timeout_seconds: 600
```

`cwd_ref` values:

- `harness`: the harness repo root.
- `target:<name>`: `harness.yaml.projects.targets.<name>.path`.
- `reference:<name>`: `harness.yaml.projects.references.<name>.path`, read-only unless the phase explicitly marks a writable reference, which should be rejected by default.

Resolution rules:

- The runtime resolves cwd before spawning any subprocess.
- Missing `cwd_ref`, missing project config, or a path outside the expected root fails preflight.
- The runtime must not contain sailor-harness-specific agent names or path assumptions.
- Permissions are derived from `tool`, `profile`, `cwd_ref`, and `allowed_write_roots`.

Parallel semantics:

- `parallel_group` is optional. Phases with the same `parallel_group` and no unmet dependency are spawned concurrently.
- A group checkpoint runs only after every phase in the group has ended and all gate results are collected.
- If one phase in the group fails, the runtime still drains already-running sibling phases, then routes the whole group through deterministic gate handling.
- `events.jsonl` writes are serialized with the run advisory file lock.

## Phase trajectory, audit, and visualization

Every phase records enough local artifacts for node-level replay:

- `task-card.json` / `task-card.sha256`: optional bounded execution input and hash copied from `--task-card`.
- `prompt.md`: exact prompt sent to the agent subprocess, including `Harness-Phase-Fingerprint` and TaskCard hash when present.
- `stdout.log` / `stderr.log`: tee output mirrored to the parent process and persisted for session id parsing.
- `session.json`: tool, agent, cwd, profile, mode, session id, prompt sha256, TaskCard hash, phase status, and trajectory status.
- `partial-output.md`: stdout/stderr tail for failed, interrupted, or preflight-blocked phases. `output.md` remains the formal successful phase artifact.
- `phases/<phase_id>/result.json`: structured phase result with `status`, `summary`, `changed_files`, `commands_run`, `tests`, `risk_flags`, and `next_action`. Runtime synthesizes a minimal artifact when a provider cannot write one directly.
- `validation/<phase_id>/result-schema.json`: result schema, required artifact, and TaskCard `allowed_paths` validation.
- `validation/<phase_id>/budget.json` / `risk.json`: budget and risk gate reports.
- `rollback/<phase_id>/baseline.diff` / `rollback.md`: pre-phase diff snapshot and non-destructive recovery guidance.
- `run-family.json`: same TaskCard hash family metadata for recovery / reconnect stitching.
- `trajectory/<phase_id>/common-events.jsonl`: parser output in the shared `CommonEvent` schema.
- `trajectory/<phase_id>/events.jsonl`: normalized replay timeline with `user_prompt`, `assistant_message`, `skill_use`, `tool_call`, `tool_result`, `tokens`, and `final_output`.
- `audits/<phase_id>/<audit_id>.json`: post-phase read-only audit score, Critical count, recommendation, and blocking decision.

Trajectory capture defaults to `trajectory_capture: true`. The phase executor injects a `Harness-Phase-Fingerprint` derived from the original prompt. The resolver must validate `session_id` when present, fingerprint, cwd, and phase time window before it binds a raw Codex or Claude Code trajectory. If any required signal is missing or mismatched, the summary is marked `missing`; the runtime must not bind the nearest provider session. Missing raw provider logs do not fail the phase; audit records a warning and visualization shows the gap. Token usage summaries include `usage_reliable` and `usage_warnings`; outlier provider usage is excluded from report totals.

Audit defaults:

- `audit_blocking_policy: critical_only`
- default `post_phase_audits` is one audit named `default`
- normal low score is advisory
- `critical_count > 0` blocks the next phase
- deterministic gate failure remains authoritative and is treated as Critical by audit
- `audit_model` is passed to the injected `auditJudge`; without an injected judge, runtime uses deterministic audit only
- `context_paths`, `diff_refs`, and `required_output_paths` can add bounded context, target diff summary, and required artifact checks to a phase audit
- injected LLM-as-judge output is merged with deterministic findings, so a judge cannot erase phase failures, gate failures, or empty output Criticals

Parallel groups run per-phase audits first, then a group-level `group-consistency` audit after all sibling phases drain.

## TaskCard and bounded execution

`harness run --task-card <path>` is the preferred real-execution input. `--task-card` is mutually exclusive with `--brief` and `--prompt`; brief/prompt remain useful for ad-hoc runs, but runtime governance consumes the TaskCard.

TaskCard fields are fixed:

```ts
interface TaskCard {
  goal: string;
  acceptance_criteria: string[];
  allowed_paths: string[];
  denied_actions: string[];
  test_commands: string[];
  risk_level: "low" | "medium" | "high";
  budget: {
    max_turns?: number;
    max_tokens?: number;
    max_cost_usd?: number;
    timeout_seconds?: number;
    max_tool_calls?: number;
  };
  human_review_required: boolean;
  context_paths: string[];
}
```

Runtime behavior:

- Copy the parsed card to `task-card.json` and write `task-card.sha256`.
- Inject `task_card_hash`, acceptance criteria, allowed paths, denied actions, tests, and budget into every phase prompt.
- Apply `budget.timeout_seconds` as an upper bound on phase provider stall timeout; phase spec may tighten but cannot loosen it.
- Validate `result.json.changed_files` against `allowed_paths`; out-of-policy edits are Critical.
- Record TaskCard hash in `run.json`, `session.json`, `summary.md`, and `run-family.json`.

## Result schema, budget, risk, and rollback

Phase spec may declare:

```yaml
output_schema: phase-result-v1
required_artifacts:
  - docs/productlist/architect.md
```

The MVP validates the built-in `phase-result-v1` shape and required artifacts. Custom `output_schema` values are recorded in `phase_graph.json`; richer custom schema validation can be added later without changing the phase protocol.

Governance rules:

- Missing or invalid `result.json` is Critical if the JSON is present but invalid; if absent, runtime synthesizes a minimal result from `output.md` and records a warning.
- Missing `required_artifacts` is Critical.
- `changed_files` outside TaskCard `allowed_paths` is Critical and blocks checkpoint.
- `max_tokens`, `max_cost_usd`, and `max_tool_calls` are checked after each phase. Any overrun stops the run before checkpoint.
- Risk gate escalates for dependency/CI/release path edits, network/dependency/CI/test-failed risk flags, or off-policy edits.
- Before each phase, runtime captures `git diff --binary -- .` as a baseline when the cwd is a git repository.
- On phase failure, gate failure, audit block, result validation failure, budget overrun, or risk escalation, runtime writes `rollback/<phase_id>/rollback.md` with inspect commands and baseline path. It never runs destructive rollback automatically.

Run inspection commands:

```bash
harness run inspect <thread_id> --harness-repo <repo>
harness run view <thread_id> --harness-repo <repo>
harness eval ingest --run <thread_id> --harness-repo <repo>
```

`harness run view` writes `visualization/workflow.mmd` and `visualization/run.html`. The static HTML only reads `.harness/runs/<thread_id>/` artifacts.

The CLI execution entrypoint is:

```bash
harness run --compound <name> --thread-id <id> --brief <brief.md>
harness run --compound <name> --thread-id <id> --task-card <task-card.json>
harness run --skill <path/to/SKILL.md> --thread-id <id> --prompt "<brief>"
harness run --compound <name> --thread-id <id> --brief <brief.md> --judge-tool codex --judge-profile checkpoint-judge
harness run --resume <thread_id>
```

The execution MVP runs phases, contiguous `parallel_group` batches, pre-phase gates, result validation, budget/risk gates, post-phase audits, gate commands, checkpoint artifacts, run summary, and visualization. It stops on phase failure, provider stall, result validation Critical, budget overrun, risk escalation, audit Critical, gate failure, checkpoint `revise`, or checkpoint `escalate`. Provider stall detection watches for exhausted reconnect output such as `ERROR: Reconnecting... 5/5` and for configurable no-output timeouts via `provider_stall_timeout_seconds`; stalled phases write `partial-output.md` and use `reason=provider_stalled`. When a checkpoint or risk gate escalates, the run writes a notification request and pauses; `harness run --resume <thread_id>` continues from the first incomplete phase after a decision file is present.

The CLI does not enable provider-backed judgment by default. Without `--judge-tool`, the runtime writes deterministic-only checkpoint artifacts and still executes phases, deterministic audits, gates, replay, and visualization. With `--judge-tool claude-code|codex`, the same provider-backed judge is used for post-phase audit scoring and checkpoint decisions. Codex judge calls intentionally omit `--full-auto`; checkpoint/audit judgment is advisory and should not receive default write permissions.

## Safe command runner

Gate commands use structured argv:

```ts
interface GateCommand {
  id: string;
  kind: "compile" | "test" | "lint" | "diff" | "review" | "drift" | "env";
  cwd_ref: string;
  argv: string[];
  timeout_seconds: number;
  allowed_write_roots?: string[];
}
```

Rules:

- Use `spawn(file, argv, { shell: false })`.
- Reject empty argv.
- Reject shell metacharacters in `argv[0]`: `|`, `&`, `;`, `>`, `<`, `` ` ``, `$(`.
- Reject known write/destructive commands in gate context: `git commit`, `git push`, `git reset`, `git checkout`, `rm`, `mv`, `curl`, `wget`, `ssh`, `scp`.
- Gate commands may write only under declared `allowed_write_roots`; if this cannot be enforced for a command, the command is not allowed in checkpoint context.
- Timeout, stdout/stderr truncation, and exit code are recorded in `gates/<phase>.json`.

Fixed internal probes such as `git diff --stat` and file reads should be implemented as internal TS functions where practical, not as configurable shell strings.

## Deterministic gates

The checkpoint judge is advisory. Deterministic signals are authoritative:

```ts
interface DeterministicSignals {
  compile_pass: boolean;
  test_pass: boolean;
  lint_pass: boolean;
  diff_check_pass: boolean;
  reviewer_critical_count: number;
  drift_check_pass: boolean;
  acceptance_matrix_all_green?: boolean;
}
```

Gate rules:

- Missing signal means fail.
- `compile_pass === false`, `test_pass === false`, `lint_pass === false`, `diff_check_pass === false`, or `drift_check_pass === false` forces `revise` or `fail` according to stop conditions.
- `reviewer_critical_count > 0` forces `revise`.
- `acceptance_matrix_all_green` is optional. The default stop conditions do not require it, but compound skills may add it in `stop_conditions` frontmatter when a downstream contract such as C12 Acceptance Matrix exists.
- LLM judge can choose revise target and feedback wording, but cannot turn a failed deterministic signal into `go`.

## Checkpoint judge

Checkpoint input is intentionally small:

- `brief.md`
- previous phase `output.md`
- next phase contract or phase spec summary
- deterministic signal summary
- last three checkpoint decisions

Prompt templates live under `packages/core/src/runtime/checkpoint-prompts/*.tpl`. Templates are owned by the TypeScript runtime in this MVP; do not place them in Python-only paths.

Model selection defaults:

| Previous phase model class | Default checkpoint model |
| -------------------------- | ------------------------ |
| Opus-level                 | Sonnet 4.6               |
| Sonnet / Codex-level       | Haiku 4.5                |
| Drift checkpoint           | Sonnet 4.6               |

The phase spec may override the checkpoint model with `checkpoint_model`. The runtime checkpoint module must expose `model` as an input and enforce the default "judge is same tier or stronger" policy when no override is provided.

Checkpoint output:

```ts
interface CheckpointDecision {
  decision: "go" | "revise" | "escalate";
  confidence: number;
  reasoning: string;
  semantic_findings: Array<{
    category:
      | "contract_consistency"
      | "scope_drift"
      | "spec_completeness"
      | "impl_quality";
    severity: "critical" | "warn" | "info";
    where: string;
    what: string;
  }>;
  revise_target_phase?: string;
  revise_feedback_md?: string;
  escalate_question_md?: string;
}
```

Validation rules:

- Invalid JSON: retry once with the same input, then escalate.
- LLM call timeout greater than 60 seconds: escalate.
- `confidence < 0.6`: escalate.
- `decision === "revise"` requires `revise_target_phase` and `revise_feedback_md`.
- `decision === "escalate"` requires `escalate_question_md`.
- Deterministic gate override runs after schema validation.
- If the same checkpoint escalates twice in one run, route to `stop_conditions.failure`, write `summary.md`, and stop instead of writing another human notification.

## Pause and resume

MVP pause/resume is file based:

1. Escalation writes `.harness/runs/<thread_id>/notifications/<ts>.request.md`.
2. Runtime records `state.json.status = "paused"` and exits cleanly.
3. Human writes `.harness/runs/<thread_id>/notifications/<ts>.decision.md`.
4. User runs `harness run --resume <thread_id>`.
5. Runtime loads `state.json`, validates the decision, appends to `events.jsonl`, and continues from the next safe node.

No watcher is required for MVP. Webhooks, desktop notifications, and IM integrations are out of scope.

Corruption recovery:

- If `state.json` is missing or invalid, scan phase artifact directories conservatively.
- Mark state as `needs_user_review`.
- Write a recovery request and pause; do not continue automatically.

## Stop conditions

Default stop conditions:

```yaml
success:
  all_of:
    - compile_pass
    - test_pass
    - lint_pass
    - diff_check_pass
    - drift_check_pass
    - reviewer_critical_count == 0
failure:
  any_of:
    - phase_retry_count >= 3
    - total_revisions >= 5
    - elapsed_minutes >= 120
    - estimated_dollars >= 5.0
    - same_checkpoint_escalated_twice
pause_for_human:
  any_of:
    - checkpoint_decision == "escalate"
    - revise_target_phase == "architect"
```

Any compound override must keep at least one success criterion and one failure budget.

Compound-specific success criteria, including `acceptance_matrix_all_green`, are allowed only through compound `SKILL.md` frontmatter `stop_conditions` overrides. The default global stop conditions stay generic.

## Eval scenario and A/B compare

Lightweight local scenarios live under `evals/scenarios/*.yaml`:

```yaml
scenario_id: productlist-red
compound: compound-km-auto-feature
task_card: ../../docs/productlist/task-card.json
prompt: "目标：只跑 architect 到 TDD RED"
expected_artifacts:
  - docs/productlist/architect.md
  - docs/productlist/todo.md
deterministic_assertions: []
```

Commands:

```bash
harness eval run --scenario productlist-red --harness-repo ~/Workspace/sailor-harness
harness eval compare --base .harness/runs/productlist-base --head .harness/runs/productlist-head
```

Fixed compare metrics:

- `task_success_rate`
- `tests_green_rate`
- `trace_completeness`
- `off_policy_edit_rate`
- `checkpoint_recovery_rate`
- `p50_latency_ms` / `p95_latency_ms`
- `total_tokens`
- `estimated_cost_usd`

Scenario execution is local and uses the same `harness run` runtime; it does not introduce a second orchestrator.

## Implementation phases

Each phase is a separate Codex task.

Hard rule for every phase:

1. Implement only that phase.
2. Run the phase acceptance checks.
3. Commit exactly that phase.
4. Print `VERDICT M<n>: PASS` or `VERDICT M<n>: FAIL <reason>`.
5. Stop. Do not continue to the next phase without a new user prompt.

### M0: Contract tests for existing TypeScript behavior

Add tests that lock current `sync`, `diff`, adapters, context visibility, hooks, plugins, MCP, and generated manifest behavior. These tests are the oracle for later changes.

Acceptance:

- Existing `npm test`, `npm run build`, and new contract tests pass.
- Tests cover at least one Codex-only fixture, one Claude+Codex fixture, and one fixture with context visibility / MCP / hooks.

Commit: `M0: add autonomous contract tests`

### M1: Schema v2 and v1 compatibility

Add `schema_version: 2`, `agent_tools`, and per-tool `models` parsing to the existing TS schema.

Acceptance:

- v2 config parses.
- v1 config still parses with deprecation warning for old `models`.
- invalid tool names and unknown agent tool assignments fail.

Commit: `M1: add schema v2 routing config`

### M2: Agent routing and Codex profile rendering

Implement adapter projection filtering and Codex profile rendering based on `agent_tools`.

Acceptance:

- Claude projection includes only Claude-routed agents.
- Codex profile set includes only Codex-routed agents.
- Existing generated Codex permission fragments, including `default_permissions`, remain valid TOML.
- Phase specs are parsed from `skills/compound/<name>/SKILL.md` frontmatter `phases:` and left untouched by `harness sync`.

Commit: `M2: route agents and render codex profiles`

### M3: Safe command runner and deterministic gate schema

Add structured gate command execution and deterministic signal aggregation.

Acceptance:

- `shell: false` spawn is used.
- shell metacharacters and destructive/network commands are rejected.
- missing/false deterministic signals override judge `go` in unit tests.

Commit: `M3: add safe gate runner`

### M4: Run store

Add `.harness/runs/<thread_id>/` state store with `state.json`, `events.jsonl`, phase artifacts, and a lock file.

Acceptance:

- run root preflight fails if `.harness/` is not ignored.
- custom `--run-root` is checked before writes.
- lock prevents two processes from mutating the same run.
- lock files use `{pid, hostname, started_at_iso, run_id}` and stale same-host dead-PID locks are cleared safely.
- `events.jsonl` uses the `RunEvent` schema and serializes writes through the run lock.
- `estimated_dollars` is recomputed on startup and resume by aggregating phase and checkpoint `cost.json` files.

Commit: `M4: add autonomous run store`

### M5: Phase executor

Add phase execution that resolves `cwd_ref`, chooses tool/profile, spawns the agent subprocess, and records outputs.

Acceptance:

- cwd is resolved from config and phase spec, not hardcoded.
- mock `claude` and `codex` subprocesses receive expected argv/cwd.
- no sailor-harness-specific agent table exists in runtime code.
- phase `mode` is passed through to provider execution: Claude Code uses `--permission-mode <mode>`; Codex defaults to `--full-auto`, while `mode: plan` maps to read-only non-full-auto execution.
- stdout/stderr use a tee protocol: pipe from child process, parse lines for session IDs, mirror live output to the parent process, and append complete logs to `phases/<id>/stdout.log` and `stderr.log`.
- each phase writes fingerprinted `prompt.md`, `session.json`, and trajectory/audit summaries for node replay.
- each phase can declare `pre_phase_gate_commands`; env failures return `environment_blocked` without spawning the agent.
- phase completion requires `exit_code === 0`, `output.md` exists, and `output.md` size is greater than zero; otherwise the phase is failed and routed through `phase_retry_count`.
- failed or interrupted phases write `partial-output.md`, and resume repairs phase directories that have prompt/log files but no `exit_code.json`.
- phases sharing `parallel_group` run concurrently, group checkpoint waits for all siblings, and partial group failure drains siblings before routing.
- each phase runs a read-only post-phase audit; Critical findings block the next phase while non-Critical score drops remain advisory.
- `phase_graph.json` preserves source phase order, parallel groups, tool/profile/cwd metadata, and drives inspect/view ordering.
- `harness run inspect <thread_id>` and `harness run view <thread_id>` can read liveness, stale/interrupted artifacts, audits, group audits, trajectory reliability, and partial outputs.
- each phase writes `cost.json` with `{tokens_in, tokens_out, model, dollars}` when cost data is available.

Commit: `M5: add phase executor`

### M6: Advisory checkpoint

Add checkpoint judge schema parsing, validation, retry, and deterministic override.

Acceptance:

- invalid JSON retries once then escalates.
- checkpoint model can be set per phase and defaults follow the model selection table.
- checkpoint calls timeout after 60 seconds and escalate.
- confidence below threshold escalates.
- deterministic fail overrides LLM `go`.
- checkpoint cost is recorded separately and included in `estimated_dollars`.

Commit: `M6: add advisory checkpoint`

### M7: File-based pause/resume

Implement escalation request files and `harness run --resume <thread_id>`.

Acceptance:

- paused run exits cleanly.
- resume with valid decision continues.
- completed/failed/corrupted state fixtures behave deterministically.
- same checkpoint escalated twice routes to failure summary, not another pause.

Commit: `M7: add file resume protocol`

### M8: Drift checkpoint

Add drift checkpoint that can only return `go` or `escalate`.

Drift input strategy:

- Always include the original brief and the phase graph summary.
- Include each completed phase `output.md` up to 10KB.
- If combined input exceeds the checkpoint budget, first summarize each phase output with a deterministic heading-preserving truncation, then run the drift judge on the summaries.
- Never include raw stdout/stderr logs unless a phase output is missing and the runtime is already escalating.

Acceptance:

- brief/output mismatch escalates.
- normal fixture proceeds.
- drift check cannot route directly to revise.

Commit: `M8: add drift checkpoint`

### M9: Mock compound end-to-end

Run a small compound fixture with mocked agents and mocked gates.

Acceptance:

- green path writes summary.
- revise path retries within budget.
- escalation path pauses and resumes.
- failed gate path cannot be overruled by judge.

Commit: `M9: add autonomous e2e fixture`

### M10: Real harness dry-run preflight

Add a dry-run command path that validates a real `sailor-harness` shaped repo without mutating it.

Acceptance:

- no files under `~/Workspace/sailor-harness` are modified by tests.
- dry-run reports phase graph, cwd refs, run root, and required ignored paths.
- real execution remains a manual follow-up after review.

Commit: `M10: add real harness dry-run preflight`

## Validation commands

Before each phase commit:

```bash
npm run build
npm test
npm run lint
npm run typecheck
git diff --check
```

## Productlist Real Run Retrospective

This section records gaps found during the `sailor-harness` productlist experiment on
2026-05-05. The run used real target repos and exposed behavior that mock fixtures did
not cover.

### What worked

- `harness run inspect` can read run artifacts and show phase status, audit score,
  Critical count, trajectory status, and event counts.
- `trajectory/<phase_id>/summary.json` and normalized `events.jsonl` were captured for
  successful or normally failed Codex phases.
- Post-phase deterministic audit correctly blocked non-zero phase exits and empty phase
  output.
- Static `visualization/run.html` and `workflow.mmd` were generated for normal failed
  runs.
- Target phases no longer need target-repo `.codex/config.toml` profiles when the
  runtime passes resolved Codex model config directly with `codex exec --config`.

### Gaps found

Status as of 2026-05-06: stale lock liveness, interrupted phase repair, fingerprint trajectory binding, outlier usage exclusion, deterministic-only checkpoint artifacts, phase graph ordering, pre-phase env gates, provider stall watchdog, and required-output audit checks have been implemented in the TypeScript runtime. The table below keeps the productlist learnings and marks the remaining work explicitly.

| gap                                                        | observed symptom                                                                                                                                          | impact                                                                                                                                        | required fix                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Interrupted run finalization is only partially automated   | Manually killed `productlist_feature_shop_product_list_20260505_finish` kept `state.json.status = "running"` and had no `exit_code.json` or `summary.md`. | New inspect/resume can repair phase artifacts, but signal-time final summary still depends on process shutdown behavior.                      | Add signal handlers that mark the active phase and run interrupted before process exit.                                                         |
| Stale lock recovery needs more UX                          | Killed run left `lock` in the run root.                                                                                                                   | Runtime can report `stale` and resume can clear dead same-host locks, but inspect is intentionally non-invasive.                              | Keep inspect read-only; add clearer CLI hints and optional `harness run recover <thread_id>` if manual repair is needed.                        |
| Provider reconnect can hang indefinitely                   | Codex printed `ERROR: Reconnecting... 2/5` through `5/5`, then continued without finishing until manually killed.                                         | Runtime now routes reconnect exhaustion and no-output timeout to `provider_stalled`; richer provider-specific heuristics may still be useful. | Keep adding provider fixtures for future Codex/Claude CLI wording changes and expose a global CLI default if phase-level timeout is not enough. |
| Manual recovery splits one logical workflow into many runs | Productlist artifacts were spread across `*_final`, `*_platform`, `*_android_retry`, and `*_finish`.                                                      | New TaskCard-hash family metadata lets inspect/view show family summary, but cross-run DAG rendering is still shallow.                         | Extend `run-family.json` visualization from summary-only to full stitched DAG with recovery edges.                                               |
| Trajectory raw log is not archived by default              | Some failed platform phases in `*_final` pointed at the plan session and showed a `productlist-plan` preview.                                             | Fingerprint binding now prevents mis-association, but missing raw logs still leave a replay gap.                                              | Keep normalized-only default; add explicit raw-log opt-in with privacy/storage warning if needed.                                               |
| Cost/token aggregation still depends on provider quality   | Some summaries showed implausibly high `total_tokens`.                                                                                                    | Outliers are excluded from totals, but unknown provider cost still may be unavailable.                                                        | Add provider-specific cost adapters and mark unknown cost as `unavailable` instead of numeric zero.                                             |
| Audit timing can miss post-gate context                    | Android retry phase audit scored `1` before gate failure, then the run failed at gate.                                                                    | Node review can look green while final node status is red.                                                                                    | Generate a post-gate audit summary or merge gate failures into the phase audit artifact after gates run.                                        |
| Finish/report phase had no fallback                        | When Codex stalled during consistency review, no automated `architecture-parity.md` or `report.md` was produced.                                          | Important experiment conclusions rely on manual reconstruction.                                                                               | Add local deterministic report fallback from `state.json`, phase outputs, audits, gates, and target git status.                                 |
| Run view is per-run plus family summary                    | Each partial recovery has its own visualization.                                                                                                          | Current HTML shows family count/hash, but not a merged phase DAG across runs.                                                                  | Render a stitched run family timeline and show recovery edges.                                                                                  |

### Immediate backlog

Prioritize these before the next long real experiment:

1. **Signal-time interruption finalization**: `SIGINT` / `SIGTERM` should write
   `summary.md` before exit, not just rely on resume repair.
2. **Full run-family visualization**: show recovery edges and merged phase DAG, not only family count/hash.
3. **Post-gate audit merge**: make phase audit artifacts reflect gate failures.

### Suggested fixture additions

- A Codex stderr fixture containing reconnect lines and no exit, expected
  `provider_stalled`. Basic phase and autonomous-run coverage exists; add
  provider raw-log replay fixtures if CLI wording changes.
- A run with an active lock whose PID is dead, expected stale liveness and resume
  recovery event. Basic coverage exists; add an end-to-end autonomous fixture.
- Two phases whose time windows overlap but only one has a matching fingerprint,
  expected no trajectory cross-claim. Basic resolver coverage exists.
- A target Android fixture without SDK configuration, expected
  `environment_blocked` instead of generic compile fail. Basic gate-runner
  coverage exists; add an end-to-end autonomous run fixture.
- A recovery family fixture with three partial runs, expected aggregated inspect output.

For docs-only updates:

```bash
git diff --check
```

## Out of scope

- Full Python rewrite.
- LangGraph runtime.
- LangGraph server/client APIs.
- Web UI.
- Webhook, IM, desktop notification integrations.
- Multi-run parallel scheduler.
- Automatic real `sailor-harness` mutation during harness-cli tests.

## Future ADR candidates

- Python runtime migration after TS autonomous MVP is stable.
- LangGraph or Temporal orchestration if file-based TS orchestration becomes insufficient.
- Remote run store and richer observability.
- Cloud-hosted execution and cost controls.

Trigger a Python/LangGraph ADR evaluation if either condition becomes true:

- Autonomous runtime implementation exceeds 800 lines of orchestration code excluding tests.
- Pause/resume produces more than three confirmed bugs after M9.

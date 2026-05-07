# Stage 1.15 Adopt

## 范围 / 不做

Stage 1.15 的目标是把一个已有的 Claude Code 工作区反向迁出成独立 harness 仓，并验证 sync 可以再把它零漂移写回原仓。

本阶段只做：

- `harness adopt <source>`
- `claude-code` 反向抽取
- `docs` / `metrics` 两个 passthrough capability
- `sync` / `diff` 的 `--harness-repo` 读写分离
- Sailor 首迁与 zero drift 验证

本阶段不做：

- Codex / Cursor 反向 adopt
- harness 仓合并
- 语义去重或 base rule 抽取

## CLI 设计

```bash
harness adopt <source> \
  [--output <target>] \
  [--name <name>] \
  [--dry-run] \
  [--interactive] \
  [--force] \
  [--skip <capability>] \
  [--tools claude-code]
```

当前 `--tools` 仅支持 `claude-code`。`--interactive` 会先 dry-run 探测 capability，再逐项确认是否纳入最终 adopt，未确认的 capability 会自动折算为 `--skip`。

`sync` / `diff` 新增：

```bash
harness diff --harness-repo <path>
harness sync --harness-repo <path> [--adopt-settings]
```

它们从 harness repo 读取 `harness.yaml` 与 source assets，但仍把产物写入当前工作目录，并把 manifest 维护在当前工作目录。

## 反向抽取规则

标准 capability：

- `.claude/agents/*.md` → `agents/*.md`
- `.claude/skills/**` → `skills/**`
- `.claude/rules/*.md` → `rules/*.md`
- `.claude/scripts/**` → `scripts/**`
- `.claude/commands/*.md` → `commands/*.md`
- `.claude/reference-project.json` → `reference-project.json`

passthrough capability：

- `.claude/docs/**` → `docs/**`
- `.claude/metrics/**` → `metrics/**`

`metrics` 会显式排除 runtime 数据：

- `events.jsonl`
- `events.jsonl.*`

其它 `.claude` runtime 数据不会进入 harness repo，而是自动写入 `.gitignore`：

- `.claude/settings.local.json`
- `.claude/state/`
- `.claude/sediment/`
- `.claude/scheduled_tasks.lock`
- `.claude/reference-project.local.json`
- `.claude/metrics/events.jsonl`
- `.claude/metrics/events.jsonl.*`

## passthrough adapter 设计

Stage 1.15 不能直接复用 Stage 1.8~1.14 的“生成式” claude adapter，因为 Sailor 现存 `.claude` 文件本身不带 harness marker。

所以本阶段把 `claude-code` 分成两条路径：

- 旧配置：保持原来的生成式行为，继续渲染 `CLAUDE.md` / `.claude/...` 并注入 marker
- adopt 配置：显式声明 `adapters.claude-code.capabilities`，进入 raw passthrough 模式

raw passthrough 模式的关键约束：

- 不生成 `CLAUDE.md`
- `agents / commands / rules / skills / scripts / docs / metrics / reference_projects` 都按原始字节回放
- `metrics` 只排除 runtime `events.jsonl*`
- mode 保留，脚本的 `+x` 不丢

这让反向迁出的 harness repo 能在 `sync --harness-repo` 时把 `.claude/` 原样写回业务仓。

## settings.json 反向抠算法

从 `.claude/settings.json` 解析：

- `hooks` → `harness.yaml hooks`
- `mcpServers` → `mcp.servers`
- `enabledPlugins` 或 `plugins[]` → `plugins.enabled`
- `marketplaces` 或 `extraKnownMarketplaces` → `plugins.marketplaces`

明确不接管：

- `permissions`
- `env`
- `teammateMode`
- `settings.local.json`

为了 Sailor zero drift，本阶段还做了一个 adopt-aware 细节：

- 现有 partial-json merger 在 `--adopt-settings` 下如果发现 owned subset 与计划值语义相等，就只写 manifest，不重写 `.claude/settings.json`
- 这样即使源文件的 key 顺序或空 matcher 写法与当前 renderer 不完全一致，也能在首次 adopt 时保持文件字节不变

另一个配套改动是：在 `claude-code` capability passthrough 模式下，non-matcher lifecycle event 的空 `matcher: ""` 会保真透传，不触发 Stage 1.12 默认的“剥除 matcher”逻辑。

## 自动 .gitignore

adopt 输出的 `.gitignore` 当前包含：

```gitignore
.harness/
.claude/settings.local.json
.claude/state/
.claude/sediment/
.claude/scheduled_tasks.lock
.claude/reference-project.local.json
.claude/metrics/events.jsonl
.claude/metrics/events.jsonl.*
```

## Sailor 首迁实操记录

### Step 1

```text
$ node packages/cli/dist/cli.js adopt /Users/zhangzhengtian02/Workspace/sailor_fe_c_kmp --output /Users/zhangzhengtian02/Claude/sailor-harness --name sailor-harness
Adopted harness workspace in /Users/zhangzhengtian02/Claude/sailor-harness
Created: 73
Capabilities: 9
Skipped: 0
Warnings: 0
```

### Step 2

```text
$ tree -L 2 /Users/zhangzhengtian02/Claude/sailor-harness
/Users/zhangzhengtian02/Claude/sailor-harness
├── agents
├── AGENTS.md.template
├── docs
├── harness.yaml
├── metrics
├── reference-project.json
├── rules
├── scripts
└── skills
```

`harness.yaml` 头部如下：

```yaml
schema_version: 1
name: sailor-harness
description: Migrated from /Users/zhangzhengtian02/Workspace/sailor_fe_c_kmp at 2026-04-29T02:25:03.115Z
tools:
  - claude-code
canonical:
  instructions: ./AGENTS.md.template
adapters:
  claude-code:
    enabled: true
    target: .
    capabilities:
      - agents
      - skills
      - rules
      - scripts
      - hooks
      - plugins
      - reference_projects
      - docs
      - metrics
```

### Step 3

```text
$ cp -r .claude .claude.backup-stage1-15
backup-created:.claude.backup-stage1-15
```

### Step 4

```text
$ node /Users/zhangzhengtian02/Claude/harness-cli/packages/cli/dist/cli.js diff --harness-repo /Users/zhangzhengtian02/Claude/sailor-harness
Warning: plugin "claude-mem@thedotmack" references undeclared marketplace "thedotmack".
No drift detected.
Added: 0
Modified: 0
Removed: 0
Unchanged: 71
```

### Step 5

```text
$ node /Users/zhangzhengtian02/Claude/harness-cli/packages/cli/dist/cli.js sync --harness-repo /Users/zhangzhengtian02/Claude/sailor-harness --adopt-settings
Warning: plugin "claude-mem@thedotmack" references undeclared marketplace "thedotmack".
Sync completed with no changes.
Added: 0
Modified: 0
Removed: 0
Unchanged: 71
```

文件级对比：

```text
$ diff -r .claude.backup-stage1-15 .claude | grep -v "state/" | grep -v "sediment/" | grep -v "events.jsonl" | grep -v "settings.local.json" | grep -v "scheduled_tasks.lock" | grep -v "reference-project.local.json"
# 无输出
```

结论：Sailor 首迁 zero drift 通过。

## 已知限制

- 只支持 Claude Code 反向 adopt；Codex / Cursor 留到 Stage 1.16+
- 不做 harness 仓合并；多仓汇总留到 Stage 1.17
- `plugins.enabled` 若引用了未声明 marketplace，仍会保留现有 warning；Stage 1.15 不会凭空补 marketplace source

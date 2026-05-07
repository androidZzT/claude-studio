# Stage 2.0 Eval Infrastructure

## 目标

Stage 2.0 只实现 Eval trajectory 子系统的基础设施层：

- `CommonEvent` 统一事件模型
- `TrajectoryAdapter` 抽象
- Inspect AI EvalLog writer
- `harness eval ingest` / `harness eval list`
- `stub` adapter 端到端测试闭环

本阶段**故意不做**真实 Claude Code / Codex jsonl parser，也不做 live tail、diff、replay、view、annotate、export。

## 三层职责划分

### 1. `CommonEvent`

`packages/core/src/eval/common-event.ts`

这是 agent-specific 原始轨迹与上层 EvalLog 输出之间的最小公共中间层：

- 统一 `source / session_id / event_id / timestamp / kind`
- 按需携带 `model / tool / text / thinking`
- 用 `parent_event_id / subagent_id / turn_id` 保留关系信息
- 用 `raw` 做 escape hatch，避免 Stage 2.0 为了追求完美抽象而丢信息

设计重点：schema 只保证字段形状，不在这里强行做 kind-aware 的完整语义约束。比如 `kind: "model"` 时不要求 `model.id` 必定存在，真正写 EvalLog 时再做 helper 断言。

### 2. `TrajectoryAdapter`

`packages/core/src/eval/trajectory-adapter.ts`

这是 trajectory parser 抽象，和 `packages/core/src/adapters/` 下的工具 adapter 是两套概念：

- 工具 adapter：把 `harness.yaml` 渲染到目标文件系统
- trajectory adapter：把某种 agent 的 session line 解析成 `CommonEvent`

因此专门命名为 `trajectory-adapter.ts`，避免和 `codex/cursor/claude-code` 的 sync adapter 混淆。

### 3. EvalLog writer

`packages/core/src/eval/evallog-writer.ts`

writer 只负责把 `CommonEvent[]` 映射成最小可用的 Inspect AI EvalLog：

- 顶层固定 `version: 2`
- `eval.task = "harness-trajectory"`
- 单 sample 输出
- `session_meta` 事件提升到 `eval.metadata`
- 其他 kind 落入 `samples[0].events`

兼容策略是：

- **v1 求 `inspect view` 能加载**
- 不追求一上来 100% 覆盖 Inspect AI 全 schema
- writer 自带最小 schema 校验，保证输出至少满足本项目约定的必填字段

## 为什么 Stage 2.0 用 stub adapter

真实 CC / Codex parser 会把 Stage 2.0 的复杂度直接拉到字段对照、增量解析、事件归一化上，容易把基础设施层和格式适配层耦在一起。

因此本阶段只放一个 `stub` pass-through adapter：

- 每行 JSONL 只做 `JSON.parse`
- 一律包成 `kind: "lifecycle"`
- `raw` 原样保留

这样我们能先把“读 jsonl -> 归一事件 -> 写 EvalLog -> list run”整条管道打通，并且给 Stage 2.1 / 2.2 预留稳定接口。

## CLI 范围

Stage 2.0 只提供两个命令：

- `harness eval ingest <jsonl> --scenario <id> [--source stub]`
- `harness eval list [--scenario <id>]`

对于 `--source claude-code` / `--source codex`：

- 明确报 `not implemented yet`
- 指向 Stage 2.1 / 2.2
- 不偷偷做半成品 parser

## 存储边界

EvalLog 仅写入：

```text
.harness/logs/<scenario_id>/run_<timestamp>_<id>.eval
```

这些文件：

- 加入 `.gitignore`
- 不进入 `manifest.json`
- 不参与 `sync / diff`

这能保证 trajectory 数据是本地运行时资产，不会污染现有 Stage 1 的 declarative sync 语义。

## 未来扩展点

### Stage 2.1 / 2.2

- Claude Code jsonl parser
- Codex rollout jsonl parser

### Stage 2.3+

- `harness eval diff`
- replay / annotate / export

### 更后面的增强

- live tail / watch 模式
- scenario library
- spawn agent orchestration
- attachment dedupe / large artifact handling

当前基础设施的目的，就是让这些能力都建立在同一条 `adapter -> CommonEvent -> EvalLog` 管道上，而不是各自重做一次解析与存储。

# Stage 2.4 Funnel Scorer MVP

## 范围

Stage 2.4 只实现 roadmap 1.3 里最小可落地的漏斗打分能力：

- 质量轨 6 个静态指标
- 性能轨 6 个静态指标
- `harness eval funnel`
- `harness eval score`
- `harness eval ingest` 自动写入 `scores[]`

本阶段故意不做：

- bug 归因
- `pass@k` / `pass^k`
- `annotate` / `export` / `diff` / `replay`
- live tail
- 任何单一“总分”合成

## 指标定义

指标公式严格对齐 `../../architecture/harness-as-code-roadmap.md` 1.3 节。

### 质量轨

- `tech_design_conformance = 1 - violations / totalRules`
- `adoption_rate = 1 - reworkLines / aiProducedLines`
- `review_pass_efficiency = 1 / reviewRound`
- `first_pass_rate = firstPassPRs / totalPRs`
- `smoke_pass_rate = smokePassed / smokeTotal`
- `bug_density = bugCount / (totalLOC / 1000)`，单位 `bug/KLOC`

### 性能轨

- `n_turns = count(kind === "user_input")`
- `n_toolcalls = count(kind === "tool_call")`
- `n_total_tokens = sum(model usage)`
- `time_to_first_token = first model ts - first user ts`
- `output_tokens_per_sec = total output tokens / total model latency seconds`
- `time_to_last_token = last event ts - first event ts`

## Schema 设计

`packages/core/src/eval/scorer/types.ts`

`FunnelScore` 采用 add-only 设计：

- `schema_version = 1`
- `quality.*` 全部允许 `null`
- `performance.*` 中计数指标恒有值，延迟指标允许 `null`

这样后续补：

- bug 归因
- `pass@k`
- `pass^k`

时只需要新增字段，不需要破坏既有消费者。

## 数据源边界

### 核心 extractor

所有 extractor 都是纯函数：

- 输入是结构化对象或 `CommonEvent[]`
- 不直接读文件
- 不直接查 git
- 不直接解析 `events.jsonl`

### CLI 层适配

CLI 负责把外部源转成结构化输入：

- `--events` → Sailor review 事件
- `--bugs` → Markdown bug list
- `--repo` → tracked LOC + 规则计数
- `--lint` → lint violations
- `--smoke` → smoke report

解析失败时只 skip 相关指标，不阻断主流程。

## 性能 vs 质量

性能轨只依赖 trajectory，因此：

- `eval ingest` 无条件计算性能 6 指标

质量轨依赖外部 artifact，因此：

- 输入缺失时对应字段写 `null`
- 不因为缺少 `events.jsonl` / `bugs.md` / `lint report` 而让 ingest 失败

## EvalLog 集成

Stage 2.4 往 `results.scores[]` 写入 1 个 score：

```json
{
  "scorer": "harness/funnel",
  "value": null,
  "answer": null,
  "metadata": {
    "schema_version": 1,
    "quality": { "...": null },
    "performance": { "...": 0 }
  }
}
```

关键约定：

- `value` 固定 `null`
- 不强行合成单一总分
- 完整漏斗结构进入 `metadata`

## 真实 E2E 结果

以下结果来自 2026-04-28 在本机真实数据上的手工运行。

### 1. Claude Code trajectory

命令：

```bash
node packages/cli/dist/cli.js eval funnel \
  --trajectory /Users/zhangzhengtian02/.claude/projects/-Users-zhangzhengtian02-Claude-cc-studio/ede51426-5bdf-43e6-9e79-162dfbee3f2a.jsonl \
  --format table
```

输出：

```text
Funnel Score (schema_version=1)
Quality
  tech_design_conformance  —
  adoption_rate            —
  review_pass_efficiency   —
  first_pass_rate          —
  smoke_pass_rate          —
  bug_density              —
Performance
  n_turns                  1
  n_toolcalls              8
  n_total_tokens           78328
  time_to_first_token      3.893
  output_tokens_per_sec    38.7173
  time_to_last_token       1293982.808
```

### 2. Codex trajectory

命令：

```bash
node packages/cli/dist/cli.js eval funnel \
  --trajectory /Users/zhangzhengtian02/.codex/sessions/2026/04/24/rollout-2026-04-24T16-29-13-019dbe9b-78a9-7e70-9004-6a0f4897d09e.jsonl \
  --format table
```

输出：

```text
Funnel Score (schema_version=1)
Quality
  tech_design_conformance  —
  adoption_rate            —
  review_pass_efficiency   —
  first_pass_rate          —
  smoke_pass_rate          —
  bug_density              —
Performance
  n_turns                  52
  n_toolcalls              1548
  n_total_tokens           328651148
  time_to_first_token      0.465
  output_tokens_per_sec    70.7127
  time_to_last_token       356542.725
```

备注：Codex 的 `token_count` 是累计快照，因此 scorer 会优先读取 `last_token_usage` 作为增量；否则 `n_total_tokens` 会被重复累加到不可用。

### 3. Codex trajectory + Sailor artifacts

命令：

```bash
node packages/cli/dist/cli.js eval funnel \
  --trajectory /Users/zhangzhengtian02/.codex/sessions/2026/04/24/rollout-2026-04-24T16-29-13-019dbe9b-78a9-7e70-9004-6a0f4897d09e.jsonl \
  --events /Users/zhangzhengtian02/Workspace/sailor_fe_c_kmp/.claude/metrics/events.jsonl \
  --bugs /Users/zhangzhengtian02/Workspace/sailor_fe_c_kmp/kkmp-shop/docs/productlist/bugs.md \
  --repo /Users/zhangzhengtian02/Workspace/sailor_fe_c_kmp \
  --format table
```

输出：

```text
Funnel Score (schema_version=1)
Quality
  tech_design_conformance  —
  adoption_rate            0.8
  review_pass_efficiency   1
  first_pass_rate          1
  smoke_pass_rate          —
  bug_density              0.038
Performance
  n_turns                  52
  n_toolcalls              1548
  n_total_tokens           328651148
  time_to_first_token      0.465
  output_tokens_per_sec    70.7127
  time_to_last_token       356542.725
```

这次没有带真实 `lint` / `smoke` 报告，因此对应质量指标保持 `null`。

## 与现有 parser 的衔接

- Claude Code parser 提供 `thinking / tool_use / tool_result`
- Codex parser 提供 `response_item + event_msg` 双流
- scorer 不关心 source-specific envelope，只消费 `CommonEvent[]`

这样 Stage 2.4 不需要改 `CommonEvent schema`，也不需要改 ingest 主干。

## 未来扩展

- bug 归因：需要 LLM judge，不属于静态 extractor
- `pass@k` / `pass^k`：需要多 run 聚合
- 横向对比：按 scenario / branch / source 做 cohort report
- live tail：把同样的 scorer 接到增量事件流

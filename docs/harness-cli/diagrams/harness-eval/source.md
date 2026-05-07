# harness eval 架构 — source

来源：`docs/harness-cli/architecture/eval-trajectory.md` 的核心设计。本图聚焦"trajectory 捕获 → 适配 → 输出 → 消费"主链路。

## 主链路（数据流）

1. 两套 agent 各自把 session 事件 append 到本地 jsonl 文件
   - Claude Code: `~/.claude/projects/<hash>/<sessionId>.jsonl`
   - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`

2. 三种 trajectory adapter（均实现同一 `TrajectoryAdapter` 接口）解析每行 jsonl
   - CC Parser（解析 Claude Code flat-fields 结构）
   - Codex Parser（解析 Codex `{timestamp, type, payload}` 三件套）
   - Stub Adapter（pass-through，仅用于测试，把每行包成 `kind: lifecycle`）

3. 各 adapter 的输出汇合到统一的 `CommonEvent` 数据模型
   - 字段：`source / session_id / event_id / timestamp / cwd / kind / model / tool / text / thinking / parent_event_id / subagent_id / turn_id / raw`
   - `raw` 是逃生口，保留原始事件 JSON

4. `EvalLogWriter` 把 `CommonEvent[]` 序列化为 Inspect AI 兼容的 EvalLog JSON

5. 落盘到 `.harness/logs/<scenario_id>/<run-id>.eval`，由三类消费者使用：
   - `inspect view` 现成 viewer（不自己写 UI）
   - `harness eval` CLI 系列命令（list / show / diff / replay / export）
   - 团队共享导出（脱敏后 export）

## 关键约束

- 不走 LLM proxy（会丢 thinking signature 和 hook 流）
- 不追求 byte-deterministic 回放
- 默认回放语义是 Layer B（结构化 rerun + diff）
- trajectory 不进 git（`.harness/logs/` 在 .gitignore）

## 三层回放语义（侧栏标注）

- Layer A: Mock 回放（注入 ReplayLLMClient，验证 harness 逻辑）
- Layer B: 结构化 diff（rerun + 工具序列对比，日常 regression 主力）
- Layer C: LLM-as-judge（failure mode 标注）

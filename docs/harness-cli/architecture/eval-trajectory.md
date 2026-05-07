# Eval Trajectory 子系统设计

本文档整合两次调研（行业最佳实践 + Claude Code/Codex 实测字段对照）得出的 trajectory 捕获、回放、与 EvalLog 适配的工程设计。是 Stage 2.x 系列阶段的设计基础。

## 三项已固化决策

### 1. 存储格式 = Inspect AI EvalLog

不自己设计 schema。Inspect AI（Anthropic / UK AISI 出品）的 `EvalLog` 已有 sample / events / scores 三层抽象与官方 viewer。

**为什么不用 LangSmith / Langfuse 格式**：偏通用 LLM trace，会丢 Claude 特有的 `thinking signature`（加密签名，回放需保留）+ cache token 字段（成本评估必需）。

**输出文件**：`.harness/logs/<scenario_id>/<run_id>.eval`（JSON），可直接被 `inspect view` 加载。

### 2. 捕获机制 = Session 文件 sniff（主） + Hook marker（旁路），不走 LLM proxy

- **主通道**：`tail -f <session jsonl>`，按 uuid / 顺序增量入库
  - Claude Code: `~/.claude/projects/<hash>/<sessionId>.jsonl`
  - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
- **旁路通道**：PreToolUse / hook 写 `{kind:"harness_marker", scenario_id, step}` 嵌进同一条 trajectory，事后用 marker 切片
- **不走 LLM proxy**（LiteLLM/Helicone）：proxy 拿 wire-level 数据看似漂亮，但拿不到 hook 流和 thinking signature

### 3. 回放语义分三层，默认 Layer B

| 层 | 含义 | 用途 | Stage |
|---|---|---|---|
| **B 结构化 rerun + diff** | 重新跑 agent，比对工具序列 / 文件 diff / scorer 分数 | 日常 regression 主力 | 2.3 |
| A Mock 回放 | 注入 `ReplayLLMClient` 喂回录制响应，byte-deterministic | 验证 harness 逻辑（hook / tool wrapper） | 2.4 |
| C LLM-as-judge | 重跑 + judge 模型评分 | failure mode 标注 | 2.5+ |

**关键洞见**：byte-deterministic replay 只能验证 harness，不能验证 agent。追求字符级一致是死胡同。LangSmith 的 `unordered + superset` trajectory match 模式是日常 regression 的工业标准。

## Adapter 架构

```
                    ┌─► CC parser     ─┐
~/.claude jsonl ────┤                   │
                    └─► (per-event)  ─┐ │
                                      ├─├─► CommonEvent ─► EvalLog writer ─► .eval
                    ┌─► Codex parser ─┘ │
~/.codex jsonl  ────┤                   │
                    └─► (per-event)   ─┘
```

**包结构建议**：

```
@harness/agent-trajectory/
├── core/                   # 共享：CommonEvent + EvalLog writer + 附件去重
├── adapters/
│   ├── claude-code/        # cc jsonl parser
│   └── codex/              # codex rollout jsonl parser
└── cli/                    # harness eval run/diff/view
```

每个 adapter 后续可独立 publish（`@harness/cc-trajectory`, `@harness/codex-trajectory`），核心仍共享。CC adapter 单独发布有更广受众——任何 Claude Code 用户都可丢进 `inspect view`。

## Claude Code 与 Codex 字段对照（实测）

### 顶层结构差异

| 维度 | Claude Code | Codex |
|---|---|---|
| 顶层 wrapper | flat fields | `{timestamp, type, payload}` 三件套 |
| Event-specific 数据 | 在 root（`message`/`content`/`toolUseResult`） | 在 `payload` 内 |
| 主 event 类型 | `assistant` / `user` / `progress` / `attachment` | `response_item` / `event_msg` / `turn_context` / `session_meta` |
| Tool 调用 | `assistant.message.content[].type: "tool_use"` + 独立 `user` 事件 `toolUseResult` | `response_item` 内 + payload 子结构 |
| 子 agent | `isSidechain + parentToolUseID` | `turn_context` 切 turn 边界（**语义不同**） |

### 字段映射表

| CommonEvent 字段 | Claude Code source | Codex source |
|---|---|---|
| `session_id` | 文件名（`<uuid>.jsonl`） | `session_meta.payload.id` |
| `timestamp` | `timestamp` | `timestamp` |
| `event_id` | `uuid` | （无原生 uuid，需 `ts+seq` 合成） |
| `parent_event_id` | `parentUuid` | （需从 `turn_id` 推断） |
| `kind: model_response` | `type: "assistant"` | `type: "response_item"` |
| `kind: user_input` | `type: "user"` | `type: "response_item"` (role=user) |
| `kind: tool_call` | `message.content[].type: "tool_use"` | `payload` 内 tool call 字段 |
| `kind: tool_result` | `type: "user"` + `toolUseResult` | `payload.output` |
| `kind: session_meta` | （隐式从首事件） | `type: "session_meta"`（显式） |
| `kind: lifecycle` | `type: "progress"` + hookEvent | `type: "event_msg"` + 子 type |
| `model_id` | `message.model` | `payload.model_provider/model` |
| `usage.input_tokens` | `message.usage.input_tokens` | （Stage 2.2 需 sample 验证） |
| `usage.cache_*` | `message.usage.cache_creation/read_*` | （Codex 是否有 cache 待查） |
| `thinking` | `content[].type: "thinking"` + `signature` | （待 sample；OpenAI o1/GPT-5 有 reasoning） |
| `cwd` | `cwd`（每事件） | `session_meta.payload.cwd`（仅一次） |

## 三个隐私 / 工程要点

### 要点 1：Codex 在 trajectory 里 dump 完整 system prompt

`session_meta.payload.base_instructions.text` 含 ~6000 字 personality + formatting rules 全文。

**冲击**：
- `harness eval export` 默认必须 redact 此字段（或 `--include-base-instructions` 显式 opt-in）
- Claude Code 不 dump 此字段，所以两边脱敏策略可不同
- 团队共享 trajectory 之前必须经 export pipeline

### 要点 2：Codex dump `dynamic_tools` 定义完整 schema

`session_meta.payload.dynamic_tools` 含运行时注入的工具 JSON Schema（如 `automation_update` 的 inputSchema）。

**含义**：
- Codex trajectory **完全自包含**——可精确还原"当时能用什么工具"
- 对 replay/regression 友好：tool 集合稳定可对比
- Claude Code 的 jsonl **不**包含完整 tool definitions，依赖运行时上下文（这意味着跨 Claude Code 版本回放可能行为不同）

### 要点 3："Subagent" 概念在两边不通用

- Claude Code sidechain = 真子进程级 sub-agent（独立 LLM 调用循环）
- Codex turn_context = 对话 turn 切分（一次 user→assistant→tool→assistant 循环）

**不能映射到同一字段**。CommonEvent 设计：
- `parent_event_id` — 触发当前事件的事件（双方通用）
- `subagent_id` — 仅 CC
- `turn_id` — 仅 Codex
- adapter 各自填自己的字段，EvalLog sample 嵌套各有解读

## CommonEvent 数据模型

```ts
type CommonEvent = {
  // 通用字段（双方都有）
  source: 'claude-code' | 'codex'
  session_id: string
  event_id: string
  timestamp: string             // ISO 8601
  cwd?: string
  kind:
    | 'model'                   // assistant 响应（含 thinking）
    | 'tool_call'
    | 'tool_result'
    | 'user_input'
    | 'session_meta'
    | 'lifecycle'               // hook events / task_started 等
    | 'error'

  // 半通用字段（按 kind 出现）
  model?: {
    id: string
    provider: string            // 'anthropic' | 'openai' | ...
    usage?: TokenUsage
  }
  tool?: {
    name: string
    input?: unknown
    output?: unknown
    error?: string
  }
  text?: string                 // user/assistant 文本
  thinking?: {
    content: string
    signature?: string          // 仅 Claude Code 有
  }

  // 关系字段
  parent_event_id?: string
  subagent_id?: string          // 仅 CC
  turn_id?: string              // 仅 Codex

  // Escape hatch
  raw: unknown                  // 原始事件 JSON 保留
}

type TokenUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number  // CC only
  cache_read_input_tokens?: number      // CC only
}
```

`raw` 字段是**逃生口**：当 EvalLog 需要某字段而我们尚未抽象，可从 raw 取。避免 over-design 同时保信息保真。

## EvalLog 输出映射

每个 CommonEvent → 一个 Inspect AI EvalLog event：

| CommonEvent.kind | EvalLog event type |
|---|---|
| `model` | `ModelEvent` |
| `tool_call` | `ToolEvent`（input phase） |
| `tool_result` | `ToolEvent`（output phase） |
| `user_input` | `InputEvent` |
| `session_meta` | EvalSpec metadata（顶层） |
| `lifecycle` | `InfoEvent` |
| `error` | `ErrorEvent` |

CC 的 `subagent_id` 嵌套体现为 EvalLog 的 sample 嵌套（每个 sub-agent 一个 sample）。Codex 的 `turn_id` 体现为 sample 内 events 的分组 marker（不嵌套 sample）。

## CLI 形态预览

```bash
# 捕获
harness eval run <scenario>                    # spawn agent + tail jsonl + 转 EvalLog
harness eval list                              # 列出所有 run
harness eval show <run-id>                     # 文本展示

# 对比（Layer B regression）
harness eval diff <run-a> <run-b>              # unordered/superset 工具序列 + 文件 diff + scorer
harness eval diff --against-baseline <run-id>  # 对比 baseline

# 回放
harness eval replay <run-id> --mock            # Layer A：注入 ReplayLLMClient
harness eval replay <run-id>                   # Layer B：rerun + 自动 diff

# 视图
harness eval view                              # 启动 inspect view（外部进程）
harness eval export <run-id> [--redact]        # 团队共享导出（默认 redact base_instructions / secrets）

# 标注（Stage 2.5+）
harness eval annotate <run-id> --judge <model> # LLM-as-judge 打 failure mode 标签
```

## 储存布局

```
.harness/
├── logs/
│   ├── <scenario_id>/
│   │   ├── run_2026-04-27_001.eval           # Inspect AI EvalLog 格式
│   │   └── run_2026-04-27_002.eval
│   └── _attachments/                          # sha256-keyed 附件去重
│       ├── ab12cd...<sha>
│       └── ...
├── manifest.json                              # 现有
└── trajectories.db                            # 索引层（SQLite，可选）
```

`.harness/logs/` 加 `.gitignore`，与 `manifest.json` 同策略——本地数据不进 git。

## 设计原则总结

1. **不重造 viewer**：直接套 `inspect view`，团队共享时 docker compose 起 Langfuse
2. **redaction 在 export 这一道做**：原始 jsonl 永不离开本机；导出时按规则脱敏
3. **scenario_id 与 manifest 关联**：每次 sync 后的 manifest sha256 + scenario_id 共同决定 run identity，`harness eval diff` 可自动按"配置版本"分组对比
4. **`raw` 字段保留**：CommonEvent 不强求 100% 字段抽象，遗漏靠 raw 兜底
5. **跨 agent 不强求语义一致**：subagent / turn / hook 各家不同，CommonEvent 用 optional 字段表达，不强行 unify

## Stage 路线图

| Stage | 内容 | 依赖 |
|---|---|---|
| **2.0** | CommonEvent type + EvalLog writer + tail orchestration + `harness eval run` 骨架（不含 adapter）| — |
| **2.1** | Claude Code adapter（cc-jsonl parser → CommonEvent） | 2.0 |
| **2.2** | Codex adapter（codex-rollout-jsonl parser → CommonEvent），含 sample-rerun 字段验证 | 2.0 |
| **2.3** | `harness eval diff`（Layer B regression：unordered/superset + 文件 diff + scorer） | 2.1 至少 |
| **2.4** | `harness eval replay --mock`（Layer A：ReplayLLMClient） | 2.1 |
| **2.5** | `harness eval annotate`（Layer C：LLM judge）+ failure mode 标注 | 2.3 |
| **2.6** | `harness eval export --redact`（团队共享流） | 2.1 |

## 待决策（Stage 2.2 之前需 sample）

Codex parser 设计完整需要再 sample 至少两类事件：
- `response_item` 含 tool_call（看 tool 调用怎么写在 payload 里）
- `event_msg` 的多种 sub-type（task_started 之外的：error / completion / 等）

这是 Stage 2.2 实施时再做的事，不阻塞 Stage 2.0 / 2.1 启动。

## 参考资料

- [Inspect AI eval logs](https://inspect.aisi.org.uk/eval-logs.html)
- [SWE-agent trajectories](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/trajectories.md)
- [LangSmith trajectory evals](https://docs.langchain.com/langsmith/trajectory-evals)
- [Trustworthy AI Agents: Deterministic Replay](https://www.sakurasky.com/blog/missing-primitives-for-trustworthy-ai-part-8/)
- [docs/harness-cli/research/eval-harness-best-practices.md](../research/eval-harness-best-practices.md) — 配套的 eval 方法论调研
- 用户文档：`~/Workspace/sailor_fe_c_kmp/docs/research/2026-04-27-harness-eval.md` — 8 个具体 metric + 阈值

# Stage 2.2 Codex Rollout Parser

## 范围

Stage 2.2 只做 Codex rollout jsonl 的真实 parser，并解锁：

- `harness eval ingest --source codex`

本阶段故意不做：

- live tail / 增量 ingest
- redaction
- cross-source merge（Claude Code + Codex 同 sample）
- replay / diff / export / annotate

## 双流设计

Codex rollout jsonl 不是单一路径事件流，而是两个并存的轨迹源：

- `response_item`
  持久化层，覆盖 message / reasoning / function_call / function_call_output 等模型与工具原语
- `event_msg`
  live UI 层，覆盖 task_started / token_count / user_message / agent_message / exec_command_end 等运行时事件

两路之间存在信息冗余，例如一条 assistant 文本可能同时出现在：

- `response_item.message`
- `event_msg.agent_message`

本阶段选择“两路都收，不做合流”：

- 不提前丢字段
- 不在 parser 层做判重策略
- 让下游 EvalLog viewer / 后续 diff 阶段决定是否折叠

## 映射表

### 顶层 `type`

- `session_meta` → `CommonEvent.kind = "session_meta"`
- `turn_context` → `CommonEvent.kind = "session_meta"`
- `response_item` → 继续按 `payload.type` 分发
- `event_msg` → 继续按 `payload.type` 分发
- 未知顶层 `type` / 缺 `payload` → `CommonEvent.kind = "lifecycle"`

### `response_item.payload.type`

- `message`
  - `role = "user"` + `content[].type = "input_text"` → `user_input`
  - `role = "developer"` + `content[].type = "input_text"` → `lifecycle`
  - `role = "assistant"` + `content[].type = "output_text"` → `model`
  - 其它 content item → `lifecycle`
- `reasoning` → `model`（写入 `thinking`）
- `function_call` → `tool_call`
- `function_call_output` → `tool_result`
- `custom_tool_call` / `custom_tool_call_output` / `web_search_call` / 其它未知值 → `lifecycle`

### `event_msg.payload.type`

- `task_started` → `lifecycle`
- `token_count` → `model`
- `user_message` → `user_input`
- `agent_message` → `model`
- `exec_command_end` → `tool_result`
- `thread_name_updated` / `context_compacted` / `patch_apply_end` / `task_complete` / `web_search_end` / 未知值 → `lifecycle`

## 一行多事件

Codex 的 `response_item.message` 天然支持一条 envelope 里带多个 `content` item，例如：

- 两段 `output_text`
- 一段文本 + 其它非文本内容

因此 parser 与 Claude Code parser 一样，允许：

- 一行 jsonl → `CommonEvent[]`

这能保留原始顺序，不需要把多段输出先拼回一条字符串。

## `encrypted_content` 透传

`response_item.reasoning.encrypted_content` 会原样写进：

- `CommonEvent.thinking.signature`

约束：

- 不解密
- 不验证
- 不重写
- 不派生到 `CommonEvent` 顶层 schema 之外的新字段

这样可以保证后续 redaction 或 replay 阶段仍能访问最原始的 reasoning 签名载荷。

## `ParserContext.state`

Codex parser 是本仓库第一个明确依赖跨行状态的 trajectory parser。新增 `ParserContext.state` 的原因：

- `function_call_output` 需要回看之前的 `call_id -> tool name`
- `assistant output_text` 需要复用最近一次 `turn_context.model`
- `cwd` / `turn_id` 需要在缺字段时兜底

当前 state 字段：

- `lastCwd`
- `lastTurnId`
- `lastModel`
- `modelContextWindow`
- `callIdToToolName`

它只在同一个 ingest session 内共享，不进入 EvalLog 输出。

## session_id 推断

推断顺序：

1. `--session-id <id>` 显式覆盖
2. 文件名命中：
   `rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`
3. 文件名不命中时，读取第一行：
   - 若是 `session_meta`
   - 且 `payload.id` 存在
   - 则使用该值
4. 上述都失败 → 抛 `CLI_MISSING_CODEX_SESSION_ID`

这样可以同时兼容：

- Codex 原生 rollout 文件名
- 被用户复制/改名后的 fixture 文件

## `function_call.arguments` 容错

Codex 的 `function_call.arguments` 是 JSON 字符串，不是已解析对象。

策略：

- `JSON.parse` 成功 → 写入解析后的对象
- `JSON.parse` 失败 → 不抛错，写入：

```json
{
  "_raw": "{not json",
  "_parse_error": "..."
}
```

这样不会因为单条工具调用参数坏掉而中断整份 trajectory ingest。

## 与 Claude Code parser 的差异

- Claude Code 用单流 `type`，Codex 用 `response_item + event_msg` 双流
- Claude Code assistant content 有 `thinking / text / tool_use`，Codex message content 有 `input_text / output_text`
- Claude Code 用文件名 `<uuid>.jsonl`，Codex 用 `rollout-...-<uuid>.jsonl`
- Claude Code 通过 `isSidechain` 暴露 subagent 线索，Codex 当前只保留扁平 turn/call 状态
- Codex 多依赖 `ParserContext.state`，Claude Code parser 基本无状态

## 未来扩展

- live tail / 增量 ingest
- redaction
- cross-source merge
- subagent 嵌套还原
- 更细的 lifecycle 分类与去重策略

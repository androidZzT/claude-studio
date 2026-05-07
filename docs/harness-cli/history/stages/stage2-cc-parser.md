# Stage 2.1 Claude Code Trajectory Parser

## 范围

Stage 2.1 只做 Claude Code session jsonl 的真实 parser：

- `packages/core/src/eval/parsers/claude-code.ts`
- `harness eval ingest --source claude-code`
- `--session-id` 覆盖

本阶段**不做**：

- Codex parser
- live tail
- redaction
- subagent 嵌套 sample 重建
- replay / diff / export

## 为什么一行 jsonl 可能产出多个 `CommonEvent`

Claude Code 的 `assistant` 事件天然是一个 `content[]` 多语义容器：

- `thinking`
- `text`
- `tool_use`

如果强行把整行压成一个 CommonEvent，会在模型文本、thinking、工具调用之间丢失边界。因此 parser 允许：

```ts
parseLine(line, ctx): CommonEvent | CommonEvent[] | null
```

`stub` adapter 仍返回单条；Claude Code parser 只有在 `assistant` 多 content item 时才返回数组。

## 映射决策

### assistant

- `content[].type === "thinking"` → `kind: "model"`
- `content[].type === "text"` → `kind: "model"`
- `content[].type === "tool_use"` → `kind: "tool_call"`

这些事件共享同一条 jsonl 的：

- `uuid -> event_id`
- `timestamp`
- `cwd`
- `parentUuid -> parent_event_id`

`model.provider` 固定写 `"anthropic"`，`model.id` 来自 `message.model`。

### user

- 如果存在 `toolUseResult`，优先映射成 `tool_result`
- 否则按普通用户输入处理为 `user_input`

这是为了优先保留 Claude Code 工具结果里更完整的结构化 payload。

### lifecycle / 兜底

以下类型一律按 `lifecycle` 处理并保留 `raw`：

- `progress`
- `system`
- `attachment`
- `file-history-snapshot`
- `queue-operation`
- `last-prompt`
- `permission-mode`
- `agent-name`
- `pr-link`
- `custom-title`
- 未知 `type`

Stage 2.1 不对这些事件做更细的语义拆分，后续只要 Inspect AI viewer 能看到 info event 即可。

## thinking signature

`thinking.signature` 必须原样透传：

- 不解析
- 不验证
- 不修改
- 不重新生成

这是后续做 replay / provenance 时的重要保真字段。

## subagent_id 规则

Claude Code 的 sidechain 概念在 Stage 2.1 只保留为扁平字段：

- `isSidechain === true` 且 `parentToolUseID` 存在 → `subagent_id = parentToolUseID`
- 否则不写 `subagent_id`

本阶段**不**重建 subagent 嵌套树；那是更后期 EvalLog sample 层的事。

## session_id 推断与覆盖

默认要求 Claude Code trajectory 文件名满足：

```text
<uuid>.jsonl
```

例如：

```text
12345678-1234-1234-1234-123456789abc.jsonl
```

这时：

- `session_id = 文件名里的 uuid`

若文件名不匹配，CLI 会报错，并要求用户显式传：

```bash
harness eval ingest bad-name.jsonl --source claude-code --session-id manual-id
```

这样做的原因是：

- Claude Code 的 session id 本来就与文件名强绑定
- 比起悄悄退化成 basename，更安全的是强制用户确认覆盖值

## 与 Stage 2.0 stub 的关系

Stage 2.1 不是替换 stub，而是新增真实 parser：

- `--source stub`：继续用于最小管道测试
- `--source claude-code`：开始支持真实 Claude Code jsonl
- `--source codex`：仍明确报未实现，留给 Stage 2.2

这保证了基础设施测试和真实格式适配测试彼此独立，不会互相污染。

## 未来扩展点

- subagent 嵌套 sample 还原
- live tail / 增量 ingest
- Claude Code raw payload redaction
- lifecycle 事件更细分类

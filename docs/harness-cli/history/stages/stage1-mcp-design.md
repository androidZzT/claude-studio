# Stage 1.7 MCP Design

## Why MCP lives at the top of `harness.yaml`

Stage 1.7 把 MCP 声明放在 `harness.yaml` 顶层，而不是塞进某个 adapter 专属配置里：

- MCP server 本身是 tool-agnostic 的能力声明
- 同一个 server 可能同时被多个工具消费
- 让 `harness.yaml` 持有唯一 SSoT，可以避免 Cursor / Codex 各自维护一份近似重复配置

因此本阶段的数据流是：

```text
harness.yaml:mcp.servers
  -> cursor adapter: .cursor/mcp.json
  -> codex adapter: .codex/config.toml [mcp_servers.*]
```

## Why Cursor gets a separate file but Codex appends to `config.toml`

Cursor 已经有一个独立的 MCP 配置落点：`.cursor/mcp.json`。对它来说新增一个全文件 ownership 产物最自然，也最安全。

Codex 当前的 MCP 落点则是 `.codex/config.toml`，所以本阶段选择在已有的 harness-managed 文件尾部追加 `[mcp_servers.<name>]` 块，而不是再造一个并行文件。

这两种策略的共同点是：

- 都来自同一份 `mcp.servers`
- 都进入同一个 manifest
- 都复用同一套 diff / sync / cleanup

## Why JSON does not embed a generated marker

markdown 和 shell 脚本可以安全放注释式 generated marker；JSON 不支持注释。

如果为了“可见 marker”去污染 `.cursor/mcp.json` 的协议结构，比如加入 `_generatedBy` 之类字段，会让 harness 管理信息泄漏到消费方的配置对象里。

所以本阶段的选择是：

- `.cursor/mcp.json` 只保留协议所需的 `mcpServers`
- generated ownership 完全由 manifest 承担

这与 `.git/hooks/pre-commit` 或 `AGENTS.md` 不同，是 JSON 文件的特定设计取舍。

## Why Claude Code is not implemented yet

Claude Code 的 MCP 未来落点会是 `.claude/settings.json` 或用户级 `~/.claude/settings.json`。这类文件不只承载 MCP，还会跟：

- hooks
- permissions
- skills
- 其他 Claude Code settings

发生 partial-ownership merge 问题。

而 Stage 1.7 现有 reconciler 只支持全文件 ownership 或“整文件重渲染”。在没有安全 merge 策略前，直接去写 `.claude/settings.json` 风险太高。

因此本阶段只做：

- `codex` 渲染
- `cursor` 渲染
- `claude-code` 在启用且 MCP 非空时输出 informational note

不做任何 Claude Code MCP 落盘。

## Why env vars stay literal

`mcp.servers.*.env` 中的值，例如 `${GITHUB_TOKEN}`，本阶段原样保留：

- 不做 `${VAR}` 展开
- 不做路径插值
- 不做 shell evaluation

原因是 harness 的职责是维护声明式 SSoT，而不是在 sync 时执行环境相关求值。真正的展开和读取由消费 MCP 配置的工具自身负责。

## Why only command-based transport

Stage 1.7 只支持：

- `command`
- `args`
- `env`

也就是 command-based 的 MCP server 声明。

不支持 `stdio` / `sse` / `http` 等其他 transport，是因为当前 MVP 只需要覆盖本地 CLI 启动型 MCP server。把 transport 种类摊开会立刻引入更多 schema 分支和 tool-specific 差异，而这不是本阶段的重点。

## Manifest behavior

manifest schema 不需要 bump，MCP 产物仍然只是普通文件条目：

- Cursor 的 `.cursor/mcp.json` 是新增 path
- Codex 的 `.codex/config.toml` 仍是原 path，只是内容变了

因此：

- 删除整个 `mcp` 块 -> `.cursor/mcp.json` 被 cleanup，`.codex/config.toml` 回写为无 MCP 块版本
- 禁用 `cursor` -> `.cursor/rules/main.mdc` 与 `.cursor/mcp.json` 一起 cleanup

## Dependency choice

Stage 1.7 新增了 `@iarna/toml@2.2.5`，用于稳定的 TOML 值级序列化。

本阶段没有把整份 `.codex/config.toml` 交给 TOML 库重写，而是：

- 保留 template 原文
- 用 `@iarna/toml` 处理字符串 / 数组 / inline table 的值编码
- 再按稳定顺序追加 `[mcp_servers.*]` 段

这样可以兼顾：

- template 注释与已有结构不被抹掉
- TOML 值转义和 inline table 序列化不手写

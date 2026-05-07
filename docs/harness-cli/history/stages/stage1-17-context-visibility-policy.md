# Stage 1.17 Context Visibility Policy

## 背景

实验型 harness 会不断产生历史设计、todo、parity 和 report。它们需要保留给人复盘，但不能被下一轮 agent 当作 active contract。

`.rgignore` 只能影响 `rg` 的默认搜索结果，不是 Codex 或 Claude Code 的权限边界。真正的 adapter 层处理要投影到各平台官方配置。

## Canonical 配置

在 `harness.yaml` 中声明：

```yaml
context:
  no_active_context:
    - path: docs/archive/
      reason: Historical experiment output; only inspect when the user asks.
      mode: deny_read
```

规则：

- `mode: deny_read` 表示默认不允许 agent 读取该路径。
- `mode: soft_ignore` 仅作为语义标注，当前不会生成硬权限配置。
- 目录路径以 `/` 结尾时，adapter 会同时处理目录本身和 `/**` 子树。

## Adapter 投影

Claude Code adapter 渲染 `.claude/settings.json` partial ownership：

- `permissions.deny`: `Read(./path)` / `Read(./path/**)`
- `sandbox.filesystem.denyRead`: 同一组路径，覆盖 Bash / grep / rg 等子进程读取

Codex adapter 渲染 `.codex/config.toml`：

```toml
default_permissions = "harness-no-active-context"

[permissions.harness-no-active-context.filesystem]
":project_roots" = { "." = "write", "docs/archive" = "none", "docs/archive/**" = "none" }
```

这比单独写 `AGENTS.md` 规则更硬，也比 `.rgignore` 更接近工具官方权限机制。

## 边界

- 这不是为了隐藏敏感密钥；敏感文件应使用更严格的系统权限、托管策略或不要放进工作区。
- 如果用户明确要求复盘历史实验，应临时移除 deny policy 或切换到允许读取 archive 的 profile。
- archive 写入仍由实验 hygiene 负责；本策略只表达“不要把历史产物作为下一轮 active context”。

# Stage 1.10 Claude Settings Design

## Scope

Stage 1.10 起，Claude Code 的核心 shared-file 是：

- `.claude/settings.json`
- `hooks`
- `mcpServers`
- `permissions` / `sandbox` 中由 `context.no_active_context` 派生的 deny-read 子集

本阶段**不做**：

- 通用 `permissions` 管理
- `.claude/hooks/`
- `.claude/settings.json` 里的其他用户字段建模

## Why Settings Uses Partial Ownership

`.claude/settings.json` 不是纯 harness 文件，而是用户和 harness 共管的 shared file：

- 用户可能会维护自己的主题、UI 或未来偏好字段
- harness 只需要稳定接管明确声明的 top-level keys，例如 `hooks`、`mcpServers`，以及 no-active-context 派生的 `permissions` / `sandbox` 子集

因此这里不能像 `CLAUDE.md` 或 `.claude/agents/*.md` 那样做 full overwrite，而要做 top-level key 级别的 partial merge。

## Owned Keys

Stage 1.12 时，claude-code adapter 会按声明动态接管这些 top-level keys：

- `hooks`
- `mcpServers`
- `marketplaces`
- `plugins`
- `permissions`（仅 `context.no_active_context` 生成的 `Read(...)` deny）
- `sandbox`（仅 `context.no_active_context` 生成的 `filesystem.denyRead`）

manifest 用 `kind = "partial-json"` + `owned_keys` + `owned_sha256` 表达这份 ownership。

## Hook Wire Format

`harness.yaml` 的 lifecycle hooks：

```yaml
hooks:
  PostToolUse:
    - matcher: "Edit|Write"
      run: "echo edit"
      timeout: 300
      statusMessage: "Lint..."
```

会渲染成：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo edit",
            "timeout": 300,
            "statusMessage": "Lint..."
          }
        ]
      }
    ]
  }
}
```

约定：

- 顺序保留 `harness.yaml` 中的数组顺序
- `enabled: false` 的条目直接跳过
- `matcher` 缺失时不写该键
- `timeout` 和 `statusMessage` 是内层 `hooks[]` command entry 的字段，不是外层 matcher group 的字段
- 这里只渲染 command hooks；git `pre-commit` 仍然写 `.git/hooks/pre-commit`，不进入 settings

## Lifecycle Event Coverage

Stage 1.12 支持的 Claude lifecycle event 全集：

- `Elicitation`
- `Notification`
- `PermissionRequest`
- `PostCompact`
- `PostToolUse`
- `PostToolUseFailure`
- `PreCompact`
- `PreToolUse`
- `SessionEnd`
- `SessionStart`
- `Stop`
- `StopFailure`
- `SubagentStart`
- `SubagentStop`
- `TaskCompleted`
- `UserPromptSubmit`
- `WorktreeCreate`

其中支持 `matcher` 的 event：

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `UserPromptSubmit`
- `SubagentStart`
- `SubagentStop`

其余 event 即使在 `harness.yaml` 中声明了 `matcher`，render 时也会忽略，并向 stderr 输出 warning。

## Wire Format Example

下面是一段更接近真实项目的 settings 片段：

```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/task-completed-check.sh",
            "timeout": 15,
            "statusMessage": "检查 review 是否已执行..."
          }
        ]
      }
    ],
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo created",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

这里能看出两个规则：

- `timeout` 单位是秒
- 未声明的字段不会输出，避免无意义 diff 噪声

## MCP Rendering

从 Stage 1.10 开始，claude-code adapter 不再只输出 stderr note，而是会真正把顶层 `mcp.servers` 渲染到：

- `.claude/settings.json` 的 `mcpServers`

这和 Cursor / Codex 的 MCP 落点不同：

- Cursor: 独立 `.cursor/mcp.json`
- Codex: 追加到 `.codex/config.toml`
- Claude Code: partial merge 到 shared JSON file

## Permission Boundary

通用 `permissions` 仍然是用户敏感字段：

- 它带明显的安全含义
- 也更容易受个人本地环境影响

因此 harness 只接管 `context.no_active_context` 派生的 deny-read 子集，用于阻止历史 archive / 非 active context 被误读。其它 allow / ask / deny 规则仍由用户或项目自行维护。

## Adoption Guard

`settings.json` 的 partial ownership 必须显式授权。

默认情况下，如果 `.claude/settings.json` 已存在而 manifest 还没有这条 ownership 记录，`sync` 会要求：

```bash
harness sync --adopt-settings
```

另外，如果一个已经被 harness 管过的 `settings.json` 后来被整文件替换，导致当前文件里不再保留任何 harness-owned key，那么 `sync` 也会再次要求 adopt。这相当于对 shared-file ownership 做一次重新确认。

## Merge Order

输出顺序固定为：

- 用户字段在前，保留原有出现顺序
- harness 字段在后，按 key 字典序写入

这样可以兼顾：

- 用户手写字段的稳定性
- harness 产物的 deterministic diff

## Future Boundary

后续如果要继续扩展 Claude Code：

- 通用 `permissions` 仍然应该单独评估；当前只支持 `context.no_active_context` deny-read 投影
- `.claude/rules` / `.claude/skills` 继续走 full-file / directory-tree 路线
- `marketplaces` / `plugins` 已在 Stage 1.11 扩展到同一个 shared-file 模型里
- `.claude/scripts/*` 等辅助脚本资产如果要被 harness 管理，应该继续走 full-file 路线，而不是塞进 shared JSON merge

也就是说，`.claude/settings.json` 是 shared-file 特例，而不是所有 `.claude/` 资产都要走 partial merge。

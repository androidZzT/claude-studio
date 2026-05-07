# Stage 1.12 Claude Hook Types

## Scope

Stage 1.12 只扩展 Claude Code lifecycle hook 的：

- event 枚举
- `timeout`
- `statusMessage`

本阶段**不做**：

- git `pre-commit` 语义变更
- `.claude/scripts/*` 资产管理
- `permissions`
- plugin / network / 安装流程

参考官方文档：

- [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings)

## Event List

当前支持的 lifecycle event 全集：

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

这些值直接进入 `harness.yaml` 的 `hooks.<EventName>` key。

## Matcher Semantics

支持 `matcher` 的 event：

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `UserPromptSubmit`
- `SubagentStart`
- `SubagentStop`

不使用 `matcher` 的 event：

- `SessionStart`
- `SessionEnd`
- `Stop`
- `StopFailure`
- `Notification`
- `Elicitation`
- `PermissionRequest`
- `PreCompact`
- `PostCompact`
- `WorktreeCreate`
- `TaskCompleted`

如果用户在“不使用 matcher”的 event 上声明了 `matcher`，harness 会：

- 保持 `sync` 成功
- 向 stderr 输出 warning
- 在 render 时忽略该字段

## Timeout And Status Message

每条 lifecycle hook entry 现在支持：

- `timeout`
  - 单位是秒
  - 必须是正整数
- `statusMessage`
  - 非空字符串
  - 渲染到 Claude Code command hook entry 上

示例：

```yaml
hooks:
  TaskCompleted:
    - run: "bash .claude/scripts/task-completed-check.sh"
      timeout: 15
      statusMessage: "检查 review 是否已执行..."
```

渲染后：

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
    ]
  }
}
```

## Sailor Migration Shape

Sailor 一类业务仓常见的迁移配置大致是：

```yaml
hooks:
  PostToolUse:
    - matcher: "Edit|Write"
      run: "bash .claude/scripts/post-tool-check.sh"
      timeout: 300
      statusMessage: "MVVM Lint + 编译验证..."
  TaskCompleted:
    - run: "bash .claude/scripts/task-completed-check.sh"
      timeout: 15
      statusMessage: "检查 review 是否已执行..."
  WorktreeCreate:
    - run: "echo created"
      timeout: 5
```

这里不要求 harness 理解脚本内容；它只负责：

- schema 校验
- warning ergonomics
- 稳定渲染到 `.claude/settings.json`

## Forward Boundary

Stage 1.12 解决的是“event 类型不够全”和“缺少 command entry metadata”两个阻塞。

下一阶段如果要继续接真实项目，一般会落到：

- `.claude/scripts/*` 的 canonical source 与落盘
- 更完整的 Claude Code settings 字段
- 可能的 project-local helper assets

这些都不属于本阶段。

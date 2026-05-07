# Stage 1.4 Cursor Adapter

## Why Cursor reuses `AGENTS.md.template`

Stage 1.4 没有给 Cursor 单独引入一套 canonical 模板，而是直接复用 `canonical.instructions`：

- Codex 与 Cursor 都需要消费“同一份项目开发约束”
- 让多 adapter 共享 canonical source，可以避免规则内容漂移
- 后续如果要支持更多 adapter，优先抽象的是“同源多格式渲染”，而不是复制模板文件

因此 Cursor 的 `.cursor/rules/main.mdc` 与 Codex 的 `AGENTS.md` 在语义上是一致的，只是封装格式不同。

## Frontmatter choices

当前 frontmatter 固定为：

```yaml
---
description: Harness-managed development rules
alwaysApply: true
---
```

选择理由：

- `description` 让文件用途在 Cursor 侧可读、可审查
- `alwaysApply: true` 表示这份规则不是一次性提示，而是仓库级的持续约束

generated marker 被放在 frontmatter 之后、正文之前，保持两点：

1. `.mdc` 解析器优先看到合法 frontmatter
2. 人工查看时依旧能明确知道该文件是 harness 托管产物

## Multi-adapter cleanup semantics

多 adapter 共存时，reconciler 仍然只看 plan 与 manifest：

- adapter 还在 plan 中：比较并修复 drift
- adapter 不再出现在 plan 中：删除 manifest 里属于它的旧文件

因此当 `tools` 从 `[codex, cursor]` 改回 `[codex]` 后：

- `.cursor/rules/main.mdc` 会被删除
- `.harness/manifest.json` 会缩减到剩余产物
- `.cursor/` 或 `.cursor/rules/` 这类空目录当前不会被清理

这不是 Cursor 特判，而是 Stage 1 reconciler 的统一语义：它只管理文件，不递归清空目录。

## What is Cursor-specific vs reusable

Cursor 特有的部分：

- `.cursor/rules/main.mdc` 目标路径
- `.mdc` frontmatter 结构
- `cursor-rules-mdc` capability 名

可复用到未来 adapter 的部分：

- 复用 canonical instructions source
- generated marker 处理
- multi-adapter manifest ownership
- adapter 间互不感知，由 registry + reconciler 统一编排

这也是未来 claude-code adapter 的衔接点：它应复用“同源多格式渲染”和 manifest 语义，而不是与 Cursor 直接耦合。

# Stage 1.5 Claude Code Adapter

## Why v0.1 only renders `CLAUDE.md`

Stage 1.5 的目标不是一次性覆盖 Claude Code 的全部 surface，而是先把最小可用的单文件入口跑通：

- 先验证 registry / capabilities / sync / manifest 对第三个真实 adapter 仍然成立
- 先把 canonical instructions 到 `CLAUDE.md` 的单向生成关系稳定下来
- 把 `.claude/` 子目录的高风险能力继续留到后续独立阶段，避免 Stage 1 把权限模型和行为面摊得过大

本阶段明确**没有实现**这些内容：

- `.claude/agents`
- `.claude/skills`
- `.claude/rules`
- `.claude/commands`
- `.claude/hooks`
- `.claude/settings.json`
- `settings.json` hooks 注册
- plugin marketplace
- MCP 注册

这些都留给后续阶段分别设计和验收。

## Why `CLAUDE.md` has no frontmatter

Cursor 的 `.mdc` 需要 frontmatter 来表达规则元数据；Claude Code 读取的 `CLAUDE.md` 是直接面向上下文消费的 markdown 文档。

因此 Stage 1.5 的 `CLAUDE.md` 只保留：

- generated marker
- canonical instructions 正文

不加 frontmatter 的原因是：

- 降低上下文噪声
- 保持与 canonical instructions 的正文尽量一一对应
- 避免在还没定义 Claude Code 专用元数据语义前，提前写入不稳定格式

## Single source of truth

三个 adapter 当前共享同一份 `canonical.instructions`：

```text
AGENTS.md.template
  -> AGENTS.md
  -> CLAUDE.md
  -> .cursor/rules/main.mdc
```

其中：

- `AGENTS.md` 是 Codex 的直接 markdown 产物
- `CLAUDE.md` 是 Claude Code 的直接 markdown 产物
- `.cursor/rules/main.mdc` 是同源正文包一层 Cursor frontmatter 的产物

这保证了“规则内容”只有一个 SSoT，adapter 之间只在封装格式和目标路径上分化。

## Multi-adapter cleanup semantics

Claude Code adapter 没有任何 reconciler 特判。

当 `tools` 从 `[claude-code, codex, cursor]` 改成 `[codex, cursor]` 时：

- `CLAUDE.md` 会因为 `manifest-owned-not-planned` 被删除
- 其余仍在 plan 中的文件保持不变
- manifest 会缩减到剩余产物

当前 reconciler 仍然只清理文件，不递归清理空目录。对 `CLAUDE.md` 来说这点没有额外目录副作用；对未来 `.claude/*` 子目录阶段则需要单独设计目录清理策略。

## Extension path

Stage 1.5 抽象出来的可复用部分：

- 共享 canonical source
- shared generated marker 处理
- adapter capability add-only 演进
- manifest-owned 文件的统一 reconcile

未来如果新增 Claude Code 的子目录能力，建议 capability 名继续保持小写 kebab-case，并描述产物而不是实现细节，例如：

- `claude-subagents-md`
- `claude-commands-md`
- `claude-hooks`
- `claude-mcp`

这些都可以在不破坏 `schema_version = 1` 的前提下作为新增 feature 追加到 `features` 数组里。

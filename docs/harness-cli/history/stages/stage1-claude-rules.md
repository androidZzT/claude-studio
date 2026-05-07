# Stage 1.10 Claude Rules Design

## Scope

Stage 1.10 的第一步只把 `claude-code` 的 `rules` 补齐，不触碰 `settings.json`、hooks、permissions 或 plugin marketplace。

`rules` 与 Stage 1.8 的 `agents` / `commands` 完全同构：

- source 是顶层 `*.md`
- output 是同名 `*.md`
- 不递归
- frontmatter 原样透传
- marker 注入到 frontmatter 后或文件顶

## Why Rules Are Separate

虽然实现上和 `agents` / `commands` 很像，`rules` 仍然值得单独建模，因为它表达的是另一类 Claude Code 资产：

- `agents` 是可调用角色
- `commands` 是命令入口
- `rules` 是附加约束文档

把它做成单独 capability `claude-rules-md`，可以让 capability 矩阵继续保持“一个 feature 对应一类可见产物”的清晰语义。

## Rendering Rules

`claude/rules/<name>.md` 会渲染到 `.claude/rules/<name>.md`。

内容规则与 `agents` / `commands` 一致：

- 有 frontmatter 时：marker 注入到第二个 `---` 之后
- 没有 frontmatter 时：marker 放在文件顶部
- 文件末尾始终保证换行

## Scan Strategy

rules 只扫描 source 目录顶层的 `*.md`。

嵌套目录中的 markdown 会被忽略并输出 warning，而不是递归渲染。这是为了和 Stage 1.8 的 `agents` / `commands` 规则保持一致，避免同一类“平铺 markdown 资产”在不同子目录出现不同扫描语义。

## Cleanup

rules 仍然由 manifest 统一管理：

- 删除 source 文件 -> 删除对应 output
- 禁用 `claude-code` -> rules output 全部 cleanup

空目录仍然不会主动删除，这和 `.claude/agents`、`.claude/commands`、`.claude/skills` 的目录策略保持一致。

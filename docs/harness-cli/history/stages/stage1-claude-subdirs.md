# Stage 1.8 Claude Code Subdirectory Design

## Scope

Stage 1.8 只把 `claude-code` adapter 从单文件 `CLAUDE.md` 扩到两类同构产物：

- `.claude/agents/*.md`
- `.claude/commands/*.md`

本阶段刻意不做：

- `.claude/skills/`
- `.claude/rules/`
- `.claude/hooks/`
- `.claude/settings.json`
- plugin marketplace

这些能力都需要额外的结构设计或 partial-ownership merge，不适合和本阶段一起打包。

## Why Agents And Commands Together

`agents` 和 `commands` 本质上都是“源 markdown 文件 -> 目标 markdown 文件”的 1:1 渲染：

- 输入是顶层 `*.md`
- 输出是同名 `*.md`
- frontmatter 直接透传
- 仅插入 generated marker

既然结构同构，就应该在同一阶段验证 manifest + reconciler 对“多文件 + 子目录”的支持，而不是拆成两套平行机制。

## Why Not Skills Yet

`skills` 不是单文件集合，而是“目录 + `SKILL.md` + 资源文件”的复合结构。它的设计问题和 `agents` / `commands` 不同：

- output 是目录树而不是单文件
- manifest 将来可能需要更强的目录级约束
- 资源文件复制策略也需要单独定义

所以 Stage 1.8 先不碰 `skills`，避免把“文件镜像”问题和“目录资产打包”问题混在一起。

## Source Directory Convention

canonical source 目录固定放在仓库根下：

- `claude/agents`
- `claude/commands`

输出目录固定落到：

- `.claude/agents`
- `.claude/commands`

这样做的理由是：

- 源目录与输出目录语义对称，容易理解
- `claude/` 明确表示“这是 claude-code 专属 canonical asset”
- 避免把 source 混进 `.claude/`，从而把“用户编辑的源文件”和“harness 生成的产物”彻底分开

## Frontmatter Strategy

frontmatter 一律不解析、不校验、不重写，只做字符串透传。

理由：

- frontmatter 的字段语义属于 Claude Code 自己的消费协议
- harness 在本阶段只负责“安全搬运 + ownership 管理”
- 不解析就不会无意改变字段顺序、数组格式或注释风格

generated marker 的插入规则是：

- 如果文件有 frontmatter，就插在第二个 `---` 之后、body 之前
- 如果文件没有 frontmatter，就插在文件最顶

这样既保留了 Claude Code 期待的 frontmatter 结构，也能明确告诉用户这个目标文件是 harness 生成的。

## Non-Recursive Scan

源目录只扫描顶层 `*.md`，不递归子目录。

遇到嵌套目录时：

- 里面的 markdown 文件会被忽略
- `sync` / `diff` 会向 stderr 输出 warning
- 整个命令不会 fail

之所以 warning 而不是 fail，是因为这更符合“温和约束”的体验：用户马上能知道文件没被接管，但不会因为一个误放的嵌套文件把整个同步流程打断。

## Cleanup Semantics

`.claude/agents/*.md` 和 `.claude/commands/*.md` 都是普通 manifest-owned 文件，因此 cleanup 直接复用现有 reconciler：

- 删除 source 文件 -> 下次 sync 删除对应 output
- 改 source 目录路径 -> 旧 output 被 cleanup
- 禁用 `claude-code` adapter -> 所有 `.claude/*` manifest-owned 文件被 cleanup

reconciler 仍然不会主动删除空目录。这和 Stage 1.4 Cursor 的目录处理保持一致：ownership 只覆盖文件，不扩展到目录生命周期。

## Future Extension Path

后续如果要支持 `.claude/skills/`，它应当作为新的 capability（例如 `claude-skills`）独立设计，而不是塞进 `claude-agents-md` / `claude-commands-md` 的语义里。

届时需要重点重新审视：

- manifest 是否仍只记录文件条目
- 目录级资产复制是否需要额外 schema
- skill 资源文件如何与 `SKILL.md` 绑定

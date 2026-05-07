# Stage 1.9 Claude Code Skills Design

## Scope

Stage 1.9 只实现 `.claude/skills/` 目录树渲染，不扩展到：

- `.claude/rules/`
- `.claude/hooks/`
- `.claude/settings.json`
- plugin marketplace

`skills` 的目标是验证 harness 是否能正确处理“目录形态产物”：

- 任意深度子目录
- 混合文件扩展名
- mode 保留
- manifest 驱动的 cleanup

## Why Skills Are Directory Trees

`agents` 和 `commands` 都是“一个输入 markdown 对应一个输出 markdown”，所以用平铺文件模型就够了。

`skills` 不同。Claude Code 的 skill 协议本身就是目录结构：

- `SKILL.md` 是入口
- 资源文件可能放在 `resources/`
- 脚本文件可能放在 `scripts/`

因此 harness 不能把它压扁成单文件，也不应该在这个阶段引入 archive 或打包格式。最稳妥的做法就是 1:1 镜像整个目录树。

## Marker Injection Rules

generated marker 只注入 `.md` 文件：

- `SKILL.md`
- `resources/*.md`
- 其他任意 markdown 文件

非 `.md` 文件完全原样复制：

- shell 脚本
- JSON
- 文本模板
- 二进制资源

这样做的原因很直接：

- 给脚本注释可能破坏 shebang 或语法
- 给 JSON 加注释会导致文件失效
- 二进制内容根本不适合文本 marker

所以 Stage 1.9 的规则是“只对 markdown 做语义安全的最小变换”。

## Capability Naming

skills 的 capability 名是 `claude-skills`，故意不带 `-md` 后缀。

原因是它代表的是一个混合扩展名的目录树，而不是单一 markdown 文件类型。由此也形成一个补充约定：

- 单文件产物保留扩展名语义，例如 `claude-md`、`claude-agents-md`
- 目录树产物省略扩展名，例如 `claude-skills`

## Mode Preservation

skills 文件的 mode 直接继承源文件：

- 普通 markdown 通常是 `0o644`
- 脚本如果源文件是 `0o755`，输出也保持 `0o755`

Stage 1.9 不需要改 manifest schema，因为 manifest 里本来就已经有 `mode` 字段。也就是说，这次扩展只是让 adapter 更充分地使用既有 reconciler 能力，而不是重写 reconciler。

## Path Normalization

skills 扫描和写盘使用两套路径语义：

- 写盘时用 OS-native `path.join`
- manifest 中的 `path` 统一转成 POSIX 风格 `/`

这样做可以保证：

- 本地文件系统路径在当前平台上始终合法
- manifest、JSON 输出和 drift 结果跨平台稳定

## Scan Strategy

skills 与 agents/commands 的扫描策略明确不同：

- `agents_source` / `commands_source`: 只扫顶层 `*.md`，不递归
- `skills_source`: 递归扫描所有文件

递归时的容错约定：

- 隐藏文件 / 目录跳过
- symlink 跳过并输出 warning
- `node_modules/` 跳过
- 顶层 loose markdown 文件输出 warning，因为 skill 必须是目录
- 深度超过 6 的路径输出 warning，但仍继续同步

这些策略都偏向“温和跳过而不是强制失败”，因为 source 目录通常是人工维护资产，warning 已足以提示结构问题。

## Cleanup Semantics

skills 文件仍然只是普通 manifest-owned 条目，所以 cleanup 继续复用 reconciler：

- 删除 skill 内单个文件 -> 只删除对应 output
- 删除整个 skill 目录 -> 该 skill 下所有 output 被 cleanup
- 删除 `skills_source` -> 所有 generated skills 被 cleanup
- 禁用 `claude-code` -> 所有 `.claude/*` generated 文件被 cleanup

reconciler 依旧不会主动删除空目录。这一点与 Cursor 和 Stage 1.8 的 agents/commands 保持一致。

## Future Boundaries

Stage 1.9 不触碰：

- `.claude/rules/`
- `.claude/hooks/`
- `.claude/settings.json`

原因是这些产物的 ownership 模型不同：

- `rules` 更像引用集合，而不是固定镜像目录
- `hooks` 与 `settings.json` 涉及 partial-ownership merge
- `settings.json` 还会和 MCP、permissions、future marketplace 等字段交织

因此，skills 虽然也是 `.claude/` 的一部分，但它和 settings-based 能力不共享同一套渲染策略。

Stage 1.13 的 `.claude/scripts/` 会复用与 skills 相同的目录镜像思路，但 source 语义不同：skills 仍然是“按 skill 名分目录”，scripts 则是更自由的 helper script tree。

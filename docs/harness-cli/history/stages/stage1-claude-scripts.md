# Stage 1.13 Claude Code Scripts Design

## Scope

Stage 1.13 只实现 `.claude/scripts/` 目录树落盘，不扩展到：

- `.claude/settings.json`
- hook command 路径校验
- 远程脚本拉取
- 其他 adapter 的脚本共享

目标是让像 Sailor 这种真实业务 harness 的 hook 助手脚本也能由 harness 一起同步，形成闭环。

## Why Scripts Need First-Class Sync

Stage 1.12 已经能把 Claude lifecycle hooks 渲染进 `.claude/settings.json`，但很多真实项目的 hook command 实际长这样：

```yaml
hooks:
  SessionStart:
    - run: "bash .claude/scripts/session-start-check.sh"
```

如果 harness 只写 settings，而不把 `.claude/scripts/session-start-check.sh` 本身也同步过去，项目就仍然不是自包含的。

因此 Stage 1.13 的职责很明确：

- hooks 继续只渲染 command 字符串
- scripts 作为普通文件树落盘到 `.claude/scripts/**`

harness 不尝试检查 command 字符串里引用的路径是否存在，这条边界保持简单而稳定。

## Relation To Skills

`.claude/scripts/` 和 `.claude/skills/` 在技术上非常接近：

- 都是目录树
- 都递归扫描
- 都保留源文件 mode
- 都只给 markdown 注入 generated marker
- 都跳过 symlink 和隐藏文件

差异在于 source 约定：

- `skills` 是按 `<skill-name>/...` 分目录组织
- `scripts` 是更自由的 flat tree，可以直接放 `*.sh`，也可以带 `metrics/` 等子目录

因此 Stage 1.13 复用了同一类“目录镜像”逻辑，但没有把 `scripts` 强行建模成 skill。

## Marker Rules

marker 仍然只注入 `.md`：

- `metrics/template.md` 这类说明模板会加 marker
- `.sh` / `.py` / `.json` / 二进制文件完全原样复制

这么做是为了不破坏：

- shebang
- shell / Python / JSON 语法
- 任意二进制内容

## Mode Preservation

scripts 的 mode 必须从源文件继承。

这是本阶段最重要的运行时约束之一，因为：

- `.sh` 没有 `+x` 就可能在真实项目里直接跑不起来
- Sailor 一类仓库通常依赖多个可执行 helper script

幸运的是 reconciler 从更早阶段起就已经支持 `mode` 字段，所以 Stage 1.13 只需要在 planner 里把 mode 带上，不需要改 manifest schema。

## Sailor-Like Layout

本阶段对照的典型 source tree 大致是：

```text
claude/scripts/
├── session-start-check.sh
├── post-commit-check.sh
├── task-completed-check.sh
├── mvvm-lint.sh
└── metrics/
    └── template.md
```

同步后会 1:1 变成：

```text
.claude/scripts/
├── session-start-check.sh
├── post-commit-check.sh
├── task-completed-check.sh
├── mvvm-lint.sh
└── metrics/
    └── template.md
```

## Cleanup Semantics

scripts 继续复用 manifest：

- 删除单个源脚本 -> 删除对应 output
- 删除整个 `scripts_source` -> 清空所有 generated scripts
- 禁用 `claude-code` -> 连同 `CLAUDE.md`、agents、commands、rules、skills 一起清理

reconciler 不主动删除空目录，这一点与 cursor、skills 和其他 `.claude/` 目录保持一致。

## Future Boundary

Stage 1.13 之后，如果还要继续提升 Sailor 的机械迁移度，下一类自然需求会是：

- hook command 路径的可选 lint
- 某些脚本在多 adapter 之间共享
- 更高层的 helper asset 管理

这些都不属于本阶段。本阶段只负责把本地 `claude/scripts/**` 稳定镜像到 `.claude/scripts/**`。

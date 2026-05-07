# Stage 1.6 Hook Sync Design

## Why hooks go through the reconciler

Stage 1.6 没有单独做一个 hook installer，而是把 git hook 当成另一类 `PlannedFile`：

- adapter 产物和 hook 产物都需要同样的 drift detection
- 两者都需要进入同一个 manifest ownership 边界
- 禁用后的清理语义也完全一致

因此实现上只新增了一个 `hooks/planner.ts`，负责把 `harness.yaml` 的 hook 声明翻译成 plan；真正的 add / modify / remove 仍然全部复用现有 reconciler。

## Why only `pre-commit`

本阶段只支持一个 git hook 名字：

- `pre-commit`

原因是先把最小闭环跑通：

- schema 校验
- 计划生成
- 可执行文件 mode
- diff / sync / cleanup
- `harness diff --check` 与 hook 内容协作

其他 git hook（`pre-push`、`post-commit`、`commit-msg` 等）都留到后续阶段，避免在 Stage 1.6 就把命名空间和行为面铺太大。

## Manifest schema stays at version 1

manifest 仍然只记录：

- `path`
- `sha256`
- `mode`

hook 文件并不需要额外元数据，因为对 reconciler 来说它只是一个普通文件：

- path: `.git/hooks/pre-commit`
- sha256: hook 脚本内容 hash
- mode: `0o755`

所以 schema_version 不需要 bump。

## Non-git workspace behavior

如果 workspace 根目录下不存在 `.git/` 目录：

- hook planner 会跳过 hook 落盘
- `sync` / `diff` 整体仍然成功
- warning 通过 stderr 输出，提示当前不是 git repository
- manifest 不会写入 hook 条目

这样可以保证：

- 业务项目在尚未 `git init` 前也能先用 adapter 产物
- hook 安装不会把整个 sync 变成高摩擦失败点

本阶段只认 workspace 根下的 `.git/` 目录。父目录 git repo、worktree 特殊布局和其他 hook storage 方案都不在 Stage 1.6 范围内。

## `harness diff --check`

`diff` 仍然是查询命令，默认即使有 drift 也返回 `0`。

新增 `--check` 后：

- zero drift -> exit `0`
- 任何 `added` / `modified` / `removed` -> exit `1`

这让 hook 里可以直接写：

```bash
harness diff --check
```

从而把 drift 变成 pre-commit 的真实阻断条件，而不需要再引入额外包装脚本。

## Future relation to Claude Code hook registration

本阶段的落点是 `.git/hooks/pre-commit`。

未来如果做 Claude Code 的 hook 注册，落点会是 `.claude/settings.json` 之类的 Claude Code 配置文件，而不是 `.git/hooks/`。那一阶段不会复用当前的 git hook planner，但仍然会复用同一套 manifest + reconciler ownership 语义：

- planner 负责把 config 翻译成文件计划
- reconciler 负责 diff / sync / cleanup

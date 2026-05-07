# Stage 1 Sync Design

## Scope

Stage 1 只实现 `codex` adapter 的最小可用形态：

- `harness diff`
- `harness sync`
- `--json` 结构化输出
- `.harness/manifest.json` 所有权边界

不包含：

- `init`
- hook 安装
- MCP 注册
- upstream marketplace 拉取
- 非 codex adapter

## Why the adapter interface looks like this

当前接口是：

- `Adapter.id`
- `Adapter.plan(config, cwd)`
- `Adapter.capabilities()`

这样设计的原因：

1. `plan()` 只负责把 canonical source 渲染成“应该存在的文件”，不负责落盘。
2. `reconcile()` 只负责比较与写入，因此 adapter 和 file ownership 能清晰解耦。
3. `capabilities()` 先落接口，给后续 `harness adapters capabilities --json` 预留数据源，但本阶段不强行把 CLI 也做出来。

对 `codex` 而言，第一版只生成：

- `AGENTS.md`
- `.codex/config.toml`

其中 `AGENTS.md` 从 `canonical.instructions` 模板生成，并加 generated 标头。

## Why manifest is a separate runtime file

manifest 放在 `.harness/manifest.json`，不进 git，原因是：

1. 它描述的是“上次 sync 后本 harness 实际拥有的文件集合”，属于运行时状态，不是 canonical 配置。
2. 如果把它作为 git tracked 文件，开发者手工切分支、rebase、cherry-pick 时会把 sync 状态和源码历史混在一起，噪音很大。
3. `.harness/manifest.json` 可以明确约束删除边界：sync 只允许删除 manifest 中声明且本次 plan 已不再拥有的文件。

这条边界是 Stage 1 的数据安全红线：

- manifest 外的任何文件都不得被 sync 删除或清理
- 即使它们位于同一目录中，也不能碰

## Reconcile behavior

reconcile 采用“plan first, then compare”模型：

1. adapter 根据 `harness.yaml` 产出 `PlannedFile[]`
2. reconciler 读取实际文件与 manifest
3. 对每个 planned file 计算：
   - `added`
   - `modified`
   - `unchanged`
4. 对 manifest 中存在、但本次 plan 不再包含的文件标记为 `removed`
5. `dryRun=true` 只返回 diff
6. `dryRun=false` 原子写入文件，并重写 manifest

文件比较使用 sha256，而不是逐行 diff，原因是：

- Stage 1 只关心“是否漂移”，不关心 patch 级别展示
- 成本低、语义稳定、对二进制安全

## Self-host expectations

harness-cli 自己就是 Stage 1 的第一块验收样本：

- `harness.yaml` 指向 `AGENTS.md.template` 与 `.codex/config.toml.template`
- `AGENTS.md` / `.codex/config.toml` 是 sync 生成态，用于本地 runtime，不进 git
- `.gitignore` 忽略 adapter 投影产物，避免把平台生成目录误提交
- `harness diff` 应返回零 drift
- 第一次 `harness sync` 主要负责写 manifest
- 第二次 `harness sync` 应完全 no-op

## Future extension points

当前设计是故意留窄的，但扩展面已经预留：

- 多 adapter：registry 里增加 `cursor` / `claude-code` / `aider`
- hook 落盘：adapter 在 `plan()` 里生成更多目标文件
- MCP 注册：canonical 增加 `mcp` source，adapter 负责渲染对应格式
- studio 集成：`diff --json` 和 `sync --json` 直接给 UI 消费

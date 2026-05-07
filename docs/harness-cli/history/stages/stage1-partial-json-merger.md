# Stage 1.10 Partial JSON Merger Design

## Scope

Stage 1.10 首次引入 partial-ownership 文件：

- 路径是完整文件
- ownership 只覆盖 top-level keys
- 其余字段仍由用户保留和编辑

当前只支持 JSON，且只用于 `.claude/settings.json`。TOML、YAML 或更细粒度的 sub-key ownership 都留到后续阶段。

## Why Manifest Stays At Schema Version 1

manifest 的扩展是纯 add-only：

- 旧的 full-file 条目继续只记录 `path + sha256 + mode`
- 新的 partial-json 条目额外记录 `kind + owned_keys + owned_sha256`

因为旧 reader 只要通过新 schema 解析仍能理解 full-file 条目，所以这不是不兼容升级，不需要 bump `schema_version`。

## Entry Shapes

full-file 条目：

```json
{
  "path": "AGENTS.md",
  "sha256": "...",
  "mode": 420
}
```

partial-json 条目：

```json
{
  "path": ".claude/settings.json",
  "kind": "partial-json",
  "owned_keys": ["hooks", "mcpServers"],
  "owned_sha256": "...",
  "mode": 420
}
```

这里的 `owned_sha256` 是对 owned subset 做 canonical JSON 序列化后的 hash，而不是对整个文件做 hash。

## Merge Semantics

partial merge 的核心流程是：

1. 读取现有 JSON 对象；不存在则视为 `{}`
2. 删除当前 harness 拥有的 top-level keys
3. 注入新的 harness values
4. 重新 pretty-print 输出

输出顺序约定：

- 用户字段保留原始出现顺序
- harness 字段统一追加到末尾
- harness top-level keys 按字典序写入

这样做的目标是让用户手写字段稳定、可读，同时让 harness 自己管理的区域保持 deterministic。

## Conflict Guard And Adoption

首次取得 ownership 时必须有护栏。

如果：

- 目标文件已经存在
- manifest 里还没有该 path 的 ownership 记录

那么默认 `sync` 会失败，并要求用户显式传 `--adopt-settings`。

这个规则避免了 harness 在用户不知情的情况下接管已有 `.claude/settings.json`。

另外，如果 manifest 已经记录过该 path，但用户后来把 shared file 整体替换成了一个**完全不含任何 harness-owned key** 的新对象，`sync` 也会再次要求 `--adopt-settings`。这是一个有意的安全护栏：它把“用户整文件替换 shared file”视为潜在的 ownership 重新确认。

## Diff Semantics

partial-json 条目的 drift 只比较 owned subset：

- 用户修改非 owned 字段 -> 不算 drift
- 用户修改 owned 字段 -> 记为 modified
- 文件缺失 -> 若 plan 仍声明该 path，则记为 added；若 manifest 有但 plan 没有，则记为 removed

这保证了用户仍然可以安全维护自己的 `theme`、UI 偏好或其他未来字段，而不会被 harness 的 drift 检测误伤。

## Why Only Top-Level Keys

top-level key ownership 是故意收敛的 v1 设计：

- `hooks`
- `mcpServers`

这已经足以覆盖 Stage 1.10 的 Claude Code 接入，同时避免更复杂的路径级 merge 语义，例如：

- `hooks.SessionStart`
- `mcpServers.alpha`

一旦进入 sub-key ownership，冲突、排序、局部 adopt 和 manifest 表达都会明显复杂化，所以本阶段不做。

## Duplicate Path Safety

同一个 reconcile plan 中，任何重复 path 都会直接报错，无论它们是：

- full + full
- full + partial-json
- partial-json + partial-json

这条规则确保当前阶段不会出现“多个 adapter 共管同一 shared file”的隐式行为。

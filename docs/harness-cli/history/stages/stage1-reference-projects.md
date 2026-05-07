# Stage 1.14 Reference Projects Design

## Scope

Stage 1.14 新增：

- `.claude/reference-project.json`

Stage 1.14 的初始输入来自 `harness.yaml` 顶层 `reference_projects`，输出是一个 full-ownership JSON 文件。

Stage 1.16 后，推荐入口改为 `harness.yaml.projects.references`，与 target path / dispatch 配置统一；旧 `reference_projects` 顶层字段继续作为兼容 fallback。

本阶段**不做**：

- `reference-project.local.json`
- path 存在性校验
- `git_url` 可达性校验
- 跨仓自动发现

## What Reference Projects Are For

`reference-project.json` 本质上是一个跨仓 registry。

在像 Sailor 这样的多仓工作流里，Claude Code 往往需要知道：

- 还有哪些关联工程
- 这些工程的大致路径是什么
- 可选的远端 git 地址
- 可选的人类说明

这类信息既不适合塞进 `CLAUDE.md`，也不适合混进 `.claude/settings.json` 的 shared-file merge，所以 Stage 1.14 把它建模成独立文件。

## Sailor-Like Example

```yaml
projects:
  references:
    sailor_fe_c_ios:
      path: "../sailor_fe_c_ios"
      git_url: "ssh://git@example.com/ios"
      description: "iOS 壳工程"
      optional: true
    sailor_fe_c_android:
      path: "../sailor_fe_c_android"
      git_url: "ssh://git@example.com/android"
```

渲染后：

```json
{
  "description": "关联项目配置。path 默认相对路径...",
  "projects": {
    "sailor_fe_c_android": {
      "path": "../sailor_fe_c_android",
      "git_url": "ssh://git@example.com/android"
    },
    "sailor_fe_c_ios": {
      "path": "../sailor_fe_c_ios",
      "git_url": "ssh://git@example.com/ios",
      "description": "iOS 壳工程"
    }
  }
}
```

## Why This Is Not In settings.json

`.claude/settings.json` 的问题在于：

- 它已经是 shared file
- 里面放的是 Claude Code runtime settings
- shared ownership 冲突面更大

`reference-project.json` 更像一个独立 registry 文档，而不是 settings 字段。因此这里采用 full ownership 文件：

- 没有 partial merge
- 没有 top-level key adoption
- 没有 JSON 内嵌 marker

这和 Stage 1.7 的 `.cursor/mcp.json` 是同类设计。

## Render Rules

渲染约定：

- JSON pretty-print，2 空格缩进，末尾换行
- 不写 generated marker
- `projects` key 按字典序排序
- 每个 project 字段顺序固定为：
  - `path`
  - `git_url`
  - `description`
- 缺失字段不输出
- 顶层 `description` 缺失时也不输出
- `projects.references.*.optional` 是 harness 侧元数据，不输出到 Claude Code JSON
- `projects.references` 优先于旧 `reference_projects`
- 当 `projects.references` 缺失且 `adapters.claude-code.reference_projects_source` 指向现存 JSON 文件时，继续按旧 passthrough 行为镜像该文件

## Warning Behavior

如果 `reference_projects` 已声明，但当前没有启用 `claude-code` adapter：

- `sync` / `diff` 会输出 warning
- 不会失败
- 不会写 `.claude/reference-project.json`

这和 `mcp` / `plugins` 的 “declared but no renderer” 行为保持一致。

## Cleanup Semantics

`reference-project.json` 是 full-owned 文件，所以 cleanup 非常直接：

- 删除整个 `reference_projects` 块 -> 文件被删除
- 禁用 `claude-code` -> 文件被删除
- 删除单个 project -> 文件整体重写，sha256 更新

## Future Extensions

后续如果要继续扩展，可以考虑：

- `reference-project.local.json` 用户覆盖层
- path / git_url lint
- 基于 registry 的跨仓导航辅助

这些都不属于 Stage 1.14。本阶段只负责把 `harness.yaml` 里的声明稳定渲染成 Claude Code 可消费的独立 JSON 文件。

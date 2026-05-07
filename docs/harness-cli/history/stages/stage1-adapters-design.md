# Stage 1.3 Adapters CLI Design

## Scope

Stage 1.3 起步时只做两件事：

- 把已注册 adapter 的查询能力通过 CLI 暴露出来
- 冻结一份可供 studio 消费的稳定 JSON contract

contract 本身仍然遵守这两个边界：

- 不做运行时健康检查
- 不把版本号、文件路径或内部实现细节暴露到 contract 里

## JSON Contracts

### `harness adapters list --json`

```json
{
  "adapters": [
    {
      "id": "codex",
      "registered": true,
      "enabled_in_config": true,
      "target": "."
    }
  ]
}
```

字段约定：

- `id`: string，来自 `toolNameSchema`
- `registered`: literal `true`
- `enabled_in_config`: boolean，当且仅当 `tools` 包含该 adapter 且 `adapters[id].enabled !== false`
- `target`: string 或 `null`，读取 `harness.yaml` 的 `adapters[id].target`

来源规则：

- 以当前 registry 中真实存在的 adapter 为准
- 再叠加 `harness.yaml` 中的启用状态与 target
- 输出按 `id` 字典序稳定排序

### `harness adapters capabilities --json`

```json
{
  "schema_version": 1,
  "adapters": [
    {
      "id": "codex",
      "features": ["agents-md", "codex-config-toml"]
    }
  ]
}
```

字段约定：

- `schema_version`: integer，当前冻结为 `1`
- `id`: string，来自 `toolNameSchema`
- `features`: string[]，按字典序稳定排序

这里的 `features` 只表达“当前 adapter 已发布支持的产出物 / 行为”，不会出现 `false` 占位。

## Feature Naming

当前已发布并冻结的 feature 名有：

- `claude-agents-md`
- `claude-commands-md`
- `claude-hooks`
- `claude-mcp`
- `claude-md`
- `claude-plugins`
- `claude-rules-md`
- `claude-skills`
- `agents-md`
- `codex-config-toml`
- `cursor-mcp-json`
- `cursor-rules-mdc`

命名规则：

- 全小写
- kebab-case
- 描述产出物或行为，而不是内部实现
- 不带版本号
- 新 feature 应优先避免工具名前缀，保持跨 adapter 复用
- 单文件产物保留扩展名语义，例如 `claude-md`
- 目录树产物省略扩展名后缀，例如 `claude-skills`
- shared settings / behavior 类产物不带文件扩展名，例如 `claude-hooks`、`claude-mcp`

兼容性约定：

- 已发布的 feature 名不得改名或删除
- 未来只能新增 feature
- 新 feature 应尽量保持跨 adapter 可复用

说明：

`codex-config-toml` 已经作为 schema_version 1 的公开字符串发布，因此后续即使有更理想的命名，也不能在不 bump contract 的前提下改名。也就是说，前缀规约主要约束未来新增 feature；已发布值以兼容性优先。

## Versioning Strategy

`schema_version` 只在不兼容变更时 bump，例如：

- 字段重命名
- 字段删除
- 字段类型变化
- 顶层结构变化

不需要 bump 的情况：

- 新增 adapter
- 在 `features` 数组里新增新值
- `adapters` 数组中新增新条目

## CLI Notes

- `--format json` 是 `--json` 的别名
- `capabilities` 不依赖 `harness.yaml`，因为它查询的是 registry
- `list` 依赖 `harness.yaml`，因为它需要回答“当前仓库配置里这个 adapter 是否启用”

## Studio Consumer Examples

### `jq`

```bash
node packages/cli/dist/cli.js adapters capabilities --json | jq '.schema_version, .adapters[0].features'
```

### `Node.js`

```js
import { adaptersCapabilitiesReportSchema } from "@harness/core";

const response = JSON.parse(stdout);
const report = adaptersCapabilitiesReportSchema.parse(response);

for (const adapter of report.adapters) {
  console.log(adapter.id, adapter.features);
}
```

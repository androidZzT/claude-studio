# Stage 1.11 Plugins Design

## Scope

Stage 1.11 起，Claude Code plugin 的同步范围是：

- `marketplaces`
- `plugins` / `enabledPlugins`

它们都会通过现有的 partial-ownership merger 落到 `.claude/settings.json`。

本阶段**不做**：

- `claude plugin install`
- 任何网络请求
- 版本锁定
- 依赖解析
- 健康检查
- `~/.claude/plugins/cache/` 管理

## Why Declare But Not Install

plugin 安装天然涉及外部状态：

- 网络可用性
- Claude Code CLI 本地版本
- 用户账号 / 权限
- `~/.claude` 的本地缓存

这些都不适合被 harness 在 `sync` 阶段隐式触发。

因此 Stage 1.11 故意把边界收窄到：

- harness 只维护 declarative source of truth
- 用户自己决定何时运行 `claude plugin install`

## Schema Shape

`harness.yaml` 里新增：

```yaml
plugins:
  format: plugins
  marketplaces:
    - id: everything-claude-code
      source: github:affaan-m/everything-claude-code
      autoUpdate: true
  enabled:
    - "skill-health@everything-claude-code"
    - id: "everything-claude-code"
      scope: local
```

### Why String And Object Forms Coexist

`enabled` 支持两种输入：

- string: 最短路径，适合常见 `name@marketplace`
- object: 需要显式 `scope` 时更清晰

解析后会统一 normalize 成：

- `{ id, scope }`

这样 render 层和 warning 层都只需要处理一种稳定形态。

## Format Selector

Stage 1.14 新增：

```yaml
plugins:
  format: enabledPlugins
```

可选值：

- `plugins`
- `enabledPlugins`

默认仍然是 `plugins`，所以旧配置无需改动。

### `plugins` Format

这是 Stage 1.11 的原始格式，保留完整字段：

```json
{
  "plugins": [
    {
      "plugin": "skill-health@everything-claude-code",
      "scope": "user",
      "enabled": true
    }
  ]
}
```

优点：

- 能保留 `scope`
- 结构更接近 harness 的 normalize 后输入

### `enabledPlugins` Format

这是 Sailor 一类仓库已经在使用的对象格式：

```json
{
  "enabledPlugins": {
    "claude-mem@thedotmack": true
  }
}
```

约定：

- key 按 plugin id 字典序
- value 永远是 `true`
- 不再渲染 `scope`

如果 `enabled` 里有 object form 且声明了非默认 scope，`sync` 会输出：

```text
Note: enabledPlugins format does not support 'scope'; field will be dropped.
```

这是有意为之，因为 Claude Code 的 `enabledPlugins` 对象格式本身就不携带 `scope`。

### Sailor Example

```yaml
plugins:
  format: enabledPlugins
  marketplaces:
    - id: thedotmack
      source: github:thedotmack/claude-mem
  enabled:
    - "claude-mem@thedotmack"
```

这会渲染成：

```json
{
  "marketplaces": {
    "thedotmack": {
      "source": "github:thedotmack/claude-mem"
    }
  },
  "enabledPlugins": {
    "claude-mem@thedotmack": true
  }
}
```

## Allowed Source Prefixes

marketplace `source` 当前接受这些前缀：

- `github:`
- `http://`
- `https://`
- `git+`
- `file:`

这里只做格式校验，不验证远端是否真实存在。

## Render Semantics

### `marketplaces`

渲染为 keyed object：

```json
{
  "marketplaces": {
    "everything-claude-code": {
      "source": "github:affaan-m/everything-claude-code",
      "autoUpdate": true
    }
  }
}
```

约定：

- key 按 marketplace id 字典序
- `autoUpdate: false` 不输出
- 只有 `autoUpdate: true` 才显式输出

### `plugins`

渲染为数组：

```json
{
  "plugins": [
    {
      "plugin": "skill-health@everything-claude-code",
      "scope": "user",
      "enabled": true
    }
  ]
}
```

约定：

- 数组按 plugin id 字典序
- 每个 entry 都显式写 `enabled: true`
- 禁用通过**删除声明**表达，而不是 `enabled: false`

### Format Migration

如果用户把：

- `format: plugins`

切到：

- `format: enabledPlugins`

那么 harness 会：

- 删除旧的 `plugins` owned key
- 写入新的 `enabledPlugins` owned key

反过来切回去也是一样。

这里仍然受 shared-file ownership 护栏保护：如果你切换到的新格式对应的 key 早已被用户手工写进 `.claude/settings.json`，而 manifest 还没有记录对应 ownership，那么第一次接管时仍然会走 `--adopt-settings` 路径。

## Why Disable Means Delete

如果再引入 `enabled: false`，会出现两种含义混在一起：

- 仍然是 harness source of truth 的一部分
- 但希望目标工具视为禁用

Stage 1.11 故意避免这层歧义。当前模型很简单：

- 在 `plugins.enabled` 里 = 目标状态启用
- 不在 `plugins.enabled` 里 = 目标状态不存在

## Warnings

### Undeclared Marketplace

如果 `plugins.enabled` 里引用了：

- `name@marketplace-id`

但 `marketplaces` 里没有声明这个 `marketplace-id`，`sync` / `diff` 会输出 warning，但不会失败。

原因是用户可能选择手工管理 marketplace，而 harness 只做配置透出。

### No Renderer

如果声明了 `plugins`，但当前没有启用 `claude-code` adapter，也会输出 warning：

- harness 识别到 source of truth 存在
- 但没有任何 adapter 会把它真正写进目标环境

## Integration With Claude Code

当前阶段的正常闭环是：

1. 在 `harness.yaml` 里声明 `marketplaces` / `plugins`
2. 运行 `harness sync`
3. Claude Code 的 `.claude/settings.json` 得到对应字段
4. 用户自己运行 `claude plugin install` 完成本地安装

也就是说，harness 管的是配置声明，不是安装执行。

## Future Extensions

后续如果要继续扩展 plugins，可能会新增：

- 版本 pin
- 依赖解析
- install health check
- 远程拉取 / marketplace validation

但这些都应建立在 Stage 1.11 这套“先声明、再安装”的边界之上，而不是让 `sync` 直接变成 side-effect-heavy installer。

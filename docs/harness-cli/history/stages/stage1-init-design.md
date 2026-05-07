# Stage 1.2 Init Design

## Scope

Stage 1.2 只实现一个基础模板的 `harness init`：

- 仅 `codex` adapter
- 仅 scaffold 一个“harness 仓”
- 不做多模板
- 不做迁移
- 不在 init 阶段自动调用 `sync`

目标是把“新建一个业务 harness 仓”的入口跑通，并且保证 init 产物能立即闭环到 `harness sync` / `harness diff`。

## Why templates live under `packages/core/src/templates`

模板不直接硬编码进 `init.ts`，而是放在 `packages/core/src/templates/`，原因是：

1. 模板本身属于可审查的产品资产，而不是实现细节字符串。
2. 后续扩展多模板时，可以继续沿用“目录 + 最低限度变量替换”的结构，而不必重写 init 核心逻辑。
3. 模板文件独立存放后，文案和注释的修改不会把 `init.ts` 变成难维护的大字符串文件。

Stage 1.2 只支持 `{{name}}`、`{{scope}}`、`{{date}}` 三个占位，故意不引入模板引擎，保持可读、可测、可构建。

## Why init does not precreate manifest

`init` 只负责写 canonical source 和最小仓库骨架，不负责声明 runtime ownership。

manifest 仍然由首次 `harness sync` 创建，原因是：

1. manifest 描述的是“本次 reconcile 后由 harness 实际拥有的生成产物”，它是 sync 的职责，不是 init 的职责。
2. 如果 init 预先写 manifest，会让尚未生成的 `AGENTS.md` / `.codex/config.toml` 提前进入 ownership 状态，边界会变模糊。
3. 把 manifest 留给 sync，能保持职责清晰：init 产 source，sync 产 render + runtime state。

## Boundary between init and sync

两者边界刻意保持明确：

- `init` 负责写：
  - `harness.yaml`
  - `AGENTS.md.template`
  - `.codex/config.toml.template`
  - `.gitignore`
  - `README.md`
- `sync` 负责写：
  - `AGENTS.md`
  - `.codex/config.toml`
  - `.harness/manifest.json`

因此用户可以先审查模板与配置，再显式运行 `harness sync`，避免“初始化时偷偷改动更多文件”。

## Template defaults

Stage 1.2 的默认模板选择的是最小、安全、可自解释的组合：

- `tools: [codex]`
- `canonical.instructions: ./AGENTS.md.template`
- `canonical.codexConfig: ./.codex/config.toml.template`
- `adapters.codex.enabled: true`
- `adapters.codex.target: .`

`scope` 允许 `project` / `global`，但本阶段只是写入配置，真正的 global 语义留给后续阶段。

## Future extension points

当前实现故意把扩展口留在模板层和 CLI 解析层：

- `--template kmp` / `--template node-app`
- 迁移现有仓库约定到模板变量
- 非 codex adapter 的 init 产物
- 初始化后可选的 hook / MCP 注册建议

这些都不需要改写 `runInit` 的职责模型，只需要新增模板集和更明确的参数选择。

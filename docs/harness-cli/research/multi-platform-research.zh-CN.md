# 多平台 AI Coding 能力调研

日期：2026-04-30

本文对比 Claude Code、OpenAI Codex CLI、Cursor 在 harness 关心的六类能力上的支持现状：agents、skills、rules、MCP、hooks、plugins。报告刻意把“平台官方能力”与当前 `harness-cli` adapter 实现分开，避免后续规划时把“平台不能做”误判成“harness 还没实现”。

## 资料来源

- Claude Code 官方文档：[subagents](https://code.claude.com/docs/en/subagents)、[skills](https://code.claude.com/docs/en/skills)、[memory / rules](https://code.claude.com/docs/en/memory)、[MCP](https://code.claude.com/docs/en/mcp)、[hooks](https://code.claude.com/docs/en/hooks)、[plugins](https://code.claude.com/docs/en/plugins)
- Codex 官方文档：[AGENTS.md](https://developers.openai.com/codex/guides/agents-md)、[subagents](https://developers.openai.com/codex/subagents)、[skills](https://developers.openai.com/codex/skills)、[hooks](https://developers.openai.com/codex/hooks)、[plugins](https://developers.openai.com/codex/plugins)、[configuration reference](https://developers.openai.com/codex/config-reference)、[openai/codex config docs](https://github.com/openai/codex/blob/main/docs/config.md)
- Cursor 官方文档 / 产品页：[rules](https://docs.cursor.com/context/rules)、[MCP](https://docs.cursor.com/context/model-context-protocol)、[CLI usage](https://docs.cursor.com/cli/using)、[background agents](https://docs.cursor.com/en/background-agents)、[product overview](https://cursor.com/product/)、[enterprise hooks announcement](https://cursor.com/blog/enterprise/)、[Cursor 2.4 changelog](https://cursor.com/changelog/2-4)
- 本仓 harness 文档与源码：`docs/harness-cli/history/stages/stage1-*.md`、`packages/core/src/adapters/{claude-code,codex,cursor}.ts`、`packages/core/src/adapters/capabilities.ts`

图例：

- ✅ 完整支持：有官方文档、可由文件或配置表达，适合 harness deterministic sync。
- ⚠️ 部分支持：平台支持，但 schema / scope 有差异、需要 feature flag，或公开文档不完整。
- ❌ 不支持：未发现官方等价能力。
- ❓ 不明确：产品或 marketplace 有迹象，但稳定 authoring contract 不足以让 harness 取得 ownership。

## 能力对照大表

<table>
  <thead>
    <tr>
      <th>能力</th>
      <th>平台</th>
      <th>支持度</th>
      <th>文件位置</th>
      <th>生效范围</th>
      <th>格式 / Schema</th>
      <th>加载时机</th>
      <th>调用方式</th>
      <th>限制 / 特殊行为</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="3"><strong>agents</strong></td>
      <td>Claude Code</td>
      <td>✅ 完整</td>
      <td><code>.claude/agents/*.md</code><br><code>~/.claude/agents/*.md</code><br>plugin <code>agents/</code></td>
      <td>项目 / 用户 / plugin；同名冲突时项目优先。</td>
      <td>Markdown + YAML frontmatter。必填：<code>name</code>、<code>description</code>。可选：<code>tools</code>、<code>model</code>、<code>skills</code>、<code>memory</code>、background / permission 字段。</td>
      <td>启动 / reload 时从各 scope 发现。</td>
      <td>按 description 自动委派、自然语言点名、<code>@agent-...</code>、<code>--agent</code>、项目 <code>agent</code> 设置。</td>
      <td>独立上下文窗口；background subagent 有预批准语义；subagent skill 继承必须显式声明。</td>
    </tr>
    <tr>
      <td>Codex CLI</td>
      <td>✅ 完整</td>
      <td><code>.codex/agents/*.toml</code><br><code>~/.codex/agents/*.toml</code></td>
      <td>项目 / 用户；内置 <code>default</code>、<code>worker</code>、<code>explorer</code>。</td>
      <td>TOML 配置层。必填：<code>name</code>、<code>description</code>、<code>developer_instructions</code>。可选：<code>nickname_candidates</code>、<code>model</code>、<code>model_reasoning_effort</code>、<code>sandbox_mode</code>、<code>mcp_servers</code>、<code>skills.config</code>。</td>
      <td>Codex app / CLI 读取配置后可显式 spawn。</td>
      <td>请求 Codex spawn agent，或用 <code>/agent</code> 查看 / 切换。</td>
      <td>偏显式调用；custom agent 是较重配置层，不是轻量 Markdown frontmatter。</td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td>⚠️/❓ 部分 / 不明</td>
      <td>产品 / marketplace 显示 subagent 组件；稳定 repo-owned 文件位置未明确。</td>
      <td>产品级 agent orchestration / marketplace plugin。</td>
      <td>社区信息提到 nightly 里可能有 <code>.cursor/agents/*.md</code> + frontmatter（<code>name</code>、<code>description</code>、<code>model</code>），但不应当作稳定 contract。</td>
      <td>不明。</td>
      <td>通过 Cursor agent orchestration 或 marketplace plugin。</td>
      <td>文档稳定性不足，暂不建议 harness 取得 ownership。</td>
    </tr>
    <tr>
      <td rowspan="3"><strong>skills</strong></td>
      <td>Claude Code</td>
      <td>✅ 完整</td>
      <td><code>.claude/skills/&lt;name&gt;/SKILL.md</code><br><code>~/.claude/skills/&lt;name&gt;/SKILL.md</code><br>plugin <code>skills/</code></td>
      <td>项目 / 用户 / plugin。</td>
      <td>目录树 + <code>SKILL.md</code> Markdown frontmatter。必填：<code>name</code>、<code>description</code>。可选：<code>allowed-tools</code>；plugin 示例含 <code>disable-model-invocation</code>。</td>
      <td>Progressive disclosure：先加载 metadata，相关时加载完整 skill 与辅助文件。</td>
      <td>按 description 自动触发，或通过显式 plugin / skill 命令模式触发。</td>
      <td>辅助文件按需加载；<code>allowed-tools</code> 是 Claude Code 特有。</td>
    </tr>
    <tr>
      <td>Codex CLI</td>
      <td>✅ 完整</td>
      <td><code>.agents/skills</code>（从 CWD 向 repo root 扫描）<br><code>$HOME/.agents/skills</code><br><code>/etc/codex/skills</code><br>系统内置 skills</td>
      <td>项目 / 用户 / 全局 / 系统。</td>
      <td>目录树 + <code>SKILL.md</code>。必填 frontmatter：<code>name</code>、<code>description</code>。可选 <code>agents/openai.yaml</code> 表达展示、调用策略、依赖。</td>
      <td>Progressive disclosure；初始 skill 列表受 token budget 限制。</td>
      <td>按 description 隐式触发、<code>/skills</code>、<code>$</code> mention。</td>
      <td>同名不合并；follow symlink；禁用通过 <code>~/.codex/config.toml</code> 的 <code>[[skills.config]]</code>。</td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td>⚠️ 部分</td>
      <td>Marketplace / <code>/add-plugin</code> bundle；repo-owned skill layout 未稳定公开。</td>
      <td>产品 / marketplace。</td>
      <td>不明。</td>
      <td>不明。</td>
      <td>Marketplace plugin 或产品内技能触发。</td>
      <td>适配风险较高；等待官方文件布局、frontmatter、加载与调用保证。</td>
    </tr>
    <tr>
      <td rowspan="3"><strong>rules</strong></td>
      <td>Claude Code</td>
      <td>✅ 完整</td>
      <td><code>CLAUDE.md</code><br><code>.claude/CLAUDE.md</code><br><code>.claude/rules/**/*.md</code><br><code>~/.claude/rules/**/*.md</code></td>
      <td>项目 / 用户；<code>paths</code> 可做路径范围。</td>
      <td>Markdown；<code>.claude/rules</code> 可带 YAML frontmatter <code>paths: [...]</code>。</td>
      <td><code>CLAUDE.md</code> 按目录树加载；无 <code>paths</code> 的 rules 启动时加载；有 <code>paths</code> 的 rules 在匹配文件打开时加载。</td>
      <td>自动进入上下文；<code>/memory</code> 可查看 / 编辑。</td>
      <td>影响行为但不是 enforcement；<code>.claude/rules</code> 支持递归发现与 symlink。</td>
    </tr>
    <tr>
      <td>Codex CLI</td>
      <td>✅ 完整</td>
      <td><code>~/.codex/AGENTS.md</code><br><code>AGENTS.override.md</code><br>项目 <code>AGENTS.md</code> / <code>AGENTS.override.md</code><br>配置的 fallback 文件名</td>
      <td>用户 / 项目；沿 root 到 CWD 的路径链生效。</td>
      <td>Markdown，无 frontmatter。</td>
      <td>每次 run / session 启动时拼接；越靠近 CWD 的文件越晚出现，实际覆盖更早规则。</td>
      <td>自动加载。</td>
      <td>组合文档有大小上限（默认 32 KiB）；无官方 per-file glob frontmatter。</td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td>✅ 完整</td>
      <td><code>.cursor/rules/*.mdc</code><br>嵌套 <code>.cursor/rules</code><br>settings user rules<br><code>AGENTS.md</code> alternative<br>废弃 <code>.cursorrules</code></td>
      <td>项目 / 子目录 / 用户。</td>
      <td>MDC metadata + content。frontmatter：<code>description</code>、<code>globs</code>、<code>alwaysApply</code>。Rule type：Always、Auto Attached、Agent Requested、Manual。</td>
      <td>按 rule type：always、路径 / glob 自动附加、模型请求、或手动。</td>
      <td>自动生效；Manual rule 可用 <code>@ruleName</code>。</td>
      <td><code>.mdc</code> metadata 与 Claude <code>paths</code> 不同；嵌套 rules 会按目录自动 scope。</td>
    </tr>
    <tr>
      <td rowspan="3"><strong>MCP</strong></td>
      <td>Claude Code</td>
      <td>✅ 完整</td>
      <td>项目 <code>.mcp.json</code><br>local / user：<code>~/.claude.json</code><br>managed <code>managed-mcp.json</code><br>plugin <code>.mcp.json</code> 或 <code>plugin.json</code></td>
      <td>local / project / user / plugin / managed 多 scope。</td>
      <td>JSON <code>mcpServers</code>；支持 stdio / HTTP / SSE 风格、OAuth、headers helper、env 插值。</td>
      <td>启动 / reload 读取；project server 需要 trust approval。</td>
      <td>tools / prompts 作为 Claude 可用能力；<code>/mcp</code> 管理连接。</td>
      <td>官方 project scope 是根目录 <code>.mcp.json</code>，不是 <code>.claude/settings.json</code>。</td>
    </tr>
    <tr>
      <td>Codex CLI</td>
      <td>✅ 完整</td>
      <td><code>~/.codex/config.toml</code><br><code>.codex/config.toml</code><br>profile / custom agent 配置层</td>
      <td>用户 / 项目 / profile / agent。</td>
      <td>TOML <code>[mcp_servers.&lt;id&gt;]</code>。字段包括 <code>command</code>、<code>args</code>、<code>env</code>、<code>url</code>、headers、bearer env、enabled、tool filters、timeouts、OAuth scopes、approval mode。</td>
      <td>启动时读取配置层。</td>
      <td>模型通过 Codex tool-use 使用，受 approval 设置影响。</td>
      <td>平台字段远多于当前 harness command / args / env 子集。</td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td>✅ 完整</td>
      <td>项目 <code>.cursor/mcp.json</code><br>全局 <code>~/.cursor/mcp.json</code><br>extension API</td>
      <td>项目 / 全局 / extension。</td>
      <td>JSON <code>mcpServers</code>；支持 stdio、SSE、Streamable HTTP；字段包括 command / args / env 或 remote URL / header。</td>
      <td>IDE 与 CLI 使用同一 <code>mcp.json</code>。</td>
      <td>Agent 相关时自动用工具；用户可点名工具；工具可 toggle / auto-run。</td>
      <td>Cursor 会解析部分变量；harness 当前只输出 command-based JSON。</td>
    </tr>
    <tr>
      <td rowspan="3"><strong>hooks</strong></td>
      <td>Claude Code</td>
      <td>✅ 完整</td>
      <td><code>~/.claude/settings.json</code><br><code>.claude/settings.json</code><br><code>.claude/settings.local.json</code><br>plugin <code>hooks/hooks.json</code><br>session / built-in</td>
      <td>用户 / 项目 / local / plugin / session。</td>
      <td>settings JSON <code>hooks</code>：event -> matcher group -> handlers。Handler 支持 command、HTTP、MCP tool。字段含 <code>type</code>、<code>command</code> / <code>url</code> / MCP target、<code>timeout</code>、<code>statusMessage</code>、<code>shell</code>、async 字段。</td>
      <td>lifecycle event 触发时加载并执行。</td>
      <td><code>PreToolUse</code>、<code>PostToolUse</code>、<code>UserPromptSubmit</code>、<code>Stop</code>、subagent、task 等事件。</td>
      <td>阻塞语义按事件变化；许多事件中 exit code 2 表示 policy block。</td>
    </tr>
    <tr>
      <td>Codex CLI</td>
      <td>⚠️ 部分</td>
      <td><code>~/.codex/hooks.json</code><br><code>~/.codex/config.toml</code><br><code>&lt;repo&gt;/.codex/hooks.json</code><br><code>&lt;repo&gt;/.codex/config.toml</code></td>
      <td>用户 / 项目配置层。</td>
      <td>JSON 或 inline TOML <code>hooks</code>：event -> matcher group -> command hooks。字段包括 <code>command</code>、<code>timeout</code>、<code>statusMessage</code>。</td>
      <td>活跃配置层加载；多个 hook 文件都会运行。</td>
      <td><code>SessionStart</code>、<code>PreToolUse</code>、<code>PermissionRequest</code>、<code>PostToolUse</code>、<code>UserPromptSubmit</code>、<code>Stop</code>；命令从 stdin 接收 JSON。</td>
      <td>需要 <code>[features] codex_hooks = true</code>；高优先级层不替换低优先级层；匹配 hooks 可并发。</td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td>⚠️ 部分</td>
      <td>Enterprise / marketplace surface；稳定 project-owned 文件位置不明。</td>
      <td>企业策略 / marketplace / 产品内。</td>
      <td>公开示例有 <code>version: 1</code>，事件如 <code>beforeSubmitPrompt</code>、<code>beforeShellCommand</code>；marketplace entry 还出现 <code>sessionStart</code>、<code>beforeMCPExecution</code>、<code>beforeReadFile</code>、subagent hooks。</td>
      <td>不明。</td>
      <td>产品生命周期 / marketplace plugin。</td>
      <td>schema 稳定性不足，harness 暂不应假设完整 parity。</td>
    </tr>
    <tr>
      <td rowspan="3"><strong>plugins</strong></td>
      <td>Claude Code</td>
      <td>✅ 完整</td>
      <td>plugin root <code>.claude-plugin/plugin.json</code><br>组件：<code>skills/</code>、<code>commands/</code>、<code>agents/</code>、<code>hooks/</code>、<code>.mcp.json</code></td>
      <td>marketplace / local plugin dir / settings。</td>
      <td>JSON manifest + 组件文件。settings 含 <code>enabledPlugins</code> 与 <code>extraKnownMarketplaces</code>。</td>
      <td>通过 <code>/plugin</code>、marketplace、<code>--plugin-dir</code>、settings 安装 / 启用后加载。</td>
      <td>plugin skills / commands / agents 出现在原生入口；plugin MCP 在 reload / session start 后连接。</td>
      <td>安装 / cache 与项目 settings 分离；harness 应只声明，不自动安装。</td>
    </tr>
    <tr>
      <td>Codex CLI</td>
      <td>✅ 完整</td>
      <td>Codex plugin directory / app 安装目录；配置可在 <code>~/.codex/config.toml</code> 禁用。</td>
      <td>用户安装的 plugin。</td>
      <td>发布单元可包含 skills、app integrations、MCP servers；禁用形态：<code>[plugins."name@marketplace"] enabled = false</code>。</td>
      <td>安装后加载。</td>
      <td>自然语言或 <code>@</code> mention；bundle skills 安装后可用。</td>
      <td>repo-declared marketplace / lockfile 语义不等价于 Claude <code>enabledPlugins</code>。</td>
    </tr>
    <tr>
      <td>Cursor</td>
      <td>⚠️ 部分</td>
      <td>Cursor marketplace；安装命令 <code>/add-plugin</code>。</td>
      <td>Marketplace / 产品内。</td>
      <td>可 bundle skills、subagents、MCP、hooks、rules、commands；稳定 repo declaration schema 不明。</td>
      <td>安装后加载。</td>
      <td>产品内 plugin / marketplace 入口。</td>
      <td>不适合当前做 deterministic harness sync ownership。</td>
    </tr>
  </tbody>
</table>

## 机制差异分析

### Agents

Agents 不能 1:1 抽象：

- Claude Code agents 是 Markdown / frontmatter 文件，body 是 prompt；可按 description 自动委派。
- Codex agents 是 TOML 配置层，用于显式 spawn subagent；可覆盖 model、sandbox、MCP、skills 等设置。
- Cursor 有产品级 subagents 和 marketplace subagents，但还缺足够稳定的 repo-owned 文件 schema。

Harness 策略：当前继续把 `claude/agents/*.md` 保持为 Claude-specific。只有当我们准备至少覆盖两个后端时，才引入新的 canonical `agents` 抽象。未来 Codex adapter 应从结构化 schema 渲染 `.codex/agents/<name>.toml`，不要直接复用 Claude Markdown body。

### Skills

Skills 在 Claude Code 和 Codex 之间更接近：

- 两者都使用带 `SKILL.md` 的目录树。
- 两者都使用 `name` 与 `description`。
- 两者都依赖 progressive disclosure 和 description-based activation。

但细节仍有差异：

- Claude Code 使用 `.claude/skills/<name>/SKILL.md`；Codex 使用 `.agents/skills/<name>/SKILL.md`。
- Claude 支持 `allowed-tools`；Codex 支持可选 `agents/openai.yaml` 来表达展示、调用策略和工具依赖。
- Cursor 有 marketplace / product 支持，但稳定 repository source layout 尚不清晰。

Harness 策略：canonical `skills/<name>/SKILL.md` source 是可行方向，同时为 Claude `allowed-tools` 与 Codex `agents/openai.yaml` 提供 adapter-specific metadata overlay。Cursor 等官方 contract 稳定后再接。

### Rules

Rules 是最成熟的跨平台目标，但必须做 transformation：

- Claude Code：`CLAUDE.md` 加 `.claude/rules/**/*.md`，可选 `paths` frontmatter。
- Codex：`AGENTS.md` 指令链，无 frontmatter，没有公开文档化的 path glob rule surface。
- Cursor：`.cursor/rules/*.mdc`，字段包括 `description`、`globs`、`alwaysApply`；也支持 `AGENTS.md`。

Harness 策略：继续保留 canonical Markdown instructions；如果需要 path-aware 行为，应新增结构化 `rules` 层。把 `paths` 映射到 Claude `paths`、Cursor `globs`，对 Codex 则 flatten 或以注释保留，并提示语义损失。

### MCP

MCP 可以 canonical，但当前 harness schema 太小：

- 三个平台都能消费 `mcpServers`。
- Claude Code 的项目共享当前以根目录 `.mcp.json` 为中心，local / user 存在其他位置。
- Codex 使用 TOML `[mcp_servers.<id>]`。
- Cursor 使用 `.cursor/mcp.json`。

Harness 策略：顶层 `mcp.servers` 方向正确，但 schema 应扩展到 `url`、headers、OAuth / bearer env、enabled / required、timeout、allowed / disabled tools。Adapter 负责降级转换，并在目标无法表达字段时 warning。

### Hooks

Hooks 暂时不适合做单一 canonical 抽象：

- Claude Code hooks 成熟且很宽：command / HTTP / MCP handlers、复杂 lifecycle events 与不同阻塞语义。
- Codex hooks 有文档但 feature-gated；事件名与 Claude 有重叠，但 runtime merge 语义不同。
- Cursor hooks 出现在 enterprise / marketplace surface，事件名也不同。

Harness 策略：保留 `hooks.pre-commit` 作为 tool-agnostic git hook；agent lifecycle hooks 应按平台 namespace 拆开，例如 `hooks.claude`、`hooks.codex`、`hooks.cursor`，或加显式 `targets`。共享事件 enum 会掩盖重要行为差异。

### Plugins

Plugins 是分发系统，不只是配置字段：

- Claude Code plugin settings 可通过 `enabledPlugins` / marketplaces 与组件目录表达。
- Codex plugins 通过 Codex plugin directory 安装，并可在 `~/.codex/config.toml` 中禁用。
- Cursor plugins 通过 marketplace `/add-plugin` 出现，但 deterministic repo declaration 还不清楚。

Harness 策略：不要强行做统一 plugin schema。Claude plugin declarations 可以按现状保留为 Claude-specific；Codex / Cursor 只有在公开稳定 project-owned declaration surface 后再接。

## 当前 Harness Adapter 现状

| Adapter       | 已发布 features                                                                                                                                                                                                           | 已实现字段 / 产物                                                                                                                                                                                                                                                                                               | 对照平台文档的主要 gap                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claude-code` | `claude-md`、`claude-agents-md`、`claude-commands-md`、`claude-rules-md`、`claude-scripts`、`claude-skills`、`claude-hooks`、`claude-mcp`、`claude-plugins`、`claude-reference-projects`、`claude-docs`、`claude-metrics` | 渲染 `CLAUDE.md`；镜像 agents / commands / rules / scripts / skills / docs / metrics；向 agents frontmatter 注入 `model`；向 rules 渲染 dispatch table；partial ownership 写 `.claude/settings.json` 的 hooks、`mcpServers`、marketplaces / plugins / `enabledPlugins`；渲染 `.claude/reference-project.json`。 | Claude 官方 MCP project scope 是根目录 `.mcp.json`，而 harness 当前写入 `.claude/settings.json` 的 `mcpServers`；未支持 Claude HTTP / MCP hook handlers、hook async 字段、`shell: powershell`、agent `skills` / `memory` / permission frontmatter、skill `allowed-tools`、递归 `.claude/rules`、plugin install / cache。 |
| `codex`       | `agents-md`、`codex-config-toml`                                                                                                                                                                                          | 从 canonical instructions 渲染 `AGENTS.md`；渲染 `.codex/config.toml` template 并追加 command-based `[mcp_servers.<name>]` blocks。                                                                                                                                                                             | 未渲染 `.codex/agents/*.toml`、`.agents/skills/**`、`.codex/hooks.json`、Codex plugin config、更丰富 MCP 字段（`url`、headers、OAuth、approval / tool filters、enabled / required / timeouts）、AGENTS override / fallback hierarchy、Codex-specific config profiles。                                                   |
| `cursor`      | `cursor-rules-mdc`、`cursor-mcp-json`                                                                                                                                                                                     | 渲染单个 `.cursor/rules/main.mdc`，带 `description` 与 `alwaysApply: true`；从 command-based `mcp.servers` 渲染 `.cursor/mcp.json`。                                                                                                                                                                            | 未支持多规则、`globs`、Manual / Agent Requested / Auto Attached modes、嵌套 rules、`AGENTS.md` alternative、Cursor skills / subagents / hooks / plugins marketplace surface、非 command MCP transport、Cursor variable / header semantics。                                                                              |

## Harness 适配策略建议

### Schema 扩展建议

1. 增加结构化 canonical `rules` model：
   - 字段：`name`、`body`、`paths/globs`、`description`、`apply`（`always | path | agent_requested | manual`）。
   - 映射到 Claude `.claude/rules`、Cursor `.cursor/rules/*.mdc`，Codex `AGENTS.md` fallback 对 path-only 语义给 warning。

2. 扩展 `mcp.servers` 为 transport-aware shape：
   - 公共字段：`command`、`args`、`env`、`url`、`headers`、`enabled`、`required`、`startup_timeout`、`tool_timeout`。
   - Adapter-specific passthrough namespaces：`mcp.servers.<id>.claude`、`.codex`、`.cursor`。

3. 引入 platform-specific lifecycle hooks：
   - 保留 `hooks.pre-commit` 为 tool-agnostic git hook。
   - 用 `hooks.claude`、`hooks.codex`、`hooks.cursor` 表达 agent lifecycle hooks，避免假装事件语义一致。

4. 把可复用知识与平台执行机制拆开：
   - canonical skills source 可以共享（`skills/<name>/SKILL.md`），但 tool permissions、invocation policy、plugin packaging 应由 adapter overlay 表达。

5. 只在稳定时增加 adapter-specific plugin declarations：
   - Claude `plugins` 按现状继续。
   - Codex / Cursor 只有在 repo-owned declaration contract 足够清楚时再接，避免碰 install / cache 副作用。

### Adapter 优先级

1. 优先补 Cursor rules。Cursor rules 官方文档明确、项目级、价值高；当前 adapter 把所有 rules 压成一个 always-on 文件，是最明显的低风险 gap。
2. 其次补 Codex skills 与 agents。Codex 现在已有 `.agents/skills` 与 `.codex/agents` 文档，且 harness 已有 Claude 对应 source tree。
3. 再补 Codex hooks，但生成配置必须显式打开 feature flag，因为 Codex 需要 `[features] codex_hooks = true`。
4. MCP schema widening 应先于更多 tool-specific MCP 功能，否则每个 adapter 都会重复实现半套字段。
5. Cursor hooks / plugins 等稳定 project-file 文档更清楚后再做。产品支持存在，但 deterministic harness ownership 需要更强 contract。

### 统一抽象 vs Platform-Specific

适合统一：

- Canonical instructions 与 rule body text。
- MCP server identity 与公共连接字段。
- 两个平台都采用 `SKILL.md` 时的 skill directory tree。
- Docs / metrics passthrough 与 project reference metadata。

应保持 platform-specific：

- Claude Code settings ownership、hooks、plugins、agent memory、permissions。
- Codex agent TOML、sandbox / approval / model profiles、hook feature flag。
- Cursor rule application mode（`alwaysApply`、`globs`、Manual / Agent Requested）、cloud / background-agent environment、hooks、plugin marketplace declarations。

## 候选 Stage

1. **Stage 1.18: Cursor rules schema and multi-rule renderer**
   - 增加 canonical 或 Cursor-specific rule sources。
   - 渲染多个 `.cursor/rules/*.mdc`。
   - 支持 `description`、`globs`、`alwaysApply`，以及 Manual / Agent Requested / Auto Attached mapping。

2. **Stage 1.19: Codex skills and custom agents adapter**
   - 从 canonical skills 渲染 `.agents/skills/<name>/SKILL.md`。
   - 从结构化 agent config 渲染 `.codex/agents/<name>.toml`。
   - Claude-style agent body 只有在显式 schema 下才映射到 Codex `developer_instructions`，不要 raw copy。

3. **Stage 1.20: MCP schema widening and adapter parity**
   - 扩展 `harness.yaml` MCP schema，支持 HTTP / URL、headers、OAuth / bearer env、enable / disable、required、timeouts、tool filters。
   - 渲染到 Claude `.mcp.json`、Codex TOML、Cursor `.cursor/mcp.json`。
   - 当前 command-based 行为作为兼容子集保留。

4. **Stage 1.21: Codex hooks adapter**
   - 渲染 `.codex/hooks.json` 和 / 或 inline config tables。
   - 显式要求 `codex_hooks` feature flag。
   - Codex hook event names 与 Claude hook event names 分开建模。

5. **Stage 1.22: Cursor/Codex adopt**
   - 反向迁移 `.cursor/rules`、`.cursor/mcp.json`、`.codex/config.toml`、`.codex/agents`、`.agents/skills`。
   - 与 Claude adopt 分开做，因为 source layout 与 ownership 语义不同。

## 关键发现

- 最大惊喜是 Codex parity：现代 Codex 文档已经包含 subagents、skills、hooks、plugins、AGENTS.md、MCP。当前 harness Codex adapter 是明显落后于平台，而不只是“有意最小化”。
- Cursor 当前最强的是 rules 与 MCP。它明确支持 project rules 与 MCP config；skills / subagents / hooks / plugins 虽然已在产品和 marketplace 出现，但需要更稳定的 project-file contract，harness 才适合接管。
- Claude Code 仍是当前 harness 最完整目标，但也存在差异：官方 MCP 项目共享是 `.mcp.json`；官方 `.claude/rules` 支持递归和 path scope，而 harness 目前是 flat rules 与 settings-owned MCP。
- 最安全的下一步不是“一把梭做 universal schema”，而是“instructions / rules / MCP 在语义匹配处统一，lifecycle / plugin 系统继续 platform-specific，等 contract 收敛后再抽象”。

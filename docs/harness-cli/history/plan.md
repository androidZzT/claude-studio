# Harness-as-Code 工程规划

## Context

用户有多个独立业务（commander、xhs-ops、cc-stats、compose-album、stock-agents……），每个业务都需要一套**可版本化、可验证、可迭代**的 Claude Code harness 配置（agents / skills / rules / hooks / MCP / commands）。

**现状问题**：
1. 当前 `~/.claude/` 所有业务共用一份全局配置，改动影响面不可控
2. 装了 ECC（280+ skills）但实际每个业务只用其中一小部分，噪声大
3. 改了 rule / skill 后无法量化影响（调用是否被触发、结果有无退化）
4. 新机器 / 新业务从零搭建全靠手工，缺环境预检
5. `~/.claude/tools/` 不存在，没有任何脚手架 / bootstrap 脚本

**现有生态不满足**：
- **ECC / davila7 是 marketplace**（提供"有什么 skill 可装"），不是 harness 仓库（回答"我这套业务用哪些 skill、什么版本、怎么对账"）
- 类比：ECC = npm registry，缺的是 `package.json` + `npm install` + `npm test`

**期望产出**：
一个通用 CLI 工具 `harness`，以及由它生成的、**每个业务一个的独立 git 仓库**（如 `commander-harness/`、`xhs-ops-harness/`），用 `harness.yaml` 声明式描述该业务的 Claude Code 配置，支持 doctor / sync / eval 全流程。

用户已确认粒度：**一个 Harness = 一套业务**（独立仓库，独立版本，互不干扰）。

---

## 架构

### CLI 工具：`harness`（Node.js + npx 分发）

| 命令 | 作用 |
|---|---|
| `harness init <name>` | 生成一个业务 harness 仓（骨架 + `harness.yaml` + 迁移现有 `~/.claude/` 配置） |
| `harness doctor` | 环境检查（node / claude / git / mcp 相关 CLI），缺失项给出安装命令 |
| `harness sync` | 按 `harness.yaml` 把上游 skill / agent / MCP 拉到 `~/.claude/` 或项目 `.claude/`（取决于 `scope`）|
| `harness eval` | 跑质量门：调用频次 diff（P0）+ golden output 对比（P1） |
| `harness ui` | 本地 dashboard：看 skill 调用时间序列、eval 历史 |
| `harness diff` | 预览 sync 会做什么（干跑，不落盘） |

### 业务 Harness 仓库结构

```
commander-harness/
├── harness.yaml              # 声明：依赖上游 + 自研 + scope + eval 配置
├── skills/                   # 自研 skills（.md）
├── agents/                   # 自研 agents（.md）
├── rules/                    # 自研 rules（迁自 ~/.claude/rules/*）
├── hooks/                    # 自研 hook 脚本
├── commands/                 # 自研 slash commands
├── evals/                    # 每个关键 skill 的 golden input/output
│   └── <skill-name>/
│       ├── input.md
│       └── expected.md
├── .harness/                 # 运行时状态（不进 git）
│   ├── state.db              # SQLite：skill 调用时间序列
│   ├── last-sync.json        # 上次 sync 快照，用于 drift 检测
│   └── eval-history/
└── README.md
```

### `harness.yaml` 声明示例

```yaml
name: commander-harness
scope: global              # global(~/.claude/) | project(./.claude/)
version: 0.1.0

env:
  required:
    - cmd: node
      min: "18.0.0"
    - cmd: claude
      install: "npm i -g @anthropic-ai/claude-code"
    - cmd: git

upstream:
  - marketplace: everything-claude-code
    source: github:affaan-m/everything-claude-code
    pin: "v1.10.0"
    include:                 # 只装用到的，别全家桶
      skills: [skill-health, eval-harness, hookify, workspace-surface-audit]
      agents: [code-reviewer, planner]
  - marketplace: claude-code-templates
    source: npm:claude-code-templates
    include:
      mcpServers: [github, filesystem]

mcp:                          # 额外 MCP
  - name: xiaohongshu
    command: npx xiaohongshu-mcp

local:                        # 自研部分，从 ./skills ./agents ./rules 读
  skills: "./skills/**/*.md"
  agents: "./agents/**/*.md"
  rules: "./rules/**/*.md"
  hooks: "./hooks/**/*.json"

eval:
  invocation_tracking: true   # PreToolUse hook 写 state.db
  golden_snapshots:           # P1 能力
    - skill: hookify
      input: ./evals/hookify/input.md
      expected: ./evals/hookify/expected.md
  judge_model: claude-haiku-4-5-20251001
```

---

## 关键设计决策

1. **不重造 marketplace 轮子** — ECC / davila7 / 官方 plugin marketplace 仍是上游 registry，`harness.yaml` 通过 `upstream` 字段声明引用并 pin 版本。
2. **MVP 阶段质量门只做"调用频次时间序列"**（业界空白，实现轻），P1 再加 golden output + LLM-as-judge。
3. **技术栈 Node.js** — 匹配 `marketplace.json` schema 生态，`npx harness` 零安装启动。
4. **sync 走幂等 reconcile** — 每次 sync 对比 `last-sync.json`，只操作 delta，支持 `--dry-run`。
5. **eval 的调用追踪用 PreToolUse hook** — 写 SQLite，schema：`(skill TEXT, ts INTEGER epoch_ms, session_id TEXT, duration_ms INTEGER)`。
6. **粒度：一 Harness 一仓** — commander-harness / xhs-ops-harness / cc-stats-harness 各自独立，不搞 profile/workspace 复杂度。

---

## 技术栈决策

### 主栈：TypeScript + Node.js

**选型理由**：
- 与 claude-studio（React 19 + Next.js + TS）同栈，`@harness/core` 共享包落地成本最低
- npm / npx 分发体验最好：`npx harness init` 零安装
- 官方 `marketplace.json` schema、Claude Code 插件生态、MCP SDK 均为 JS 原生
- 生态工具齐备：`commander` (CLI) / `zod` (schema) / `yaml` / `better-sqlite3` / `execa` / `chokidar` / `chalk` + `ora`
- AI 辅助下开发速度显著优于 Go/Rust；学习曲线低

### 例外：PreToolUse 记录 hook 用 Bash（热路径规避 Node 启动税）

**问题**：Node.js 冷启动 ~150-400ms，而 PreToolUse hook 每次工具调用都触发。若 hook 跑 `node harness-hook.js`，每次工具调用被拖慢 300ms+，用户会明显感知卡顿。

**方案**：

| 组件 | 语言 | 启动延迟 | 备注 |
|---|---|---|---|
| `harness` 主 CLI（init / doctor / sync / diff / eval / ui） | TypeScript + Node | ~200ms | 可接受，命令是交互式非高频 |
| `@harness/core` 共享包 | TypeScript | — | studio 直接 import |
| **PreToolUse 记录 hook**（高频热路径） | **Bash + sqlite3 CLI** | <20ms | macOS/Linux 自带 sqlite3；零安装 |
| TaskCompleted / Stop hook 等非热路径 | Node（可接受）或 Bash | — | 按需 |

**hook 脚本形态**（由 `harness init` 生成到业务仓 `hooks/record.sh`）：

```bash
#!/usr/bin/env bash
# harness PreToolUse invocation logger
# 通过环境变量 HARNESS_STATE_DB / HARNESS_SESSION_ID 注入
sqlite3 "$HARNESS_STATE_DB" <<SQL
INSERT INTO invocations(tool_name, ts_ms, session_id)
VALUES ('$CLAUDE_TOOL_NAME', $(python3 -c 'import time;print(int(time.time()*1000))'), '$HARNESS_SESSION_ID');
SQL
```

SQLite schema（`.harness/state.db`）：

```sql
CREATE TABLE invocations (
  tool_name  TEXT NOT NULL,
  ts_ms      INTEGER NOT NULL,   -- epoch ms
  session_id TEXT NOT NULL
);
CREATE INDEX idx_invocations_ts ON invocations(ts_ms);
CREATE INDEX idx_invocations_tool ON invocations(tool_name, ts_ms);
```

主 CLI 读取这张表生成时序图、周月对比，不在热路径上。

### 次要考虑 & 备选

| 问题 | 初版方案 | 未来备选 |
|---|---|---|
| `better-sqlite3` 原生编译在某些环境（Alpine、ARM）装不上 | 用 Node 22+ 内置的 `node:sqlite` | fallback 到 JSON Lines |
| Node CLI 启动 ~100-200ms 在 CI 高频场景偏慢 | v0.1 暂不优化 | esbuild 单文件 bundle / bun runtime / 核心逻辑下沉到 Go 二进制 |
| Windows 支持 | v0.1 **仅支持 macOS / Linux**（hook 是 bash） | 后续考虑 PowerShell / Go 二进制 hook |

### Node 版本要求

- **最低 Node 20 LTS**（内置 `node:test` + 稳定 fetch + ESM）
- **推荐 Node 22**（内置 `node:sqlite`，可去掉 `better-sqlite3` 依赖）
- `package.json` `engines.node: ">=20"`

### 构建 & 分发

- TypeScript 源码，`tsc` 编译到 ESM
- 发布 `harness` npm 包，`bin` 字段注册 `harness` 命令
- `npx harness@latest init` 作为官方推荐入口
- 本地开发用 `npm link`
- Monorepo（pnpm workspaces 或 npm workspaces）：`packages/harness-cli`、`packages/core`

---

## 迭代路线

| 版本 | 内容 | 可用时机 |
|---|---|---|
| **v0.1 (MVP)** | CLI 骨架 + `init` / `doctor` / `sync` / `diff`；commander-harness 从现有 `~/.claude/` 迁出；harness.yaml schema 定稿 | 能用 commander-harness 一键 sync 到新机器 |
| **v0.2** | `eval` 的调用频次子命令：PreToolUse hook + SQLite 记录 + 周/月 diff 报表 | 改了 rule/skill 能看出调用量变化 |
| **v0.3** | `eval` 的 golden output 子命令：每个关键 skill 定 input→expected，sync 后自动跑，LLM-as-judge 打分 | 能检测 skill 输出退化 |
| **v0.4** | `harness ui`：本地 web dashboard，时间序列图 + eval 历史 | 可视化趋势 |
| **v0.5** | `harness diff --across-harness`：跨业务 harness 配置对比，抽象共性到 base | 多业务治理 |

---

## 需修改/创建的关键文件（v0.1 MVP 范围）

**新建工程目录**（推荐 `~/Claude/harness-cli/`）：
- `harness-cli/package.json` — bin: `harness`
- `harness-cli/src/cli.ts` — commander.js 路由
- `harness-cli/src/commands/{init,doctor,sync,diff,eval}.ts`
- `harness-cli/src/schema/harness.schema.json` — `harness.yaml` JSON Schema
- `harness-cli/src/reconciler/sync.ts` — 对账核心
- `harness-cli/src/upstream/{marketplace,npm,github}.ts` — 上游拉取适配器
- `harness-cli/templates/harness.yaml.hbs` — 初始化模板
- `harness-cli/templates/README.md.hbs`

**首个业务 harness 仓**（迁移 commander 现状）：
- `~/Claude/commander-harness/harness.yaml`
- `~/Claude/commander-harness/rules/` — 从 `~/.claude/rules/common/*.md` 迁入
- `~/Claude/commander-harness/CLAUDE.md` — 从 `~/Claude/commander/CLAUDE.md` 迁入
- `~/Claude/commander-harness/hooks/` — 从 `settings.json` 中 clawd-on-desk / cc-stats-hooks 声明迁入

---

## 可复用的现有资产

- **ECC `marketplace.json` schema** — 直接参考字段命名，`harness.yaml` 的 `upstream.*.include` 借鉴
- **ECC `skill-health` / `eval-harness` / `workspace-surface-audit`** — `harness doctor` / `harness eval` 可以直接调用或借鉴其逻辑（装了 ECC 的机器直接复用）
- **davila7 的交互式 CLI UX**（`@inquirer/prompts`、`ora` spinner）— `harness init` 交互体验照抄
- **用户现有 `~/.claude/rules/common/*.md`（11 个）+ `~/.claude/agents/*.md` + `~/Claude/commander/CLAUDE.md`** — commander-harness 的初始内容
- **用户现有 clawd-on-desk hook（`/Users/zhangzhengtian02/Claude/clawd-on-desk/hooks/clawd-hook.js`）+ cc-stats-hooks** — hook 声明格式参考
- **Node.js 生态库**：`commander` (CLI) / `zod` (schema) / `yaml` / `better-sqlite3` (state) / `execa` (shell) / `chalk` + `ora` (UX)

---

## 验收（端到端）

v0.1 MVP 的验收步骤：

1. **CLI 可执行**：`cd ~/Claude/harness-cli && npm link && harness --version`
2. **doctor 检查**：`harness doctor` 对缺失的工具给出可执行安装命令（测试：故意重命名 `which claude` 验证）
3. **init 生成仓**：`harness init commander-harness` 生成完整目录骨架 + `harness.yaml` 示例
4. **迁移现状**：手工把 `~/.claude/rules/common/*` / `~/Claude/commander/CLAUDE.md` 搬进 `commander-harness/`
5. **sync 对账**：在新目录 / 新机器跑 `harness sync`，`~/.claude/` 能复原到与源机器一致
6. **diff 干跑**：`harness diff` 能列出当前 `~/.claude/` 与 `harness.yaml` 的差异（增 / 删 / 版本不符）
7. **幂等**：连续跑两次 `sync`，第二次输出"no changes"
8. **跨业务互不影响**：`xhs-ops-harness` sync 时不破坏 `commander-harness` 的自研文件

v0.2 eval 的验收：
- 改动 `rules/common/testing.md` 后，一周后 `harness eval` 能显示 `skill-review` 调用频次相比基线的百分比变化

---

## 与 claude-studio 的整合（rename → harness-studio）

**战略决定**：`claude-studio` 后续更名为 **`harness-studio`**，作为本 `harness` CLI 的官方可视化前端。语义上从"Claude Code 的 GUI"升级为"Harness 生态的可视化层"，与 harness CLI 的多工具 adapter 愿景自洽。

### 产品关系

```
┌─────────────────────────────────────────────────────────┐
│  harness-studio (UI 层 — 原 claude-studio)               │
│  ├─ DAG 编辑 / workflow 可视化                            │
│  ├─ agents / skills / rules / MCPs / hooks CRUD          │
│  ├─ AI 辅助生成（claude -p）                              │
│  ├─ [新] Harness 面板：调用 harness CLI 子进程             │
│  │   - doctor 状态、sync diff、eval 时序图、drift 报告     │
│  └─ [新] 多工具视图：切换 Claude Code / Codex / Cursor     │
├─────────────────────────────────────────────────────────┤
│  harness CLI (引擎层 — 本项目)                            │
│  ├─ harness.yaml schema & 校验                           │
│  ├─ doctor / sync / diff / eval / lint / hook install   │
│  ├─ adapters: claude-code / codex / cursor / aider      │
│  └─ state.db: skill 调用时间序列、eval 历史               │
├─────────────────────────────────────────────────────────┤
│  @harness/core (共享引擎包，两端复用)                      │
│  ├─ file-ops / schema / reconciler                      │
│  ├─ adapter 基类                                         │
│  └─ 从 claude-studio 的 packages/studio-core 提升演化     │
├─────────────────────────────────────────────────────────┤
│  ~/.claude/ 或 ./.claude/ 或 ./.codex/ 或 ./.cursor/      │
└─────────────────────────────────────────────────────────┘
```

### 能力分工

| 能力 | harness CLI | harness-studio |
|---|---|---|
| `harness.yaml` schema | **拥有** | 可视化编辑器（frontmatter + form） |
| doctor / sync / eval | **执行引擎** | 触发 + 结果可视化 |
| 多工具 adapter | **实现** | 视图切换（一键在 claude-code / codex / cursor 间切换） |
| DAG 编辑 | - | **拥有** |
| workflow 执行 | 接口 | **拥有**（`claude -p` 驱动） |
| 资源面板 CRUD | - | **拥有** |
| invocation 时序可视化 | 数据源（state.db） | **拥有**（图表展示） |
| eval drift 报告 | 生成数据 | **拥有**（diff 对比 UI） |
| AI 生成（自然语言 → harness.yaml） | - | **拥有** |

### 三阶段整合路线

**Phase 1（v0.1 MVP 期）：松耦合共存**
- harness CLI 独立交付
- claude-studio 保持现状，正常迭代
- 两者共享 `~/.claude/` 文件系统，studio 用 chokidar watch 到 harness sync 的变更

**Phase 2（v0.2 期）：harness-studio 集成面板**
- claude-studio 正式更名为 harness-studio（package rename、npm package rename）
- studio 新增「Harness」tab，UI 上调用 `harness` CLI 子进程：
  - Doctor 状态卡片
  - Sync diff 列表 + 一键 apply
  - Skill 调用时序图（读 `.harness/state.db`）
  - Eval 历史 + drift 高亮
- studio 的 settings 可读写 `harness.yaml`

**Phase 3（v0.3+ 期）：共享 `@harness/core`**
- 把 `claude-studio/packages/studio-core` 提升为 `@harness/core` npm 包
- harness CLI 和 harness-studio 共用：file-ops、schema 校验、reconciler、adapter 基类
- claude-studio 正在做的 `studio-core-migration` Phase 3 与本步骤合并

### Rename 的具体动作（当 Phase 2 启动时）

| 项 | 原 | 新 |
|---|---|---|
| npm package | `claude-code-studio` | `harness-studio` |
| 仓库目录 | `~/Claude/claude-studio` | `~/Claude/harness-studio` |
| 默认端口 | 3100 | 3100（保持） |
| 启动命令 | `npx claude-studio` | `npx harness-studio` |
| VS Code 扩展 | Claude Studio | Harness Studio |
| README tagline | Claude Code 的可视化编排器 | Harness 生态的可视化工作台（支持 Claude Code / Codex / Cursor） |
| packages/studio-core | 保留 | 提升为 `@harness/core`（或并入） |

### 对 harness CLI 的反向要求

为了让 harness-studio 能做好可视化，harness CLI 必须：

1. **结构化输出模式**：所有命令支持 `--json`，studio 不解析文本
2. **state.db 有明确 schema 和查询 API**：`harness metrics query --skill X --since 7d --format json`
3. **adapter 矩阵可查询**：`harness adapters capabilities --format json` 返回每个 adapter 支持的 feature 集
4. **diff 结果结构化**：`harness diff --json` 输出 `{added, removed, modified, drift}`
5. **hook install 可远程触发**：studio 通过 CLI 管理而非自己写 settings.json

### 迭代路线更新（整合维度）

| 版本 | harness CLI | harness-studio |
|---|---|---|
| v0.1 | MVP 交付（init/doctor/sync/diff） | 保持 claude-studio 现状 |
| v0.2 | 加 `--json` 全命令、`metrics query`、`adapters capabilities` | **正式更名** harness-studio，加 Harness 面板 |
| v0.3 | `@harness/core` 抽出，eval 完整 | 集成 `@harness/core`，去除自己文件操作代码 |
| v0.4 | 多工具 adapter 完备 | 多工具视图切换 UI |

### 风险补充

- **更名时机**：claude-studio 已发布到 npm（`claude-code-studio` v1.2.8），更名需考虑既有用户迁移；建议保留 `claude-code-studio` 作为 alias 包（`npm deprecate + redirect`）至少 6 个月
- **scope 命名冲突**：`@harness/*` scope 需先抢注 npm；备选 `@harness-kit/*` 或 `@harnessrc/*`
- **身份混淆**：harness-studio 不能让用户误以为是 Harness.io（CI/CD 公司）的产品；tagline 需明确"Claude Code / Codex harness 管理"
- **VS Code 扩展 ID**：更名后扩展 marketplace 上会变成新产品，原有订阅丢失，需公告迁移

---

## 多工具适配（Claude Code / Codex / Cursor / Aider / Gemini CLI）

**定位转变**：`harness.yaml` 是**工具无关的声明**（canonical source of truth），CLI 通过**每个工具一个 adapter** 把同一份 harness 渲染成各工具原生格式。业务方只维护一份 harness，团队成员可自选工具。

### 跨工具标准（业界现状）

| 层 | 跨工具现状 | 结论 |
|---|---|---|
| **项目指令** | `AGENTS.md` 已是事实标准（Codex / Cursor / Gemini CLI / Aider 均兼容） | **canonical 用 `AGENTS.md`**，`CLAUDE.md` 由 CLI 生成为 symlink 或薄壳 |
| **工具协议** | `MCP` 由 Anthropic 发起，Cursor / Claude Code / Codex / Cline 均接入 | **MCP 可直接跨工具复用**，但注册位置不同（Claude 在 `settings.json`，Cursor 在 `.cursor/mcp.json`） |
| **Rules / Skills** | 各家方言：Claude=`.claude/rules/*.md` + `skills/`，Cursor=`.cursor/rules/*.mdc`，Aider=`CONVENTIONS.md`，Codex=`AGENTS.md` + `.codex/` | **canonical rule 存 `rules/*.md`**，adapter 渲染到各目标位置 |
| **Agents / Sub-agents** | Claude Code 原生支持子 agent，Cursor 用 "custom modes"，Aider/Codex 无等价物 | **有损转换**：Codex/Aider 只能降级为单 agent，sub-agent 指令合并到主 prompt |
| **Hooks** | 仅 Claude Code 有原生 hook，Cursor 用 "rules with conditions"，Codex/Aider 无 | **hook 仅对 Claude Code 生效**；对其他工具映射到 git pre-commit / post-commit |
| **Slash commands** | 仅 Claude Code 原生支持，Cursor 用 "commands", Cline 用 "rules" | **commands 仅 Claude Code adapter 渲染**；其他工具按需降级为 AGENTS.md 指令 |
| **Plugin marketplace** | 仅 Claude Code 有 | **upstream 拉取逻辑仅 Claude Code adapter 用**；其他工具需用户手动装同名包 |

### `harness.yaml` schema 扩展（工具声明）

```yaml
tools:                        # 本业务需要适配的工具
  - claude-code               # ~/.claude/ 或 项目 .claude/
  - codex                     # .codex/ + AGENTS.md
  - cursor                    # .cursor/rules/ + .cursor/mcp.json
  - aider                     # .aider.conf.yml + CONVENTIONS.md
  - gemini-cli                # AGENTS.md (gemini 已声明兼容)

canonical:                    # 工具无关的 SSoT 目录（仓库内）
  instructions: ./AGENTS.md   # 主指令；CLAUDE.md/CONVENTIONS.md 由 adapter 生成
  rules: ./rules/*.md
  agents: ./agents/*.md       # 语义：角色+职责，adapter 按工具能力转换
  mcp: ./mcp.yaml             # MCP server 清单
  commands: ./commands/*.md   # 仅部分工具支持，其余降级

adapters:
  claude-code:
    enabled: true
    target: ~/.claude          # 或 ./.claude（取决于 scope）
    features: [agents, hooks, commands, skills, mcp, plugins]
  codex:
    enabled: true
    target: ./.codex
    features: [agents_inlined, mcp]   # agents 合并到 AGENTS.md
  cursor:
    enabled: false             # 默认关，按需开启
    target: ./.cursor
    features: [rules_as_mdc, mcp]
  aider:
    enabled: false
    target: .
    features: [conventions_md, mcp]
```

### CLI 新增命令 / 参数

| 命令 | 作用 |
|---|---|
| `harness sync --tool <name>` | 只同步指定工具的 adapter（默认 sync 所有 enabled） |
| `harness adapters list` | 列出支持的 adapter 及其能力矩阵 |
| `harness check --tool codex` | 跑 adapter 的 "能力降级报告"（告诉用户 Claude 的 hook 在 Codex 下失效） |

### 重要设计原则

1. **canonical 单向生成**：`AGENTS.md` / `rules/*.md` 是 SSoT，`CLAUDE.md` / `CONVENTIONS.md` / `.cursor/rules/*.mdc` 都是 **generated**，不可手改（加 `<!-- generated by harness; do not edit -->` 标头）
2. **能力有损时显式降级**：Codex/Aider 没有 sub-agent 概念时，CLI 输出警告并把 agent 指令追加到主 `AGENTS.md`
3. **MCP server 清单独立**：`mcp.yaml` 是 canonical，adapter 渲染到 `settings.json` / `.cursor/mcp.json` / `.codex/mcp.json`
4. **doctor 要按 tool 列表检查**：声明了 `tools: [cursor]` 就检查 `cursor` CLI 是否装了
5. **test suite 覆盖多工具**：每个 adapter 有"基于示例 harness 渲染→断言输出结构"的单测

### 迭代路线更新（多工具维度）

| 版本 | 多工具能力 |
|---|---|
| **v0.1** | 仅 `claude-code` adapter；schema 层面预留 `tools` / `adapters` 字段 |
| **v0.2** | 加 `codex` adapter（Codex 活跃度高，AGENTS.md 生态成熟） |
| **v0.3** | 加 `cursor` adapter（`.cursor/rules/*.mdc` 格式转换） |
| **v0.4** | `aider` / `gemini-cli` adapter；`harness check --tool` 能力降级报告 |

### 风险补充

- **AGENTS.md 与 CLAUDE.md 双写陷阱**：用户改了 `CLAUDE.md` 被 adapter 覆盖。**应对**：sync 前检测目标文件是否有 generated 标头，没有则报错而非覆盖
- **Cursor `.mdc` 格式差异**：`.mdc` 支持 frontmatter 的 `globs` / `alwaysApply` 字段，canonical `rules/*.md` 需 frontmatter 带这些元数据，adapter 按需提取
- **Codex 的 AGENTS.md 可能已存在**：用户项目已有 `AGENTS.md` 时，CLI 要支持 **merge 模式**（识别 `<!-- harness:begin -->` / `<!-- harness:end -->` 区块，只替换该区块）

---

## 参考真实项目（sailor_fe_c_kmp）补充的能力

从 `~/Workspace/sailor_fe_c_kmp` 的 `.claude/` 发现一套**项目级 harness 的成熟范式**，以下能力需纳入规划：

### A. `harness.yaml` schema 扩展

在已有字段基础上补充：

```yaml
scope: project                # sailor 是典型 project scope
project:
  reference_projects:         # 跨仓对齐（sailor 的 reference-project.json）
    - name: sailor_ios
      path: ../sailor_fe_c_ios
      purpose: "iOS 对齐参考"
  feature_flags:              # gradle.properties 风格开关
    ENABLE_IOS: true
    ENABLE_ANDROID: true

hooks:                        # 三类 Claude Code lifecycle hook
  SessionStart:
    - name: env-check
      run: ./.claude/scripts/env-check.sh
  PostToolUse:
    - matcher: "Edit|Write"
      run: ./.claude/scripts/post-commit-check.sh
  TaskCompleted:
    - run: ./.claude/scripts/task-completed-check.sh

lints:                        # 自研架构 lint 脚本（如 sailor 的 mvvm-lint.sh）
  - name: mvvm-architecture
    run: ./.claude/scripts/mvvm-lint.sh
    triggers: [pre-commit, PostToolUse]

secrets_firewall:             # settings.json 的 deny list，默认 + 可扩展
  deny:
    - .env
    - .env.*
    - keystore.*
    - local.properties
    - secrets.*
    - .credentials*

metrics:                      # 事件 schema（sailor 的 events.schema.md）
  schema: ./.claude/metrics/events.schema.md
  collect: [skill_invocation, task_duration, hook_result]

teammate:
  mode: auto                  # sailor 的 auto 模式：自动 spawn 并行 worktree
  parallel:
    - agent: architect
    - agent: android-coder
    - agent: ios-coder
```

### B. CLI 新增命令

| 命令 | 作用 | 版本 |
|---|---|---|
| `harness lint` | 跑 harness.yaml 里声明的所有自研 lint（类似 sailor 的 mvvm-lint） | v0.2 |
| `harness hook install` | 把 harness.yaml 的 hook 写入 `settings.json`（或项目级），支持卸载 | v0.1 |
| `harness ref check` | 验证 `reference_projects` 的路径存在且在预期 commit | v0.3 |
| `harness metrics show` | 输出最近 skill 调用/任务时长/hook 结果的聚合 | v0.2 |

### C. init 模板多套

`harness init` 应支持模板：
- `--template basic` — 纯 Claude Code config（commander 这类运营团队）
- `--template kmp` — 基于 sailor 的 KMP 项目模板（带 mvvm-lint、env-check、architect/android/ios agents、reference-projects）
- `--template node-app` / `--template python-app` — 通用编码项目模板

### D. 扩展点（v0.1 即要留好接口）

1. **自定义 doctor check** — 不止 `cmd:`，还要支持 `script:` 指向任意 shell（复用项目的 `env-check.sh`）
2. **自定义 lint 注入** — `lints[]` 数组，sync 时把它们写进 git pre-commit + Claude Code PostToolUse
3. **hook 脚本托管** — 自研 hook 脚本也纳入 `./hooks/*.sh` 并赋可执行权限
4. **docs 模板** — ADR (`docs/architecture/adr/*.md`) 和 metrics.md 结构通过 init 注入

### E. 迭代路线更新

| 版本 | 新增内容 |
|---|---|
| v0.1 | 增加 `harness hook install`；`harness.yaml` 支持 `hooks` / `scope: project` / `secrets_firewall` / `lints` 字段（schema 层面），执行逻辑先只落 hook+secrets |
| v0.2 | `harness lint` / `harness metrics show`；补 `--template kmp` |
| v0.3 | `harness ref check`；ADR/metrics doc 模板 |
| v0.4 | teammate 并行 worktree 编排（sailor 的 auto mode） |

### F. 沉淀到 harness CLI 内置的"最佳实践片段"

把 sailor 已验证的以下内容做成 CLI 可选注入（非必选依赖）：
- 默认 secrets firewall deny list（防止 Claude 读 `.env` / keystore）
- `mvvm-lint.sh` 作为 KMP 模板的默认架构 lint
- `post-commit-check.sh` 模板：改了代码自动触发对应模块编译
- `reference-project.json` schema 作为跨仓对齐的标准
- `events.schema.md` 作为 metrics 事件的标准 schema

---

## 自举策略（Bootstrap — 解决鸡生蛋）

harness-cli 自身也是一个"业务"，需要一套开发环境才能被 Codex/Claude 高质量开发出来。借鉴 TypeScript 编译器的自举思路，分三阶段：

### Stage 0：工具无关的"环境需求说明书"→ 由 Codex 物化为 Codex 原生环境

**关键决定**：不复用现有 Claude Code 的 `.claude/` / 规则 / agents / hooks。从零写一份**与具体 AI 工具无关的环境需求**（本节内容），交给 Codex 自主生成 Codex 原生的开发环境（`AGENTS.md` + `.codex/` + 脚本 + 配置）。这一步既是 harness-cli 开发的前提，也是"harness 工具无关"理念的第一次实证。

**需求说明书（交给 Codex 的 brief）**：

#### 1. 技术约束

- Node.js ≥ 20 LTS（推荐 22，便于用 `node:sqlite`）
- TypeScript strict mode，ESM 产出
- monorepo（npm workspaces 或 pnpm workspaces），至少两个 package：
  - `packages/core`（未来的 `@harness/core`，纯逻辑，不含 IO 入口）
  - `packages/cli`（harness CLI，依赖 `core`）
- 测试：vitest，覆盖率工具 c8 或 vitest 内置，目标 ≥ 80%
- Lint：eslint + typescript-eslint；formatter：prettier
- 构建：tsc 或 tsup（单入口 bundle）

#### 2. 目录与命名

- 源码 `src/`，测试 `tests/`（或文件同目录 `*.test.ts`）
- 入口文件 `src/cli.ts`（CLI）、`src/index.ts`（库）
- `.gitignore` 屏蔽 `dist/`、`node_modules/`、`.harness/`、`coverage/`
- 包命名 scope 留空（`harness` 作为 unscoped 包名，scope 包 `@harness/core` 为保留；若抢注失败改 `@harness-kit/*`）

#### 3. 编码规范（AGENTS.md 要体现的原则）

- **不可变优先**：返回新对象，不原地修改入参
- **小文件**：单文件 ≤ 400 行，单函数 ≤ 50 行
- **显式错误**：不吞异常；CLI 层统一错误输出；`core` 层抛具名错误类
- **无隐式 any**：`noImplicitAny` + `strictNullChecks`
- **边界校验**：所有外部输入（CLI flag、`harness.yaml`、上游 marketplace 响应）经 zod 校验
- **无 magic string**：路径 / 字段名集中到 `constants.ts`
- **日志分层**：`debug` / `info` / `warn` / `error`，用 `pino` 或简易 wrapper
- **绝不硬编码 secrets**，所有敏感配置走环境变量或显式参数

#### 4. 架构约束（Codex 要配置为可机读的 lint 规则）

- `packages/cli` 可 import `packages/core`，反之禁止
- `packages/core/adapters/claude-code/*` 不得被 `core/adapters/codex/*` 直接 import（adapter 互不依赖）
- `core/reconciler/*` 不得 import 任何具体 adapter 的内部 —— 只通过 adapter 注册接口
- 违反架构的 import 由 `dependency-cruiser` 或自写 lint 在 CI 阻断

#### 5. 环境自检脚本（`scripts/env-check.sh`）

Codex 需生成一个纯 bash 脚本，职责：
- 检查 `node` 版本 ≥ 20，`npm` / `pnpm` 可用，`git` 可用
- 检查 `sqlite3` CLI 可用（hook 热路径依赖）
- 检查 `codex` CLI 自身可用（dogfood 开发环境前提）
- 缺失项输出带颜色的提示 + 可复制的安装命令（brew / curl / npm install -g）
- 返回非零退出码供 pre-commit / CI 使用

#### 6. 质量门脚本

Codex 需生成：
- `scripts/pre-commit.sh`：`tsc --noEmit` + `eslint` + `vitest run --changed` + 架构 lint
- `scripts/ci.sh`：完整 lint + 全量 vitest + 覆盖率检查 + build
- `scripts/lint-arch.sh`：跑 dependency-cruiser / 自写检查，违规 exit 1

#### 7. TDD 工作流（写进 AGENTS.md）

每加一个 CLI 命令或核心函数：
1. 先写 integration / unit 测试（RED）
2. 再写最小实现（GREEN）
3. 重构（IMPROVE）
4. 覆盖率 ≥ 80% 才能提交

#### 8. AGENTS.md 需包含的章节（让 Codex 自由组织）

- Project overview（一句话目标 + 链接到 `PLAN.md`）
- Tech stack & constraints（上述 1-4）
- Dev workflow（setup → code → test → commit 全流程）
- Architecture rules（monorepo 边界 + adapter 不互依）
- Testing requirements（TDD + 80% 覆盖率）
- Quality gates（本地脚本 + CI）
- Git / PR conventions（conventional commits、PR 模板）
- Security（不提交 secrets、敏感文件 deny list）
- **禁止项**：不要手改 `packages/cli/dist/`、不要 disable 架构 lint、不要写"后续优化"的占位代码

#### 9. 可选但鼓励

- `.editorconfig`
- `husky` + `lint-staged`（pre-commit 钩子）
- Renovate / dependabot 配置
- PR 模板 `.github/PULL_REQUEST_TEMPLATE.md`

#### 10. 禁止 Codex 做的事（保护边界）

- 不要引入 Claude Code 特有的 `.claude/` 目录或 hook 机制（这是 harness CLI 自己要管的，不放进开发环境）
- 不要引入任何 ECC 插件依赖（开发环境应能用 **裸 Codex** 完成）
- 不要硬编码路径（所有路径从 `process.cwd()` 或 `import.meta.url` 派生）
- 不要加 TODO 占位文件，缺实现就先不加

**Stage 0 产物**（由 Codex 生成）：`AGENTS.md` + `.codex/` + `scripts/*.sh` + `package.json` + `tsconfig.json` + `eslint.config.js` + `.gitignore` + `README.md`。

**Stage 0 验收**：
1. 全新终端执行 `bash scripts/env-check.sh` 能通过
2. `npm install && npm run build && npm test` 能跑通（即使核心实现是空壳 stub）
3. `codex` 在该目录读到 `AGENTS.md` 能正确理解项目约束（随便扔一个小任务测试，比如"加一个 hello 命令"）

### Stage 1：半自举（v0.1 完成时）

v0.1 跑通后立刻吃自己狗粮：
- 写 `harness-cli/harness.yaml`，把 Stage 0 的 Codex 环境反向声明（这里 harness.yaml 的 `tools: [codex]`，adapter 渲染到 `.codex/` / `AGENTS.md`）
- `harness diff` 应输出 "无差异"；有差异就是 sync 实现 bug，天然验收场景
- `harness doctor` 接替 `scripts/env-check.sh`

### Stage 2：完全自举（v0.2+）

- Codex 原生环境完全由 `harness sync` 生成，手改被 pre-commit 拒绝
- `harness eval` 进 CI 必跑
- 此时可选扩展 `tools: [codex, claude-code]`，让喜欢 Claude Code 的贡献者也能开发本项目，进一步验证多工具 adapter

### 质量保障组合拳（贯穿三阶段）

| 手段 | 做什么 |
|---|---|
| **TDD** | 每个命令先写 integration test 再实现 |
| **Codex 并行 worktree** | schema / adapters / reconciler 分模块并发开发，PR 相互 review |
| **golden fixture** | `fixtures/sample-harness/` 作 E2E 黄金样本，sync 输出对比期望 |
| **schema 先行** | `harness.schema.json` 在任何命令写码前定稿 |
| **架构 lint** | dependency-cruiser 挡跨边界 import |
| **PR 质量门** | 本地 `pre-commit.sh` + CI 全量门禁，任一失败不合并 |
| **多模型交叉 review**（后期） | Codex 写的代码让 Claude Code review，反之亦然，避免单模型盲区 |

### 立即可执行的第一步（交给 Codex 的初始 prompt 蓝本）

> 在 `/Users/zhangzhengtian02/Claude/harness-cli/` 已有 `PLAN.md`。阅读 PLAN.md 的「自举策略」章节，按其中 Stage 0 需求说明书，生成 Codex 原生开发环境（AGENTS.md / .codex/ / scripts / package.json / tsconfig.json / eslint.config / .gitignore / README.md）。不得引入 Claude Code 特有的 .claude/ 或 ECC 插件。完成后跑 `bash scripts/env-check.sh` 验证通过，并在 README.md 里写清 setup 步骤。

---

## 风险 & 待决

1. **sync 冲突处理**：`~/.claude/` 是全局共享目录，commander-harness sync 时其他业务的文件怎么办？**初版方案**：commander-harness 只管自己 `harness.yaml` 里声明的路径，不 own 其他文件；sync 时用 manifest 文件跟踪自己管辖的文件集。
2. **ECC 版本 pin**：ECC 是通过 plugin marketplace 分发的，`harness sync` 怎么 pin 它的版本？**初版方案**：调用 `claude plugin install everything-claude-code@<tag>`，依赖 Claude Code 官方的 plugin 版本机制。
3. **MCP server 安装**：各家 MCP 命令不一，没有统一 package manager。**初版方案**：`harness.yaml` 里写 `install` 命令字符串，doctor 检查是否已装，没装提示用户跑。
4. **golden output 的可信度**：LLM-as-judge 本身是 noisy 的。**应对**：P1 阶段跑 3 次取多数，或人工 review + 固化 expected。
5. **hook 脚本的跨平台性**：sailor 的 hook 全是 bash。`harness hook install` 要考虑 Windows（或明确不支持，只做 macOS/Linux）。
6. **自研 lint 的退出码语义**：需要约定 exit 0 = pass / exit 1 = fail / exit 2 = warning，否则 CI 集成混乱。
7. **metrics schema 演进**：事件 schema 一旦落地就难改，初版要留 `version` 字段。

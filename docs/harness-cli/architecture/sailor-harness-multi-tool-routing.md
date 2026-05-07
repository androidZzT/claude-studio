# Sailor-Harness 多工具 Agent 路由（Claude Code + Codex）

> ⚠️ **SUPERSEDED — 实现层已废，仅保留作 design canon**
>
> 本文档的**实现路径**已被 `docs/autonomous-execution-design.md` 的 TS-first autonomous plan 取代。
> H1-H5 的设计意图（agent_tools 投影、codex profile 渲染、cwd 决策表、subscription auth）部分沿用，但落点、阶段顺序和安全边界以 autonomous design 为准。
> Codex 执行 agent 应该读 `docs/autonomous-execution-design.md`，**不要按本文档的实现路径改 TypeScript 代码**。
> 本文档保留是因为 H1–H5 的契约描述、cwd 决策表、配置 schema 仍然准确。

> **本文交付物**：从 harness-cli 视角描述的 5 项实现任务（H1–H5），加一组在 sailor-harness 仓上跑的 acceptance 用例。读者是即将执行此计划的 Codex agent。

## Codex 执行视角

这份计划的主体是 **harness-cli 自身**要新增的能力（H1–H5）。`sailor-harness` 仓的 14 项配置改动**不是 harness-cli 的活**——它们是 H1–H5 完工后的消费侧样板，用来证明你写的 sync / 路由逻辑能正确解析新的声明、生成正确的投影、按正确的 cwd 调起子工具。

执行顺序：

1. **先做 H1–H5**（本仓，packages/ 下的 sync / adapters / runner 模块）。
2. **跑 acceptance**（在 sailor-harness 仓上验证），就是文档末尾"Acceptance Surface"那段——按里面的 14 项落地，再用 H1–H5 自动跑通。

如果 sailor-harness 当前还没有那 14 项配置，**不要替它改**——那是 sailor-harness 自己的 PR，由人来做。你要做的是：H1–H5 实现完成、加好单元测试、在本仓 README 标记新支持的字段，提交 harness-cli。

不要在本仓里写 sailor-harness 的 sample agent 文件做"端到端验证"。本仓的测试用 fixture 里的小型 harness 仓（sample/）来跑就够了。

---

## Context

`sailor-harness`（用户 keeta 双端原生 spec 仓）当前已经在 `harness.yaml` 声明 `tools: [claude-code, codex]` 双适配器，所有 7 个 agent 同时投影到 `.claude/` 和 `.codex/`。用户希望按职责分流：

- **Claude Code**（分析/设计/沉淀）：`architect`、`efficiency-engineer`、`machpro-parity`
- **Codex**（写代码/审代码/写测试）：`android-coder`、`ios-coder`、`code-reviewer`、`tester`

执行方式由 harness-cli 自动驱动；Codex 走 ChatGPT 订阅（`codex login`）。

harness-cli 当前的 `harness sync` 把每个 agent 都往两个 adapter 塞，没有"agent 归属哪个工具"的概念，也没有运行时路由命令。本计划要把这个能力补齐。

---

## Implementation：harness-cli 五项交付（H1–H5）

### H1：sync 阶段的 agent 投影按 `agent_tools` 过滤

**输入**：harness 仓的 `harness.yaml` 出现新段：

```yaml
agent_tools:
  default: claude-code
  agents:
    architect: claude-code
    efficiency-engineer: claude-code
    machpro-parity: claude-code
    android-coder: codex
    ios-coder: codex
    code-reviewer: codex
    tester: codex
```

**行为**：
- `harness sync` 在投影 `agents/` 资产到 `.claude/agents/` 时，**只复制** `agent_tools.agents[name] == "claude-code"`（或缺省回退到 `agent_tools.default`）的 agent。
- 投影到 `.codex/agents/`（如果 codex adapter 写 agent 文件——见 H2 注释）同理。
- `skills/`、`rules/`、`docs/`、`scripts/` 仍投影到所有启用的 adapter，**不**按 agent_tools 过滤——它们是工具中立的。

**实现位置**：`packages/cli/src/sync/` 或 `packages/adapters/`（按本仓现有 stage1-sync-design.md 的分层）。需要：
1. 新解析器：`harness.yaml` schema 加 `agent_tools` 字段；缺失时整段视为 `{ default: claude-code, agents: {} }`，行为退化为现状（兼容老 harness 仓）。
2. adapter 投影循环里加 filter。

**测试**：fixture 仓 `packages/cli/test/fixtures/sample-harness-multi-tool/` 放一个小 harness（2 个 agent，一个 claude-code 一个 codex），跑 `harness sync`，断言两个 adapter 目录里只各出现归属自己的 agent 文件。

---

### H2：sync 阶段渲染 codex 的 per-agent profile 到 `.codex/config.toml`

**输入**：`harness.yaml` 出现新段：

```yaml
models:
  claude-code:
    default: sonnet
    agents:
      architect: opus
      efficiency-engineer: sonnet
      machpro-parity: sonnet
  codex:
    default: gpt-5-codex
    agents:
      android-coder: { effort: high }
      ios-coder: { effort: high }
      code-reviewer: { effort: high }
      tester: { effort: medium }
```

> 这是对当前 `models.agents.<name>: <model>` 的扩展。老形态如果还要支持，作为 deprecation 路径处理：解析时若发现老形态，warning + 把它读成 `claude-code` 桶下的内容。

**行为**：
- 渲染 `.codex/config.toml`，每个归属 codex 的 agent 落一个 `[profiles.<name>]` 段。
- 模板已经存在的位置：`templates/codex-config.toml.template`（在 sailor-harness 仓，**不是** harness-cli 仓——template 是 canonical 资产，harness-cli 读它做填充）。
- 默认顶层（无 profile）保持 `model = "gpt-5-codex"`、`approval_policy = "on-request"`、`sandbox_mode = "workspace-write"`。

**渲染示例**：

```toml
# 顶层默认
model = "gpt-5-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[profiles.android-coder]
model = "gpt-5-codex"
model_reasoning_effort = "high"
sandbox_mode = "workspace-write"
approval_policy = "never"

[profiles.code-reviewer]
model = "gpt-5-codex"
model_reasoning_effort = "high"
sandbox_mode = "read-only"        # 只审不改
approval_policy = "on-request"

[profiles.tester]
model = "gpt-5-codex"
model_reasoning_effort = "medium"
sandbox_mode = "workspace-write"
approval_policy = "never"
```

**注意**：codex adapter 现在是不是也写 `.codex/agents/<name>.md`？看本仓 `stage1-codex-parser.md` / `stage1-cursor-adapter.md` 等设计文档定。如果 codex 不消费 markdown 形式的 agent 文件（profile 就够），H1 里"`.codex/agents/` 过滤"这条可不实现，但 `.codex/config.toml` 必须只含 codex 归属 agent 的 profile——不能给 architect 渲 profile，那是 Claude Code 的活。

**测试**：fixture 跑 sync，`tomllib` 读 `.codex/config.toml`，断言 profile 集合等于 `agent_tools` 中归属 codex 的集合，每个 profile 的 effort / sandbox / approval 字段值正确。

---

### H3：新增 `harness run <agent> "<task>"` 命令（核心）

这是路由层。读 `harness.yaml.agent_tools` 决定调哪个工具，按下表决定 cwd。

**cwd 决策表**：

| Agent | tool | cwd | 写入边界 |
|---|---|---|---|
| `architect` | claude-code | sailor-harness | `docs/`、`*.gradle.kts`、`*.{xcconfig,pbxproj,plist}` |
| `efficiency-engineer` | claude-code | sailor-harness | `skills/`、`rules/`、`docs/architecture/adr/`、`scripts/` |
| `machpro-parity` | claude-code | sailor-harness（只读，写报告到 `docs/<module>/parity/`） | 报告 |
| `android-coder` | codex | `${targets.android.path}` | 该工程内全部，禁出 |
| `ios-coder` | codex | `${targets.ios.path}` | 该工程内全部，禁出 |
| `tester` | codex | `${targets.android.path}` 或 `${targets.ios.path}`（按本轮 worktree 决定） | 同上，仅 `**/test/**` 或 `**/Tests/**` |
| `code-reviewer` | codex | sailor-harness（read-only sandbox 全机器可读） | 写 `docs/<module>/code-review/` |

**关键不变量**：harness-cli 启动 Codex 子进程前，必须先用 `harness.yaml.projects.targets.<platform>.path` 解析出绝对 cwd；不能让 Codex 自己猜路径。Codex 的 `workspace-write` 沙箱只允许写 cwd 子树，路由错就会写不出去。

**实现**：

```ts
// packages/cli/src/run/index.ts (草拟)
async function runAgent(agentName: string, task: string, harnessRepo: string) {
  const yaml = loadHarnessYaml(harnessRepo);
  const tool = yaml.agent_tools?.agents[agentName] ?? yaml.agent_tools?.default ?? 'claude-code';
  const cwd  = resolveCwdForAgent(agentName, tool, yaml);  // 按上表
  if (tool === 'claude-code') {
    return spawn('claude', ['-p', task], { cwd, stdio: 'inherit' });
  } else if (tool === 'codex') {
    return spawn('codex', ['exec', '--profile', agentName, '--full-auto', task],
                 { cwd, stdio: 'inherit' });
  }
  throw new Error(`Unknown tool ${tool} for agent ${agentName}`);
}
```

**为什么不能复用现有 sync 逻辑**：sync 是把 spec 投影成静态文件；run 是动态 spawn 子进程。不同关注点，独立模块。

**测试**：因为这命令会真正 spawn 外部进程，单测里 mock `child_process.spawn`，断言 argv / cwd / env 正确即可。集成测在 acceptance section 跑（不在本仓 CI）。

---

### H4：让现有 compound 走 H3

`sailor-harness` 仓里 `skills/compound/compound-km-feature/` 这种 compound skill 内部会调到"派给 X agent"的步骤。今天这些步骤是怎么实现的不太清楚（可能是在 skill 文档里描述 Claude/Codex 自己照着 spawn subagent，不是 harness-cli 的事）。

**这一项的实际工作量**：
- 如果 compound 由 harness-cli 直接执行（看本仓 `stage1-mcp-design.md` / `stage2-eval-infrastructure.md` 等是否定义了 compound runner）—— 把"派 X agent"那个内部接口换成 H3。
- 如果 compound 完全跑在 Claude/Codex 内部、harness-cli 不参与——H4 就不在本仓做，写一行 note 标 "external runtime; no change here"。

**需要先核实再决定**。建议读 `packages/cli/src/` 找 "compound" 的实际处理位置；找不到就走第二种处理。

---

### H5：Codex session 生命周期管理

Codex 多轮迭代靠 `codex exec resume <session-id>`。**不要用 `--last`**——并发不安全，多个 agent 同时跑会串。

**行为**：H3 跑 `codex exec` 时，捕获其打印的 session-id（Codex CLI 在 stderr 或专用日志写出），存到：

```
<harness_repo>/.harness/runs/<module>/<agent>/session.json
{
  "agent": "android-coder",
  "session_id": "abc123",
  "last_commit": "<git SHA at session start>",
  "started_at": "2026-05-03T10:21:00Z",
  "ended_at": "2026-05-03T10:38:21Z"
}
```

后续 `harness run <agent> --resume "<follow-up>"` 自动读 session.json，调 `codex exec resume <session_id> "<follow-up>"`，cwd 同前。

**`.harness/runs/` 已经在本仓的 .gitignore？**——抽空确认；不在的话在本任务里加上。

**测试**：mock spawn，断言 resume 路径下传给 codex 的 argv 第三位是 `resume`、第四位是从 session.json 读出来的 id。

---

## Acceptance Surface（在 sailor-harness 仓上验证 H1–H5）

不要在 harness-cli 仓动这部分的代码——这只是验收用例描述。下列 14 项配置变更**由 sailor-harness 仓负责落地**（独立 PR），harness-cli 这边只要保证 H1–H5 做完后，有人跑那 14 项就 work。

| # | 文件（在 sailor-harness 仓） | 动作 | 用途（验证 harness-cli 哪一项）|
|---|---|---|---|
| 1 | `harness.yaml` | 新增 `agent_tools` 段 + 改写 `models` 为按工具分桶 | H1、H2 |
| 2 | `harness.local.yaml.example` | 加注释示例 | H1 覆盖路径 |
| 3 | `templates/codex-config.toml.template` | 重写为含 4 个 profile 的模板（当前空文件） | H2 |
| 4 | `agents/architect.md` | frontmatter 加 `tool: claude-code` | H1（与 yaml 冗余但提示阅读者） |
| 5 | `agents/efficiency-engineer.md` | 同上 | H1 |
| 6 | `agents/machpro-parity.md` | 同上 | H1 |
| 7 | `agents/android-coder.md` | frontmatter 加 `tool: codex` | H1 |
| 8 | `agents/ios-coder.md` | 同上 | H1 |
| 9 | `agents/code-reviewer.md` | 同上；顺手修笔误 `name: code-评审er` → `code-reviewer` | H1 |
| 10 | `agents/tester.md` | 同上 | H1 |
| 11 | `docs/skill-graph-architecture.md` | 说明 agent → 工具映射、Codex auth、profile 形状 | doc |
| 12 | `README.md` | 加"准备 Codex"小节（`npm i -g @openai/codex` + `codex login` 选 ChatGPT 订阅） | doc |
| 13 | `scripts/validate-skill-graph.py` | 校验：`agent_tools.agents` 中 agent 必须存在；agent frontmatter `tool` 必须与 yaml 一致 | acceptance gate |
| 14 | `docs/architecture/adr/NNN-multi-tool-routing.md` | 新建 ADR；更新 `docs/architecture/adr/README.md` 索引 | decision record |

**端到端验证脚本**（H1–H5 + 上述 14 项都落地后跑）：

```bash
cd ~/Workspace/sailor-harness

# A. 静态校验
python3 scripts/validate-skill-graph.py
python3 -c "import yaml; yaml.safe_load(open('harness.yaml'))"
python3 -c "import tomllib; tomllib.loads(open('templates/codex-config.toml.template').read())"

# B. 同步双 adapter
python3 scripts/generate-harness-inventory.py
harness sync --harness-repo .
harness diff --harness-repo . --check
# 期望：No drift detected
# .claude/agents/ 只有 architect、efficiency-engineer、machpro-parity
# .codex/agents/ 只有 android-coder、ios-coder、code-reviewer、tester（如果 codex 写 .md）
# .codex/config.toml 含 4 个 profile

# C. 单 agent dry-run
harness run architect "design a hello-world contract"
# 期望：启 claude -p，cwd=sailor-harness，写出 docs/hello-world/architect.md

harness run android-coder "implement minimal hello-world per docs/hello-world/architect.md"
# 期望：启 codex exec --profile android-coder，cwd=../sailor_fe_c_transaction_android
# 写到该工程内，不会越界写 sailor-harness 仓

# D. resume
harness run android-coder --resume "fix the lint warnings from previous run"
# 期望：从 .harness/runs/hello-world/android-coder/session.json 读 session_id，
# 跑 codex exec resume <id>
```

---

## 跨工具 handoff（沿用现状，不引入新协议）

为什么 H1–H5 不需要新引入消息总线：

- architect（Claude Code 跑）写 `docs/<module>/architect.md`（C0-C12 契约）+ `docs/<module>/todo.md`
- coder/tester（Codex 跑）从同一份 `docs/<module>/*.md` 读，写到目标工程
- code-reviewer（Codex 跑）读 git diff + architect.md + todo.md，写 `docs/<module>/code-review/<platform>/<ts>.md`

文件即消息。Codex 的 `workspace-write` 沙箱**默认允许读**所有可读路径（包括 sibling 目录），**只限制写**到 cwd 子树。所以"在目标工程的 cwd 里跑、读 sailor-harness 的 architect.md"这套 work flow 自然成立——前提是 H3 把 cwd 设对。

---

## 风险与边界

1. **Codex sandbox 的 cwd 边界** —— H3 路由错就 fail。属于路由层 bug，单测必须覆盖每种 agent 的 cwd 设定。
2. **跨 worktree 的 architect.md handoff 写入保护** —— architect 在 sailor-harness 写 architect.md；coder 不能间接改它。这条由 sailor-harness 仓的 `agents/android-coder.md` / `ios-coder.md` 在 frontmatter 禁写清单里加 `docs/<module>/architect.md`。**harness-cli 不参与**。
3. **Codex 订阅 rate limit** —— 长 background 任务建议走 Codex Cloud（`codex.openai.com`）而不是本地 `codex exec`，订阅配额对 Cloud 有专门加成。这条写到 sailor-harness 那边的 ADR，harness-cli 不强制。
4. **deprecation：老 `models.agents` 形态** —— 解析时识别老形态（值是字符串而不是 mapping），warning 提示用户迁移；不立即报错。给一个版本的过渡期。
5. **`.codex/agents/` 是否真投影 markdown 文件** —— 待本仓现有 codex adapter 实现确认。如果 codex 不消费 markdown 形式 agent，H1 的 `.codex/agents/` 过滤是 no-op；H2 的 profile 渲染才是实质动作。

## Out of scope（明确不做）

- 不在本 PR 里改 sailor-harness 仓任何文件（那是该仓自己的 PR）
- 不引入新的 inter-agent 消息总线 / 事件队列（保持文件式）
- 不改 sailor-harness `harness.yaml.dispatch.patterns`（路径→agent 路由不动）
- 不动 compound/molecule/atom skill 内容
- 不切到 OPENAI_API_KEY 计费路径（坚持订阅；API key 路径作为 future option）
- 不引入新的 `tool: <name>` 之外的工具（cursor 等不在本计划，由 H1 的可扩展枚举体现）

## 完成标准（DoD）

- H1 单测过：fixture sync 后双 adapter 目录文件集合正确
- H2 单测过：fixture sync 后 `.codex/config.toml` profile 集合 + 字段值正确
- H3 单测过：mock spawn 后 argv / cwd / env 正确
- H4 完成定性判断（修代码 or 标 external）
- H5 单测过：resume 路径下从 session.json 正确加载 session-id
- 本仓 README 更新 "Quick Start" 后加 `harness run` 命令使用示例
- 本仓 docs/ 下新增本文件的反向引用（在 stage1 / stage2 索引里加一项 "Sailor multi-tool routing"）
- 跑过本仓的 `npm test` / `npm run lint`，全过

## 与现有本仓设计文档的关系

- 复用 `stage1-sync-design.md` 的 sync pipeline；新增的过滤是其中一个 hook
- 复用 `stage1-codex-parser.md` 的 codex adapter；H2 是它的渲染规则之一
- `stage1-mcp-design.md` 的 MCP 路径与 H3 的 spawn 路径**不冲突**——MCP 是把 harness 当 server 的能力，run 是把 harness 当 client 调子工具，两者并存
- `eval-harness-best-practices.md` / `eval-trajectory-design.md` 描述的 trajectory 记录可与 H5 的 session.json 串联（后续优化项，不在本计划）

## 不要做的

- 不要在本仓里写"sailor-harness 的 7 个 agent 文件"作为测试。fixture 用最小化 sample（2-3 个 agent 足够覆盖路由分支）。
- 不要在本仓里 commit `~/Workspace/sailor-harness/**` 的任何路径。
- 不要把 `OPENAI_API_KEY` 或 ChatGPT 订阅 token 硬编码到任何 fixture / 测试 / 文档里。
- 不要让 H3 的 spawn 把当前 shell 的 env 整段透传给 Codex 子进程——选择性传 `PATH`、`HOME`、Codex 自身需要的几个 var 即可，避免泄露用户自己的 ANTHROPIC_API_KEY 给 Codex 进程。

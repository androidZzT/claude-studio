# Eval Harness 最佳实践调研

本文档梳理 LLM / Agent eval 领域当前（2026 Q2）的工业界最佳实践，供 `harness` CLI 的 `eval` 能力设计参考。

## 行业公认的 5 条核心原则

### 1. 层次递进（eval hierarchy）

Eugene Yan / Hamel Husain 普及的模式，从便宜到昂贵：

```
L0  Assertions（正则、JSON schema、退出码）       ← 能用到 80%
L1  组件单测（retrieval、tool call 路径）
L2  LLM-as-judge（rubric 打分）
L3  Pairwise preference（A vs B，比打分可靠）
L4  Human eval（最贵，但是 judge 的 ground truth）
```

**原则**：能用 L0 解决的，就不要升到 L2。确定性断言优先。

### 2. Eval-driven development（EDD）

Hamel Husain 那套：**先写 eval case 再写 prompt**。prompt / skill 当代码看待，eval 当测试看。改了 prompt 跑 eval diff，像跑测试套件一样判断提升或退步。

### 3. Pairwise > 绝对分

LMSYS Chatbot Arena 的关键洞见：让 judge 回答"A 和 B 哪个更好"比"给 A 打 1-5 分"**一致性高一个数量级**。Claude-as-judge 论文也证实了这一点。

### 4. 分三类数据集

- **Smoke set**（10-30 个）：每次提交都跑
- **Golden set**（100-300 个）：nightly / 周跑
- **Rot watch set**：定期看哪些 case 已过时、覆盖不到新行为，主动替换

### 5. Calibrate LLM judge

LLM-as-judge 必须先用一批人工标注对齐（Cohen's kappa ≥ 0.6 才可信），否则 judge 本身就是 bug 放大器。

---

## 可直接用的开源框架

| 框架 | 出品方 | 定位 | 对 harness 的适配度 |
|---|---|---|---|
| **Inspect AI** | **Anthropic** | Agent eval 专用，Task / Solver / Scorer 抽象，内置 sandbox | ★★★★★ Claude 原生，最贴合 |
| **Promptfoo** | 社区 | YAML-first，CI 友好，red-team 强 | ★★★★ 工程化好 |
| **DeepEval** | Confident AI | pytest-like，内置 G-Eval / RAG 指标 | ★★★ 侧重 RAG |
| **OpenAI Evals** | OpenAI | 老牌，registry 概念 | ★★ 维护不活跃 |
| **Braintrust / Langfuse / LangSmith** | 商业 / OSS | trace + eval dashboard | ★★★ 做遥测后端不错 |
| **Ragas** | 社区 | RAG 专用 | ✗ 场景不符 |

### Inspect AI 详解

Anthropic 官方推出，专门做 agent eval。核心范式：

```python
@task
def fix_failing_test():
    return Task(
        dataset=[Sample(
            input="修一下 src/foo.test.ts",
            files={"src/foo.ts": "...", "src/foo.test.ts": "..."},
            target="test passes"
        )],
        solver=[agent_solver(model="claude-sonnet-4-6")],
        scorer=[
            match_file(name="src/foo.ts", pattern=r"a \+ b"),
            shell_exit(cmd="npm test", code=0),
        ],
        sandbox="docker",
    )
```

- 原生 sandbox（Docker / local）
- `solver` 是 agent 循环（可接 Claude Code / Codex 子进程）
- `scorer` 组合（确定性 + LLM-as-judge 都支持）
- 已在 Anthropic 内部 alignment evals 打磨

**harness 的 `eval` 命令完全可以用 Inspect AI 做引擎**，只需写 adapter 把 `scenarios/*.yaml` → Inspect Task。

### Promptfoo 详解

```yaml
providers:
  - id: openai:chat:gpt-5
  - id: anthropic:messages:claude-sonnet-4-6
tests:
  - vars: {prompt: "fix the failing test"}
    assert:
      - type: contains
        value: "a + b"
      - type: llm-rubric
        value: "Is the fix minimal and correct?"
```

工程化成熟，GitHub Action 一键接入，适合 CI 集成。

---

## Agent / Coding-Agent 领域的专项实践

### A. SWE-bench 套路

SWE-bench 是最成熟的 coding agent benchmark，核心做法：

- 每个 case 一个独立 git 仓 snapshot
- Agent 可读写这个仓
- 最终用**原仓的测试套件**判定（用项目自己的测试当 judge，最干净）
- 记录完整 trajectory（所有工具调用）

**迁移到 harness**：每个 scenario 就是一个"迷你项目"，判定用该项目自己的 `npm test` / `go test` / 断言脚本。

### B. Trajectory evaluation

Agent 走对了路径比"最终结果对"更能反映 skill 质量：

- 调用了哪些工具、顺序对不对
- 有没有多余探索、死循环
- token 消耗是否合理

可量化为：`tool_calls_count`、`unique_files_touched`、`token_efficiency = output_quality / tokens`。

### C. Hamel Husain 的 "error analysis loop"

最被工业界采纳的实战方法：

1. 跑一批真实 session
2. 人工标 **failure modes**（归类失败原因）
3. 按 failure mode **加 eval case 进 golden set**
4. 修 prompt / skill
5. 回去跑 golden set 确认修好、没破坏别的
6. 循环

比"凭直觉写 scenario"高效得多。

### D. LLM-as-judge 技巧清单

- **CoT before verdict**：让 judge 先分析再打分，消除随机性
- **Position swap**：A/B 对比两种顺序各跑一次，避免位置偏见
- **Reference answer**：给 judge 标准答案参考，大幅提升一致性
- **Majority vote**：重要 eval 跑 3 次 judge 取多数
- **Judge meta-eval**：定期用人工标注样本回归 judge 本身

### E. 数据集管理"三可"

- **可归因**：每条 case 标记来源（真实 session / bug report / 人工构造）
- **可追溯**：每次 eval 输出带 commit hash + dataset version
- **可退役**：case 不再代表当前业务时主动删，不要累积垃圾

---

## harness-cli 的具体建议

**别自己造 eval 引擎**，在成熟框架上套一层：

| 层 | 推荐方案 |
|---|---|
| Scenario 作者体验 | 自定义 `evals/scenarios/*.yaml`（易写） |
| **执行引擎** | **Inspect AI**（Anthropic 官方，agent 原生）或 **Promptfoo**（工程化好） |
| Judge | Claude Haiku 做 judge，Sonnet 做 meta-eval，pairwise 优先 |
| 遥测后端 | `.harness/telemetry.db`（SQLite）+ 可选推 Langfuse（自托管） |
| 回归门 | Promptfoo GitHub Action 或自写 `harness eval --gate` |
| 参考 benchmark | **SWE-bench Lite**（给 harness 跑 smoke test，验证自己没把 agent 整废） |

### Smoke / Golden / Canary 三档

```
evals/
├── smoke/          ← 10 个，PR 必跑，< 5 min，用 Haiku
├── golden/         ← 100 个，nightly，用 Sonnet
└── canary/         ← 5 个"永远不能坏"的核心场景，每次 sync 后立跑
```

### 修订版 MVP 路线

| 版本 | 内容 |
|---|---|
| **v0.2** | 遥测（L0 被动轨道）+ smoke set 5 个 scenario（Inspect AI + 确定性 scorer） |
| **v0.3** | smoke → golden 扩 20 个；加 pairwise 模式（HEAD vs HEAD~1） |
| **v0.4** | 引入 LLM-as-judge（带 calibrate 步骤）+ trajectory metrics |
| **v0.5** | error analysis loop 工具化（`harness triage` 从真实 session 抽失败样本） |

---

## 架构：被动 + 主动两条轨道

```
┌──────────────────────────────────────────────┐
│  Track A: 被动遥测（始终开启，零成本）          │
│  ├─ PreToolUse hook   → 记录工具/skill 调用     │
│  ├─ PostToolUse hook  → 记录成功/失败/tokens    │
│  ├─ UserPromptSubmit  → 记录用户输入             │
│  └─ Stop hook         → 记录 session 结束        │
│  → .harness/telemetry.db (SQLite)              │
└──────────────────────────────────────────────┘
         ↓ derived metrics
   invocation_rate / success_rate / tokens_per_skill /
   followup_ratio（用户反复改嘴 = 第一次输出不对）

┌──────────────────────────────────────────────┐
│  Track B: 主动回放（按需 / CI）                 │
│  ├─ evals/scenarios/*.yaml — 场景库            │
│  ├─ replay engine — Inspect AI 驱动             │
│  ├─ assertions — 确定性断言优先                 │
│  └─ judge（可选）— LLM-as-judge                 │
│  → .harness/eval-history/                      │
└──────────────────────────────────────────────┘
         ↓ compare
   harness eval --compare HEAD~1..HEAD
```

## Scenario YAML 范式

```yaml
name: fix-failing-test
tools: [claude-code, codex]
prompt: "src/foo.test.ts 失败了，修一下"
fixtures:
  files:
    src/foo.ts: "export const add = (a,b) => a - b"
    src/foo.test.ts: "expect(add(1,2)).toBe(3)"
asserts:
  - kind: tool_called
    tool: Edit
    file: src/foo.ts
  - kind: file_matches
    file: src/foo.ts
    pattern: "a \\+ b"
  - kind: shell
    run: "npm test"
    expect_exit: 0
  - kind: max_tool_calls
    value: 10
budget:
  max_tokens: 20000
  timeout_s: 120
judge:
  enabled: false
  rubric: "修复是否最小化、没有副作用？1-5 分"
```

**核心原则**：确定性断言（`tool_called` / `file_matches` / `shell exit_code`）不需要 LLM judge，速度快、可重复、CI 友好。LLM judge 只在没有基准答案时补充。

---

## 关键设计决策

### 1. Judge 优先级：deterministic > LLM judge

确定性断言能覆盖 70% 的 eval 需求（文件产出、命令退出码、工具序列），成本 0，噪声 0。LLM judge 做兜底。

### 2. Scenario 要贴业务

通用场景（"修 bug"）价值低。应**每个自研 skill** 写 2-3 个代表性 scenario：

- 正例：skill 应被触发且产出正确
- 反例：skill 不该被触发（验证触发条件准确性）
- 边界：输入异常时 skill 的降级行为

### 3. 成本控制是死线

- Scenario 预算（`budget.max_tokens`）
- 全局预算（`harness eval --max-cost $5`）
- 缓存（相同 scenario + 相同 config hash → 取上次结果）
- 默认用 Haiku 跑 eval，除非场景要求 Sonnet / Opus

### 4. 回放环境必须隔离

- 每个 scenario 一个 temp git worktree，跑完销毁
- 不污染用户真实 `~/.claude/`
- 用 `HARNESS_STATE_DB` 环境变量隔离 telemetry

### 5. Diff 模式是核心价值

单次 eval 结果没意义，**对比**才有。示例输出：

```
scenarios: 18 pass → 20 pass (+2)
tool_calls avg: 12 → 8 (-33%)
tokens avg: 4500 → 3200 (-29%)
regressions: [scenario-X: pass → fail]
```

把这个 diff 变成 PR 评论，质量门自然落地。

---

## CLI 形态预览

```bash
# Track A: 查被动数据
harness metrics                            # 汇总
harness metrics --skill hookify --since 7d # 单 skill 趋势
harness metrics --compare "1w ago"         # 周对比

# Track B: 跑场景
harness eval                               # 跑全部
harness eval --scenario fix-failing-test   # 单个
harness eval --compare HEAD~1..HEAD        # 配置 diff 对比
harness eval --tool codex                  # 只在 codex 下跑

# 回归门（CI）
harness eval --gate "no_regression,pass_rate>=0.9"
```

---

## 待决策点

### Q1：Track A 的遥测收不收真实 session 数据？

- **方案 A**：只收 harness-cli 开发自己产生的数据（安全，样本少）
- **方案 B**：收用户所有 session（xhs-ops / commander 的）— 样本大但**隐私问题**，运营 prompt 里有用户评论、笔记内容
- **方案 C**：可配置，默认 off，用户按业务选择

### Q2：scenario 库怎么积累？

- **方案 A**：完全手工写（质量高但慢）
- **方案 B**：从真实 session telemetry 挑有代表性的 prompt 自动转（快，需人工 review 防泄漏）
- **方案 C**：直接从 bug report / 用户吐槽转（贴业务，数量少）

---

## 参考资料

1. **Hamel Husain** — "Your AI Product Needs Evals"，https://hamel.dev/blog/posts/evals/
2. **Eugene Yan** — "Evals & Task-Specific LLM Evaluators"，https://eugeneyan.com/writing/llm-evaluators/
3. **Anthropic Inspect AI** — https://inspect.ai-safety-institute.org.uk/
4. **Shreya Shankar** — "Who Validates the Validators?"（judge calibration）
5. **Promptfoo docs** — https://promptfoo.dev/docs/
6. **SWE-bench** — Coding agent eval 祖师爷论文及数据集
7. **LMSYS Chatbot Arena** — pairwise preference 权威实践

# harness-cli 技术调研摘要 — source

源材料：`PLAN.md`、`docs/harness-cli/architecture/eval-trajectory.md`、`docs/harness-cli/research/eval-harness-best-practices.md` 与 14 个 stage 设计文档。本图聚焦"调研发现 → 技术决策 → 当前进度 → 未来展望"四段式叙事。

## 1. 痛点 / 问题陈述

- 多个独立业务（commander / xhs-ops / cc-stats / 等）各自拥有 Claude Code / Codex / Cursor 配置
- 全局 `~/.claude/` 共享配置改动影响面失控
- ECC 装了 280+ skills，每业务实际只用十几个，噪声大
- 改了 rule / skill 后无法量化影响（被触发频次？输出退化？）
- 新机器或新业务从零搭建全靠手工
- 跨工具（Claude / Codex / Cursor）配置碎片化，重复维护

## 2. 行业关键发现

- **AGENTS.md 是事实标准**（Codex / Cursor / Gemini CLI / Aider 全兼容）
- **MCP 是工具协议事实标准**（Anthropic 主导，多工具采纳）
- ECC / davila7 是 marketplace 性质，不解决"配置如何版本化"
- skill quality 监测、调用频次时序、output drift 是工业空白
- Inspect AI（Anthropic）是 agent eval 最贴 Claude 的开源框架

## 3. 核心定位（关键决策）

- 不重造 marketplace 轮子
- Harness-as-Code：声明式 + 可版本化 + 跨工具
- 类比：ECC = npm registry，harness-cli = `package.json` + `npm install` + `npm test`
- 一个业务一个 harness 仓（独立版本，独立 PR）

## 4. 技术架构决策

- TypeScript + Node 22 主栈，与 claude-studio 同栈，可共享 `@harness/core`
- 例外：PreToolUse 热路径用 bash + sqlite3 CLI（避 Node 启动税）
- partial-ownership merger：harness 与用户共管 `settings.json`，按 top-level key 划清所有权
- manifest schema_version=1 + add-only 兼容（features 名永不删改）
- adapter 注册器 + capability 矩阵 → studio 反向集成的 JSON contract

## 5. 多工具适配现状

- claude-code adapter：10 capabilities（CLAUDE.md / agents / commands / skills / rules / scripts / hooks / mcp / plugins / reference-projects）
- codex adapter：2 capabilities（AGENTS.md / config.toml）
- cursor adapter：2 capabilities（rules.mdc / mcp.json）
- 一份 canonical source（AGENTS.md.template）→ 三工具原生格式

## 6. eval 子系统设计要点

- 存储格式 = Inspect AI EvalLog（不重造）
- 捕获 = session jsonl 增量解析 + hook marker 旁路（不走 LLM proxy）
- 回放分三层：Mock（验证 harness 逻辑）/ 结构化 diff（日常 regression）/ LLM-as-judge（标注）
- 可视化白嫖 `inspect view`，不自己写 UI

## 7. 当前进度

- Stage 1.0 ~ 1.14：sync / init / adapters 矩阵 / hooks / MCP / plugins / reference-projects 全部落地
- Stage 2.0：eval 基础设施（CommonEvent / TrajectoryAdapter / EvalLogWriter / ingest）
- 自举完成：harness-cli 自管自，`diff --check` zero drift
- 测试规模持续增长，覆盖率长期保持 92%+

## 8. 路线展望

- Stage 2.1 / 2.2：CC + Codex 真实 parser
- Stage 2.3：`harness eval diff` 结构化 regression
- Stage 2.4 / 2.5：mock 回放 + LLM judge
- 与 claude-studio 整合（rename → harness-studio）
- 跨业务 harness diff 与共性抽象

## 关键金句候选

- "把 AI Agent 配置当代码管：声明、同步、校验、回滚"
- "一份 SSoT，三工具落盘"
- "不造市场，做版本化的配置中枢"

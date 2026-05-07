# SDD 阶段 — 人深度参与，正在沉淀 Spec

> **主题**：AI Coding 演化阶梯的**前一站** — Spec Driven Development（SDD）模式，半自动化，人需要在每个关键节点 check + 把关，正在把项目级 spec 散落沉淀（架构 / 任务 / bug / 度量）。**此阶段还没有 harness 工程的概念**。
>
> **下一站**：当 spec 足够稳定 → 抽象进 harness 工程容器 → 进入 [harness 飞轮图](../harness-ecosystem/output/diagram.png)：agent 全自动迭代，人只调整 harness。
>
> **两图关系**：本图是阶段 1（人深度参与，沉淀 spec），ecosystem 飞轮图是阶段 2（harness 容器成型，agent 全自动）。**演化方向**：右下角进化箭头从本图末端指向飞轮图。
>
> **现实证据**：sailor_fe_c_kmp 项目的真实工作流（`~/Workspace/sailor_fe_c_kmp/CLAUDE.md` + `.claude/skills/kmp-{feature,plan,start-review,end-review,bug-fix}/SKILL.md`）。

---

## 1. 阶段定位（演化阶梯中的位置）

```
[阶段 0] 全手工 ───→ [阶段 1] SDD（本图）───→ [阶段 2] Harness 飞轮 ───→ [阶段 3] 自演化
                  人写 spec            人调约束              系统自治
                  agent 半自动         agent 全自动
                  spec 散落仓库内      spec 沉淀进 harness 容器
                  ⬆ 这里               ⬆ 飞轮图
```

本图的核心叙事：**人正在用一次次 check 把 spec 从大脑里搬到仓库里**。每个 check 通过的产物（architect.md / todo.md / code-review/ / bugs.md / metrics.md / ADR）都是未来 harness 工程的素材原矿。

---

## 2. 两个角色（极简抽象）

| 角色                      | 在 SDD 阶段的定位                                                                                        | 介入频率                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **人 / Engineer**         | **Spec 作者 + 守门员**。深度介入：写架构、答澄清、读代码、判沉淀清单、真机验证。每个 spec 节点都要确认。 | **高频**，固定 7 个关卡 + 中途阈值触发 |
| **CC/Codex Coding Agent** | **半自动执行者**。能跑工作流，但每个关键节点必须停下等人 approve 才能继续。                              | 中频，受关卡节流                       |

> 与下一阶段的对照：飞轮图里人是"约束架构师"（写规则不写 spec），agent 是"全自动工人"。本图里人**还在写 spec**，agent **还会被人打断**。

---

## 3. SDD 工作流 10 节点 + 7 个人工关卡

### 节点 0 — 现状诊断

- agent 自动读取仓库状态，给出"建议从哪开始"。
- **🔴 人工关卡 #1：入口确认**。人 explicit 说"好，从 X 开始"才推进。

### 节点 1 — 方案设计（**沉淀 spec #1：架构**）

- agent 按既定架构规范写 `architect.md`（machpro 对齐字段、三层职责、ADR 引用）。
- **🔴 人工关卡 #2：架构 spec approve**。人读 architect.md 确认对齐字段、引用 ADR。
- **沉淀产物**：`kkmp-shop/docs/<模块>/architect.md`

### 节点 2 — Clarifying Questions（**沉淀 spec #2：业务边界**，最关键的一步）

- agent 主动提 ≥ 5 个具体问题（边界 case / 接口复用 / 弹窗空态 / 性能 / 双端分支）。
- **🔴 人工关卡 #3：用户答 ≥ 5 问**。这一步决定后续 review 轮次，不能跳。
- **沉淀产物**：对话记录 → 后续抽成 ADR / rule（在节点 8 沉淀阶段落盘）

### 节点 3 — 任务拆分（**沉淀 spec #3：todo**）

- agent 写 `todo.md`。
- **无人工关卡**（机械拆分）。
- **沉淀产物**：`kkmp-shop/docs/<模块>/todo.md`

### 节点 4.0 — 接口骨架（**沉淀 spec #4：契约**）

- agent 写 commonMain 全部 `TODO("not yet implemented")` 接口骨架。
- 硬约束：禁写实现。
- **无人工关卡**。
- **沉淀产物**：commonMain 接口签名（Action / Event / State / Module / VM / Repository）

### 节点 4.1 — TDD RED（**沉淀 spec #5：行为契约**）

- agent 基于骨架写测试（编译过 + 运行 RED），自我 review。
- **无人工关卡**。
- **沉淀产物**：commonTest/\*.kt（行为锚点）

### 节点 5 — 三端并行实现

- agent 在 worktree 隔离下并行三轨（commonMain / Android / iOS）让 RED → GREEN。
- 每轨自我 review；UI 必先产出 layout-spec.md + Paparazzi 截图。
- **🟡 中途关卡（条件触发）**：
  - 每 **300 行** → 人增量 review（避免最终一次审太多）
  - 每 **1000 行** → 强制开 PR + 团队 review
- 退出前编译必须通过。

### 节点 6 — 多视角自检循环

- agent 从 3 视角并行自审：machpro 对齐 / 架构规范 / UI 还原。
- Confidence ≥ 80 才上报；Critical 自动修到清零；Important 留给人决策。
- 循环上限 3 轮。
- **🚫 反向硬约束**：Critical > 0 时**禁止**通知人 review（不占人带宽）。
- **无人工关卡**（人不在这一层介入）。

### 节点 7 — 用户 Review（**沉淀 spec #6：质量基线**，核心关卡）

- 前置门槛：节点 6 Critical=0。
- **🔴 人工关卡 #4：人审代码**。流程：
  1. agent 通知"Critical=0，Important N 条待定，请 review"
  2. 人说"开始 review" → 记录开始时间 + 基准 commit
  3. 人读代码、提意见（结构性意见会引发返工）
  4. 人说"review 通过" → 自动算耗时 + 采纳率，写入 metrics
- 多轮循环直到 approve。
- **沉淀产物**：`code-review/YYYY-MM-DD-*.md` + `metrics.md`（耗时 + 采纳率）

### 节点 8 — 沉淀 & 复盘（**SDD 阶段最关键的节点 — 把 spec 抬升成可复用约束**）

- 3 个触发点：节点 2 答完 / 节点 7 approve / 节点 10 bug 真机 OK。
- agent 出沉淀候选清单（可复用 pattern / 新坑 / ADR 级决策）。
- **🟡 人工关卡 #5（轻量）**：人 approve 候选清单才落 commit。
- 落地：env 类（`.claude/` / `CLAUDE.md` / `architecture/`）→ env 分支独立 commit；业务类（`bugs.md` / `metrics.md`）→ 业务分支。
- 收尾：agent 给 Summary（产出 / 决策 / 遗留 TODO / 下一步）。
- **🔴 人工关卡 #6：Summary 后定下一步**。
- **沉淀产物（最重要的累积）**：
  - **新 ADR** → `.claude/docs/architecture/adr/00X-*.md`
  - **新 rule** → `.claude/rules/*.md`
  - **新 skill** → `.claude/skills/*/SKILL.md`
  - **agent 踩坑清单** → `.claude/agents/*.md`
  - **bugs.md 增量** → 每模块陷阱清单
  - **metrics.md 增量** → 耗时 / 采纳率时序

> **节点 8 是当前阶段的核心引擎** — 每次循环都把"散落的 spec 经验"抬升一层（对话 → ADR → rule → skill → agent）。**当 sediment 足够厚时，就具备了演化到下一阶段（harness 工程）的素材。**

### 节点 10 — 维护态（bug 循环 + 回退判定）

- 人报 bug → agent P1-P6（现象 → 证据 → RED → GREEN → 真机 → 沉淀）。
- bug ≠ hotfix，是前序节点欠账的显影；判定回退到哪一层重做。
- **🔴 人工关卡 #7：真机验证**。人在真机回归 OK 才 append `bugs.md` + 触发节点 8 沉淀。

---

## 4. 7 个人工关卡汇总（**画图核心**）

| #                     | 关卡                 | 节点      | 通过后才能进     | 此关卡产生的 spec               |
| --------------------- | -------------------- | --------- | ---------------- | ------------------------------- |
| **#1**                | 入口确认             | 0 → 1     | 节点 1           | —                               |
| **#2**                | 架构 approve         | 1 → 2     | 节点 2           | architect.md                    |
| **#3**                | 答 Clarifying ≥ 5 问 | 2 → 3     | 节点 3           | 业务边界 → 后续 ADR / rule      |
| **🟡 中途 (300 行)**  | 增量 review          | 节点 5 内 | 继续节点 5       | 中途代码反馈                    |
| **🟡 中途 (1000 行)** | PR + 团队 review     | 节点 5 内 | merge 后继续     | PR diff + 团队意见              |
| **#4**                | Code Review          | 6 → 7 → 8 | 节点 8           | code-review/\*.md + metrics     |
| **#5**                | 沉淀清单 approve     | 节点 8 内 | env 分支 commit  | ADR / rule / skill / agent 增量 |
| **#6**                | Summary 后定下一步   | 8 → 后续  | 下一动作         | 阶段决策                        |
| **#7**                | bug 真机验证         | 节点 10   | bugs.md + 节点 8 | bugs.md 陷阱清单                |

**🚫 反向硬约束（关键 — 防止人被打断）**：

- 节点 6 Critical > 0 时**禁止**通知人 review
- AI 能自动修的规则违反不占人带宽
- confidence < 80 的 issue 不上报

---

## 5. 此阶段的"半自动"特征（vs 下一阶段）

| 维度         | 阶段 1 SDD（本图）                                                                         | 阶段 2 Harness 飞轮（下一站）                                    |
| ------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 人的角色     | **Spec 作者 + 守门员**                                                                     | 约束架构师（只调 harness）                                       |
| 人的介入频率 | **高频**（7 个关卡 + 中途）                                                                | 低频（T0 设定 / T6 反馈）                                        |
| Agent 自治度 | **半自动**（每关卡必停）                                                                   | 全自动（容器内闭环）                                             |
| Spec 形态    | **散落** in 仓库各处（architect.md / todo.md / code-review/ / bugs.md / metrics.md / ADR） | **沉淀**进 harness 容器（agents / skills / rules / hooks / MCP） |
| 沉淀机制     | 节点 8 手动审核候选清单 → env 分支 commit                                                  | harness-cli sync 自动同步                                        |
| 反馈通道     | 人读代码 / 真机验证 / 写 review 报告                                                       | 轨迹回放反馈（trajectory + eval）                                |
| 复用粒度     | 单仓内（每模块一份 architect.md）                                                          | 跨仓（harness 容器多业务复用）                                   |
| 工程隐喻     | **车间打样**（每件都要质检）                                                               | **流水线**（流程已固化，巡检即可）                               |

---

## 6. 两图迭代关系如何传达（**不画显式箭头**）

按用户指示：**不**在图中画"→ 飞轮图"的进化箭头。两图的迭代关系靠以下**隐式手段**传达：

1. **标题对仗**：本图标题写「**SDD 阶段** — 人深度参与，沉淀 Spec」，飞轮图标题是「**harness 飞轮** — 双循环加速业务迭代」。看到"阶段"二字读者就明白存在前后阶段。
2. **阶段定位横条**（可选）：图顶部或底部一条小横条标 `阶段 0 → 阶段 1（你在这） → 阶段 2 → 阶段 3`，**纯标签**，不连箭头到飞轮图。
3. **视觉同源 + 形状对照**：保持 craft-handmade 风格一致（同一作者笔触），但本图用线性 / 横向工地感，飞轮图是环形容器，**形状本身就在说**"这是不同阶段"。
4. **Sediment 仓自身就是叙事**：本图右侧 / 底部画一堆"散落的 artifact"，**它们就是未来 harness 容器的素材**，但本图里这些 artifact 还没被任何容器收拢 — 留给读者自己脑补"下一步是把它们装进容器"。

**结论**：本图叙事完全自洽，不依赖飞轮图也能读懂。两图的迭代关系交给读者通过标题 + 视觉差异自己感知，不强加箭头。

---

## 7. 信息架构（图层建议）

**两个泳道 + 一个 sediment 仓**（**无演化出口箭头**）：

1. **左侧泳道：人**（Spec 作者 + 守门员，**深度介入**）
   - 7 个红色关卡门（密集排布，强调"人很忙"）
   - 每关卡旁标注产生的 spec artifact
   - 视觉重量大

2. **右侧泳道：CC/Codex Coding Agent**（**半自动**）
   - 10 个工作节点横向铺开
   - 节点 4-5 标"三端并行"
   - 节点 6 标"3 视角自检"
   - 每个节点出 spec artifact（图标：📄 architect.md / 📋 todo.md / 🔴 RED 测试 / 🟢 GREEN 代码 / 🔍 review 报告 / 🐛 bugs.md / 📊 metrics.md / 📐 ADR）

3. **底部 / 右侧"Sediment 仓"**（**spec 累积层 — 本图叙事的终点**）
   - 一堆散落的 artifact 图标，标注"sediment（沉淀中）"
   - 节点 8 用箭头从工作流指向 sediment 仓
   - **sediment 仓不画出口箭头**，留白即可（读者通过标题 + 风格对照自行理解下一阶段）

---

## 8. 关键文案（图里要直接出现）

- **主标题**：「**SDD 阶段 — 人深度参与，正在沉淀 Spec**」
- **副标题**：「Spec Driven Development · 半自动化 · 7 个人工关卡 + 10 节点工作流」
- **阶段定位横条**：`阶段 0 全手工 → 阶段 1 SDD（你在这） → 阶段 2 Harness 飞轮 → 阶段 3 自演化`
- 7 关卡：`#1 入口 / #2 架构 / #3 Clarifying / #4 Code Review / #5 沉淀清单 / #6 下一步 / #7 真机验证`
- 中途关卡：`🟡 300 行 / 🟡 1000 行 PR`
- 反向约束：`🚫 Critical>0 不打扰 / 🚫 confidence<80 不上报`
- Sediment 仓标签：「**Spec Sediment**：散落但正在累积 — architect / todo / ADR / rule / skill / bugs / metrics」
- **底部金句**：「**人写 spec · agent 跑流程 · sediment 在累积**」

---

## 9. 与飞轮图的视觉差异（让两图一眼就能区分阶段）

| 视觉维度   | 本图（SDD）                                                            | 飞轮图（已存在）                    |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------- |
| 主体形状   | **横向线性**（10 节点 + 7 关卡，工地感）                               | **环形飞轮**（agent 7 步 cycle）    |
| 人的位置   | **左侧泳道，密集介入**                                                 | **左侧外圈慢循环**                  |
| Agent 形态 | 半自动工人，每节点必停                                                 | 容器内全自动 cycle                  |
| Spec 形态  | **散落 sediment**（图标 / 文件堆）                                     | **harness 容器边框**（包围 cycle）  |
| 节奏感     | "正在干活 / 工地"                                                      | "已稳定 / 流水线"                   |
| 主色调建议 | 仍 craft-handmade，但偏"工地暖灰 + 关卡红 + sediment 土黄"，工程草图感 | craft-handmade 飞轮（已是温暖纸本） |

---

## 10. 待确认（出图前请你 check）

1. **布局选择**（不画演化出口箭头，纯本图叙事）：
   - **(A) winding-roadmap**：蜿蜒路径串起 10 节点 + 7 关卡红门，sediment 仓在路径终点。**叙事感最强**。
   - **(B) linear-progression**：横向时间轴 + 关卡红门 + 底部 sediment 仓。**工程感强**，对照清晰。
   - **(C) hub-spoke**：节点 8 沉淀作为 hub 居中，10 个工作节点 + 7 关卡 + sediment artifact 围绕。**强调"沉淀是核心"**。
2. **风格**：与飞轮图一致用 **craft-handmade**（视觉同源，靠形状区分阶段）/ 换 **technical-schematic**（蓝图工地感，强调"在建工程"）/ 换 **chalkboard**（教学板，强调"在沉淀知识"）？
3. **阶段定位横条**：要 / 不要（要的话顶部一条小横条 `阶段 0 → 阶段 1（你在这） → 阶段 2`，纯标签）？

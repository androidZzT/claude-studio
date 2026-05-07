# Harness as Code 规划

> AI Coding 演化阶梯下的工程化落地方案：**人的角色从 spec 作者 → 约束架构师 → 哲学制定者**，agent 的自治度从 半自动 → 全自动 → 自演化。本文档描述当前所处的现状（L1）、即将推进的计划（L2）、远期展望（L3）。

---

## 引言：为什么需要 Harness as Code

AI Coding 的演化遵循一条清晰阶梯：

```
[阶段 0] 全手工          [阶段 1] SDD (L1)        [阶段 2] Harness 飞轮 (L2)     [阶段 3] 自演化 (L3)
   ↓                       ↓                          ↓                              ↓
人写代码               人写 spec                  人调约束                       人定哲学
                       agent 半自动                agent 全自动                    agent 自反思
                       spec 散落仓内               spec 沉淀进 harness 容器        harness 自我演化
```

每个阶段不是替代关系，而是**沉淀阶梯**：上一阶段的产出（spec / rule / pattern）成为下一阶段的容器化素材。本文档聚焦阶段 1 → 阶段 2 的工程化路径，并展望阶段 3。

---

## 一、现状（L1 — Spec Driven Development）


### 1.1 阶段定位

当前 AI Coding 处于 **Spec Driven Development（SDD）** 模式：

- **人**是 **Spec 作者 + 守门员**：深度介入工作流，每个关键节点（约 7 个 checkpoint）都需要人 approve 才能继续
- **CC/Codex Coding Agent** 是**半自动工人**：能跑工作流，但每个关卡必停等人放行
- **Spec** 散落沉淀在仓库各处（architect.md / todo.md / code-review/ / bugs.md / metrics.md / ADR），尚未被任何容器收拢

这一阶段的核心特征是**人深度参与 + 持续沉淀 spec**。每一次循环（需求 → 设计 → Coding → Review → 测试 → 沉淀），都把"散落的 spec 经验"抬升一层，从对话 → ADR → rule → skill → agent。

### 1.2 门店页原生化

门店页原生化项目是将 MachPro 项目重构为 KMP逻辑 + 原生 UI，目前处于不断沉淀 skill、规则、知识库的阶段。下面按**工作流**和**多Agent**两个视角详细展开。

#### 1.2.1 工作流视角

10 个 Phase，由 `kmp-feature` 驱动。每个阶段做什么、谁干、人要不要介入：

| #   | 阶段        | 做什么                                       | 执行                                  | 人介入                          |
| --- | ----------- | -------------------------------------------- | ------------------------------------- | ------------------------------- |
| 0   | 环境诊断    | 看仓库现状定起点                             | team-lead                             | 🔴 拍板从哪个 Phase 开始        |
| 1   | 方案设计    | 对齐 machpro 字段，写架构                    | architect                             | 🔴 审架构                       |
| 2   | 澄清问题    | 提 ≥ 5 个边界问题等用户答                    | team-lead                             | 🔴 用户答完才推进               |
| 3   | 任务拆分    | 拆成可执行 todo                              | team-lead                             | —                               |
| 4.0 | 接口骨架    | 写 commonMain 全部 TODO 签名                 | architect                             | —                               |
| 4.1 | TDD RED     | 基于骨架写测试到全 RED                       | tester + code-reviewer                | —                               |
| 5   | 三端并行    | commonMain / Compose UI / iOS UIKit 同时写   | architect ‖ android-coder ‖ ios-coder | 🟡 300 / 1000 行触发增量 review |
| 6   | 多视角自检  | 跑 3 视角 reviewer + machpro 对齐            | code-reviewer × 3 + machpro-parity    | — Critical=0 才放行             |
| 7   | 用户 Review | 用户读代码提意见 → approve 结算耗时 + 采纳率 | 用户 + team-lead                      | 🔴 **核心关卡** — 审代码        |
| 8   | 沉淀复盘    | 把本轮新坑 / 模式抽成 ADR / rule / skill     | efficiency-engineer                   | 🔴 审清单 + 收 Summary          |
| 10  | bug 维护    | 取证 → RED → GREEN → 真机 → 沉淀             | 按根因层派发                          | 🔴 真机验证                     |

#### 1.2.2 多 Agent 视角

7 个 agent，每个职责清晰、互不越界：

| Agent                 | 职责                           | 干什么                                     |
| --------------------- | ------------------------------ | ------------------------------------------ |
| `architect`           | 架构设计 + 数据层 + 逻辑层开发 | 出架构文档，按既定规范实现业务逻辑与数据流 |
| `android-coder`       | Android UI 开发                | 按设计稿还原 UI，覆盖空态 / 异常 / 交互    |
| `ios-coder`           | iOS UI 开发                    | 按设计稿还原 UI，覆盖空态 / 异常 / 交互    |
| `tester`              | 测试用例编写                   | 先于实现写 RED 测试，不动业务代码          |
| `code-reviewer`       | 代码审查                       | 多视角并行审查：架构 / 设计稿 / 代码规范   |
| `machpro-parity`      | 跨仓对齐                       | 与参考项目逐字段比对，发现行为偏差         |
| `efficiency-engineer` | 规则沉淀                       | 把每轮新模式 / 新坑抽成 ADR / rule / skill |

#### 1.2.3 Spec 沉淀内容

下表汇总当前已沉淀进 `.claude/` 的全部工程化资产 — L1 阶段 spec 容器化的素材原矿：

| 类别          | 数量 | 干什么                                          | 何时用到                                                         | 路径                              | 内容概览                                |
| ------------- | ---- | ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| **Skill**     | 13   | 把工作流复用单元封装成可调用模板                | 用户显式 `/<name>` 调用 / SKILL `description` 命中场景时自动建议 | `.claude/skills/<name>/SKILL.md`  | 主流程 + UI 还原 + 辅助 三类工作流模板  |
| **Rule**      | 15   | agent 写代码时必须遵守的硬约束                  | 改动文件 path 命中 frontmatter `paths:` 时自动加载到 context     | `.claude/rules/*.md`              | 架构 / machpro / UI / 测试 / 工作流约束 |
| **架构 docs** | 15   | 架构决策固化 + 长背景知识 / 重构指南            | rule 引用结论；架构争议 / 新组件接入 / 跨层桥接时翻看            | `.claude/docs/architecture/`      | ADR + 重构指南 + 接入手册               |
| **Hook 脚本** | 4    | 事件触发的自动质量门                            | session 启动 / 改 .kt / git commit / 任务完成 等事件自动跑       | `.claude/scripts/*.sh`            | 启动预检 / 提交后 lint / todo 同步 等   |
| **指标监控**  | 2    | 记录工作流事件 + 算指标的数据底座               | hook 自动写入；review 计耗时 / 出 metrics 报表时查询             | `.claude/metrics/`                | events schema + 事件流                  |
| **跨仓配置**  | 2    | 声明参考项目（machpro / iOS / Android）本地路径 | session 启动加载；machpro-parity 跨仓字段对齐时读取              | `.claude/reference-project*.json` | 团队配置 + 本机配置                     |

#### 1.2.4 演化里程碑

当前是 **KMP + 原生 UI** 模式（commonMain Kotlin 业务逻辑 + Android Compose / iOS UIKit）。下一步往**「一套 spec / 双端独立 Native 实现」**演化，不再依赖 KMP。关键节点：

| 里程碑                            | 时间    | 标志事件                                                                                             |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| **M1 — harness 迁移完成**         | 2026-05 | sailor-harness 仓上线，`harness sync` zero drift；跨机器可一键恢复环境                               |
| **M2 — 双端 Native 适配方案定稿** | 2026-Q3 | 输出"一套 spec / 双端独立实现"架构 ADR + 试点 ≥ 1 个模块跑通                                         |
| **M3 — iOS spec 沉淀完整**        | 2026-Q4 | iOS spec 厚度对齐当前 Android（独立 ADR / rules / skills / agent），iOS 端能独立跑通 10 Phase 工作流 |
| **M4 — KMP 退役**                 | 2027    | commonMain 业务逻辑全部拆为双端独立实现，KMP 仅过渡保留或彻底移除                                    |

转型动机：双端独立实现降低 KMP 维护成本，让 iOS 团队不必再走 Kotlin 跨编译链路；spec 层抽象提高，业务规则一次写，双端各自落地。

#### 1.2.5 Spec 沉淀全景

按工作流环节分类，每个 spec 只列一次。图例：✅ 完成 / 🚧 进行中 / ⏳ 未开始

<table>
<thead>
<tr><th>环节</th><th>类型</th><th>spec 项</th><th>说明</th><th>状态</th></tr>
</thead>
<tbody>
<tr>
  <td rowspan="3"><strong>环境搭建</strong></td>
  <td>🪝 hook</td><td><code>session-start-check</code></td><td>session 启动跑环境预检（git 干净 / 依赖齐全 / 参考仓路径）</td><td>✅</td>
</tr>
<tr>
  <td>🎯 skill</td><td><code>kmp-env-check</code></td><td>主动跑环境预检入口</td><td>✅</td>
</tr>
<tr>
  <td>⚙️ config</td><td><code>reference-project*.json</code></td><td>声明 machpro / iOS / Android 参考项目本地路径</td><td>✅</td>
</tr>
<tr>
  <td><strong>需求理解</strong></td>
  <td>—</td>
  <td>（无独立 spec — M3 补需求模板 + Clarifying 检查清单）</td>
  <td>team-lead 直问 ≥ 5 个 Clarifying Q</td>
  <td>—</td>
</tr>
<tr>
  <td rowspan="32"><strong>技术设计</strong></td>
  <td rowspan="3">🎯 skill</td>
  <td><code>kmp-design</code></td><td>Phase 1 出 architect.md</td><td>✅</td>
</tr>
<tr><td><code>kmp-plan</code></td><td>Phase 3 出 todo.md（任务拆分）</td><td>✅</td></tr>
<tr><td>ObjC design skill</td><td>iOS ObjC 业务逻辑设计入口（与 kmp-design 对偶）</td><td>⏳</td></tr>
<tr>
  <td rowspan="2">🤖 agent</td>
  <td><code>architect</code></td><td>commonMain 三层切分 + 业务逻辑 + 数据流</td><td>✅</td>
</tr>
<tr><td>iOS 独立 architect</td><td>iOS 业务逻辑独立设计（与 KMP architect 对偶）</td><td>⏳</td></tr>
<tr>
  <td rowspan="7">📐 rule</td>
  <td><code>kmp-conventions</code></td><td>commonMain 代码规范（KMP MVVM）</td><td>✅</td>
</tr>
<tr><td><code>design-alignment</code></td><td>设计稿对齐约束</td><td>✅</td></tr>
<tr><td><code>machpro-alignment</code></td><td>与 machpro 逐字段对齐</td><td>✅</td></tr>
<tr><td>iOS 独立架构规范</td><td>iOS Native 代码规范（与 kmp-conventions 对偶）</td><td>⏳</td></tr>
<tr><td>ObjC 命名约定</td><td>SLK 类前缀 / 文件名规范 / 方法命名</td><td>⏳</td></tr>
<tr><td>ObjC Nullability 强制</td><td>头文件全部 nullable / nonnull 标注</td><td>⏳</td></tr>
<tr><td>ObjC 内存管理</td><td>ARC / weak / strong / unsafe_unretained 约束</td><td>⏳</td></tr>
<tr>
  <td rowspan="20">📄 doc</td>
  <td>ADR-001 i18n 位置</td><td>i18n 字符串只在 mapToState 使用</td><td>✅</td>
</tr>
<tr><td>ADR-002 DI 非空</td><td>核心依赖注入要求非空</td><td>✅</td></tr>
<tr><td>ADR-003 Event vs StateFlow</td><td>Event 一次性事件 / StateFlow 持续状态</td><td>✅</td></tr>
<tr><td>ADR-004 测试禁后门</td><td>测试代码不得开后门跳过业务逻辑</td><td>✅</td></tr>
<tr><td>ADR-005 mapToState 类型</td><td>mapToState 泛型 T 选型</td><td>✅</td></tr>
<tr><td>ADR-006 VM Facade 抽离</td><td>ViewModel 数据 Facade 抽离</td><td>✅</td></tr>
<tr><td>ADR-007 combine().stateIn 同步</td><td>Flow.combine().stateIn 同步契约</td><td>✅</td></tr>
<tr><td>ADR-008 视觉三方证据</td><td>视觉对齐三方证据（设计稿 / Paparazzi / 真机）</td><td>✅</td></tr>
<tr><td>ADR-009 VM mock 开关</td><td>VM 组装 + Debug Config Mock 开关</td><td>✅</td></tr>
<tr><td>doc-00 MachPro 重构指南</td><td>MachPro → KMP 迁移路径</td><td>✅</td></tr>
<tr><td>doc-01 MVVM 三层</td><td>MVVM 架构三层职责定义</td><td>✅</td></tr>
<tr><td>doc-02 iOS 集成</td><td>iOS 集成方案</td><td>✅</td></tr>
<tr><td>doc-03 新组件接入</td><td>新组件接入流程</td><td>✅</td></tr>
<tr><td>doc-04 Ksi 桥接</td><td>Ksi 跨平台桥接方案</td><td>✅</td></tr>
<tr><td>doc-05 Flow.combine.stateIn</td><td>Flow.combine.stateIn 用法手册</td><td>✅</td></tr>
<tr><td>iOS 独立架构指南</td><td>iOS Native 重构 / 接入 / 桥接手册</td><td>⏳</td></tr>
<tr><td>ADR-ObjC-1 跨语言数据契约</td><td>ObjC ↔ Kotlin 类型映射 + 序列化约定</td><td>⏳</td></tr>
<tr><td>ADR-ObjC-2 NSError 错误模型</td><td>错误传递 / Result 风格 / 异常抛出</td><td>⏳</td></tr>
<tr><td>ADR-ObjC-3 Block vs Delegate</td><td>异步回调风格选型</td><td>⏳</td></tr>
<tr><td>ObjC doc-MVVM 三层</td><td>ObjC 视角的 MVVM 三层职责（与 doc-01 对偶）</td><td>⏳</td></tr>
<tr>
  <td rowspan="19"><strong>Coding</strong></td>
  <td rowspan="2">🤖 agent</td>
  <td><code>android-coder</code></td><td>Android Compose UI 还原</td><td>✅</td>
</tr>
<tr><td><code>ios-coder</code></td><td>iOS UIKit 还原</td><td>✅</td></tr>
<tr>
  <td rowspan="4">🎯 skill</td>
  <td><code>kmp-ui-restore</code></td><td>新 Composable 必先产 layout-spec.md</td><td>✅</td>
</tr>
<tr><td><code>kmp-ios-ui</code></td><td>iOS UIKit 还原工作流</td><td>✅</td></tr>
<tr><td>iOS 截图约定 skill</td><td>iOS UI 强制截图工作流（与 paparazzi 对偶）</td><td>⏳</td></tr>
<tr><td>ObjC 业务逻辑实现 skill</td><td>commonMain 业务 → ObjC 重写工作流</td><td>⏳</td></tr>
<tr>
  <td rowspan="10">📐 rule</td>
  <td><code>ui-restore</code></td><td>UI 还原入口（双端共用）</td><td>✅</td>
</tr>
<tr><td><code>ui-restore-core</code></td><td>UI 还原核心约束（双端共用）</td><td>✅</td></tr>
<tr><td><code>ui-restore-android</code></td><td>Android Compose 3 问 gate / Token / 截图</td><td>✅</td></tr>
<tr><td><code>ui-restore-ios</code></td><td>iOS UIKit / SLThemeManager / Masonry</td><td>✅</td></tr>
<tr><td><code>machpro-to-compose-layout</code></td><td>machpro 布局 → Compose 翻译约束</td><td>✅</td></tr>
<tr><td><code>paparazzi-convention</code></td><td>Android 强制 Paparazzi 截图约定</td><td>✅</td></tr>
<tr><td><code>ios-autolayout-rtl</code></td><td>iOS Autolayout / RTL 约束</td><td>✅</td></tr>
<tr><td><code>task-branching</code></td><td>每任务独立分支 + 1000 行强制 PR 阈值</td><td>✅</td></tr>
<tr><td>iOS 截图 rule</td><td>iOS UI 截图规范（与 paparazzi-convention 对偶）</td><td>⏳</td></tr>
<tr><td>ObjC 业务逻辑代码规范</td><td>KSailorTransaction 业务层代码规范（与 kmp-conventions 对偶）</td><td>⏳</td></tr>
<tr>
  <td>🪝 hook</td><td><code>post-commit-check</code></td><td>提交后跑 lint + 触发模块编译验证</td><td>✅</td>
</tr>
<tr>
  <td rowspan="2">📜 script</td>
  <td><code>mvvm-lint</code></td><td>自研架构 lint：ViewModel / StateFlow / Repository 三层职责检查</td><td>✅</td>
</tr>
<tr><td>iOS lint script</td><td>iOS 架构 lint（与 mvvm-lint 对偶）</td><td>⏳</td></tr>
<tr>
  <td rowspan="5"><strong>Review</strong></td>
  <td rowspan="2">🤖 agent</td>
  <td><code>code-reviewer</code></td><td>3 视角并行 review（machpro / 架构 / UI），confidence ≥ 80 才上报</td><td>✅</td>
</tr>
<tr><td><code>machpro-parity</code></td><td>跨仓字段对齐：DataSource 参数 / 交互逻辑 / 校验链顺序</td><td>✅</td></tr>
<tr>
  <td rowspan="2">🎯 skill</td>
  <td><code>kmp-start-review</code></td><td>记录 review 起始时间 + 基准 commit</td><td>✅</td>
</tr>
<tr><td><code>kmp-end-review</code></td><td>算耗时 + 采纳率 + 写 metrics.md / events.jsonl</td><td>✅</td></tr>
<tr>
  <td>🪝 hook</td><td><code>task-completed-check</code></td><td>任务完成时检查 todo.md 同步状态</td><td>✅</td>
</tr>
<tr>
  <td rowspan="6"><strong>测试</strong></td>
  <td rowspan="2">🤖 agent</td>
  <td><code>tester</code></td><td>commonTest RED 测试（先于实现，不动业务代码）</td><td>✅</td>
</tr>
<tr><td>ObjC tester</td><td>iOS XCTest RED 测试（与 tester 对偶）</td><td>⏳</td></tr>
<tr>
  <td rowspan="2">🎯 skill</td>
  <td><code>kmp-integration-test</code></td><td>Maestro E2E 跑通工作流</td><td>✅</td>
</tr>
<tr><td>ObjC TDD skill</td><td>iOS XCTest 先于实现写 RED</td><td>⏳</td></tr>
<tr>
  <td rowspan="2">📐 rule</td>
  <td><code>testing-strategy</code></td><td>测试分层覆盖矩阵 + 90% 覆盖率门槛</td><td>✅</td>
</tr>
<tr><td>ObjC 测试策略</td><td>XCTest 用法 / iOS 测试分层（与 testing-strategy 对偶）</td><td>⏳</td></tr>
<tr>
  <td rowspan="3"><strong>构建 &amp; 发布</strong></td>
  <td rowspan="3">🎯 skill</td>
  <td><code>kmp-run</code></td><td>跑 Android / iOS demo</td><td>✅</td>
</tr>
<tr><td><code>kmp-publish</code></td><td>发版</td><td>✅</td></tr>
<tr><td><code>kmp-capture</code></td><td>截屏取证</td><td>✅</td></tr>
<tr>
  <td rowspan="4"><strong>沉淀</strong></td>
  <td>🤖 agent</td><td><code>efficiency-engineer</code></td><td>Phase 8 出沉淀候选清单 / 抽 ADR / 升级 rule</td><td>✅</td>
</tr>
<tr>
  <td rowspan="2">🎯 skill</td>
  <td><code>kmp-bug-fix</code></td><td>bug P1-P6 闭环（取证 → RED → GREEN → 真机 → 沉淀）</td><td>✅</td>
</tr>
<tr><td>ObjC bug-fix skill</td><td>iOS ObjC bug 闭环（与 kmp-bug-fix 对偶）</td><td>⏳</td></tr>
<tr>
  <td>📐 rule</td><td><code>env-branch</code></td><td>沉淀变更走 env 分支独立 commit</td><td>✅</td>
</tr>
<tr>
  <td rowspan="4"><strong>监控运维</strong></td>
  <td>📄 doc</td><td><code>events.schema.md</code></td><td>事件 schema 定义（events.jsonl 是 runtime 数据）</td><td>✅</td>
</tr>
<tr>
  <td rowspan="3">🏗️ 工程</td>
  <td>漏斗 scorer 12 静态指标</td><td>质量轨 6 + 性能轨 6 自动算</td><td>✅</td>
</tr>
<tr><td>bug 归因（LLM judge）</td><td>4 类标签 + 反推上游环节</td><td>⏳</td></tr>
<tr><td>pass@k / pass^k</td><td>同任务 k 次跑评估一致性 / 鲁棒性</td><td>⏳</td></tr>
<tr>
  <td rowspan="3"><strong>跨环节</strong></td>
  <td>🎯 skill</td><td><code>kmp-feature</code></td><td>10 Phase 总剧本（team-lead 入口）</td><td>✅</td>
</tr>
<tr>
  <td rowspan="2">📐 rule</td>
  <td><code>agent-role</code></td><td>派发严格按"路径→agent"映射</td><td>✅</td>
</tr>
<tr><td><code>external-repos</code></td><td>跨仓引用规则</td><td>✅</td></tr>
<tr>
  <td><strong>harness 工程化</strong></td>
  <td>🏗️ 工程</td><td>sailor-harness 仓 + <code>harness adopt</code></td>
  <td>反向迁移现有 .claude/ 为独立 harness 仓（M1 / Stage 1.15）</td>
  <td>🚧</td>
</tr>
</tbody>
</table>

**关键差距**（按里程碑分组）：

- **M1（2026-05）**：harness 工程化 — Stage 1.15 进行中
- **M2（2026-Q3）**：技术设计立"双端独立实现"ADR；现有 9 条 ADR 多数 KMP-centric，逐条评估留 / 改 / 移
- **M3（2026-Q4）**：iOS 端缺 5+ 项 Android 对偶资产（独立 architect agent / 独立架构 rule / 架构指南 / iOS 截图 skill / iOS 截图 rule / iOS lint hook）
- **M4（2027）**：KMP-centric 资产批量退役（`kmp-*` skill 改名 / `kmp-conventions` 拆双端 / `mvvm-lint` 拆双端 / `machpro-parity` 转型）

### 1.3 指标体系


L1 阶段已经能够端到端量化 agent 工作的质量与性能。两轨**正交**：质量轨回答"做得对不对"，性能轨回答"做得贵不贵 / 慢不慢 / 稳不稳"。

#### 质量轨：5 率 + bug 归因

按工作流环节分组，每个指标的公式 / 方向 / 典型范围 / 数据源 / 关键口径合并到下表：

| 指标                           | 环节              | 公式                                                          | 方向 | 典型                                                            | 数据源                                                                                                                                       | 关键口径 / 局限                                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------- | ------------------------------------------------------------- | ---- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **技术设计还原率**             | @ Coding          | `1 - 违反架构规范数 / 总规范数`                               | ⬆    | 60% — 95%                                                       | `mvvm-lint.sh` + reviewer 报告 architecture/ADR 类 issue；分母 = `.claude/rules/*.md` + `architecture/adr/*.md` 静态计数                     | 依赖规范集完整性。新增 ADR 后，相同代码的违反率可能"凭空升高"，需重新校准 baseline。                                                                                                                                                                                                        |
| **代码采纳率**                 | @ Review          | `1 - 返工行 / AI 产出行`                                      | ⬆    | 73% — 99%                                                       | sailor `kmp-end-review` SKILL；基准 commit = `/kmp-start-review` 时记录；AI 产出 = 基准 commit 时新增 .kt 行数；返工 = 基准→HEAD 的 .kt 行差 | review 期间结构性意见（"拆一下/重构 X"）引发的修改**算返工**，不论重构本身多正向。**反例口径**（已踩过坑）：把 review 期 起的新任务计为"新产出"拉高采纳率 — 错误，会掩盖结构性问题。                                                                                                        |
| **review 通过效率**（单 PR）   | @ Review          | `1 / review_round`                                            | ⬆    | 0.33 — 1.0                                                      | events.jsonl `review_round` 字段                                                                                                             | 每个 PR 一个值（非聚合）。用倒数让形态统一为 (0, 1]，与其它率对齐。1 轮过=1.0 / 2 轮=0.5 / 3 轮=0.33。                                                                                                                                                                                      |
| **一次通过率**（聚合）         | @ Review          | `N_一次过 / N_总 PR`（review_round==1 的 PR 数 / 总 PR）      | ⬆    | 30% — 80%                                                       | events.jsonl 聚合 review_end where review_round==1                                                                                           | 项目/模块/时窗聚合。**业界基线**：50%+ 良好；80%+ 优秀；< 30% 说明上游 spec 差或 agent 与团队风格未对齐。                                                                                                                                                                                   |
| **冒烟通过率**                 | @ 测试            | `冒烟 case 通过 / 冒烟 case 总数`                             | ⬆    | 80% — 100%                                                      | CI 跑 `.maestro/smoke.yaml` 或 `tests/smoke/` GREEN 数                                                                                       | 冒烟 case 集合必须**预先显式声明**（关键路径列表，非全测试集）。否则"事后加塞"会让分母涨，数字虚高。应当接近 100%，否则说明基础功能漏了。                                                                                                                                                   |
| **bug 率** ⚠️                  | @ 测试            | `bug 数 / (项目当前总代码行 / 1000)` 单位 bug/KLOC            | ⬇    | < 1 优 / 1-5 良 / 5-10 一般 / > 10 差（IBM Cleanroom 业界基线） | QA 提测 bug 数 + `git ls-files \| xargs wc -l`                                                                                               | **反向指标**。用密度而非绝对数：跨项目可比。归一化合成总分用 `max(0, 1 - bug率/10)`（例：3 bug/KLOC → 0.7）。仅算提测阶段 bug，上线后生产 bug 是另一个指标。                                                                                                                                |
| **bug 归因**（反馈通道，非率） | @ 测试 → 反推上游 | 4 类标签：`feature_miss / ui_deviation / logic_error / other` | —    | 标签分布                                                        | LLM judge（置信度≥80 直采，<80 进人审）+ 5-10% 抽查 calibration；闭环后必 append `bugs.md`（kmp-bug-fix P6 硬约束）                          | **反馈通道**：功能遗漏 → 需求评审（补 Clarifying / 需求清单）· UI 还原偏差 → 设计资源（补设计稿 / 组件库 / layout-spec）· 逻辑错误 → 技术方案设计（补 ADR / 架构 lint）· 其它 → 人工分析归一到上三类。**价值**：让 bug 不只是修复终点，更是上游 spec 升级的输入 — L1 阶段飞轮的真正驱动力。 |

#### 性能轨：Anthropic 官方 8 指标

完全对齐 [Anthropic Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)。每个指标的公式 / 方向 / 典型范围 / 数据源 / 关键口径合并到下表：

| 指标                                  | 维度       | 公式 / 含义                                                    | 方向 | 典型         | 数据源                                         | 关键口径 / 局限                                                                                                                                                                                      |
| ------------------------------------- | ---------- | -------------------------------------------------------------- | ---- | ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **n_turns**（对话轮次）               | Transcript | 完成任务的人 ↔ agent 对话轮数                                  | ⬇    | 1 — 20       | trajectory user_input 事件计数                 | 太少可能没充分沟通；太多说明 agent 听不懂或 spec 模糊。                                                                                                                                              |
| **n_toolcalls**（工具调用）           | Transcript | 完成任务的工具调用总次数（read / edit / bash / grep 等）       | ⬇    | 5 — 200      | trajectory tool_call 事件计数                  | 反向但需配合 pass@k 看：太少可能没完成任务。                                                                                                                                                         |
| **n_total_tokens**（总 token）        | Transcript | input + output + cache_read + cache_creation 总 token          | ⬇    | 10K — 1M     | trajectory model 事件 usage 字段聚合           | 直接对应"贵不贵"。                                                                                                                                                                                   |
| **time_to_first_token**（首响应延迟） | Latency    | 用户提交 → agent 输出第一 token 的时间（秒）                   | ⬇    | 0.5 — 5s     | 第一个 user_input ts → 第一个 model 输出 ts 差 | 反映"思考时间是否过长"，与 token 消耗正相关但不等同。                                                                                                                                                |
| **output_tokens_per_sec**（生成速度） | Latency    | 模型生成 token 的速率（tokens/秒）                             | ⬆    | 30 — 100 t/s | output_tokens / latency                        | 反映模型部署性能，与 agent 智能水平无关 — 同模型不同硬件速率不同。                                                                                                                                   |
| **time_to_last_token**（总耗时）      | Latency    | 任务开始 → 最后一个 token 的总挂钟时间（秒）                   | ⬇    | 30 — 1800s   | 第一事件 ts → 最后事件 ts                      | 最直观的"用户体感"指标。                                                                                                                                                                             |
| **pass@k (k=3)**                      | Success    | `1 - (1 - p)^k`：k 次中**至少 1 次**成功的概率（"能不能做对"） | ⬆    | 60% — 95%    | 同任务跑 k 次，"测试是否全绿"判定单次成功      | 业界标准（HumanEval / SWE-bench / MBPP）。日常开发阶段评估"愿意试 N 次能不能解出来"。p=80% 时 pass@3 = 99.2%。                                                                                       |
| **pass^k (k=3)**                      | Success    | `p^k`：k 次**全部**成功的概率（"稳不稳"）                      | ⬆    | 30% — 90%    | 与 pass@k 同一组 k 次跑数据                    | Anthropic 强调的 production-ready 指标。**经典陷阱**：pass@k 高但 pass^k 低 = 偶尔靠运气。p=50%→pass^3=12.5%；p=80%→51.2%；p=95%→85.7%。**投产硬阈值**：pass^3 < 50% 不建议进 CI；> 85% 生产级可靠。 |

#### 两轨指标的合成与使用边界

- **不强求合成总分**：两轨各自独立看；要总分用加权平均（不要相乘 — 任一环 < 1 就让总分崩塌）
- **质量轨**关心"产物对不对"，**性能轨**关心"过程贵不贵 / 慢不慢 / 稳不稳"，无替代关系
- **典型陷阱**：
  - 只看 pass@k 不看 pass^k → 投产随机翻车
  - 只看 token 消耗不看代码采纳率 → 便宜的代码可能全是垃圾
  - 只看冒烟通过率不看 bug 率 → 冒烟绿但漏报真实 bug
- **当前已采集**：代码采纳率 / review 通过效率 / 一次通过率（events.jsonl 已实现）；n_turns / n_toolcalls / n_total_tokens（trajectory parser 已实现，未做 scorer）
- **未实现**：技术设计还原率 / 冒烟通过率 / bug 率 / bug 归因 / 全部 Latency 指标 / pass@k / pass^k — 留给 Stage 2.3+ 落地

### 1.4 现状边界

L1 沉淀已厚，但仍有清晰边界：

| 问题                   | 现状                                                        |
| ---------------------- | ----------------------------------------------------------- |
| 跨业务复用难           | 每个业务一份 `.claude/` 散落维护，好 pattern 无法跨业务复用 |
| spec → 容器化 仍手工   | 沉淀堆在 `.claude/` 里，没有"何时该容器化"的自动信号        |
| 缺统一可视化           | metrics.md / events.jsonl 是结构化数据，但没 dashboard      |
| scorer 未实现          | 质量轨指标只是定义，未集成到 EvalLog                        |
| pass@k / pass^k 未实测 | 性能轨指标定义齐了，没在真实任务跑过                        |

**spec 到了一定厚度就该容器化**，agent 才能真正全自动 — 这就是 L2 的入口。

---

## 二、计划（L2 — Harness 飞轮）


### 2.1 阶段目标

**双循环飞轮**：

- **左轮**（外圈转一圈）：人 ↔ harness-cli ↔ harness 工程 — 人按需调整约束容器
- **右轮**（内圈转 N 圈）：Coding Agent 在容器内全自动跑 7 步业务工作流（需求 → 设计 → 技术方案 → Coding → 测试 → BugFix → 交付）
- **传动轴**：harness-cli 把人对约束的修改 sync 进容器；业务代码的 trajectory + eval 反馈回人

人退到**约束架构师**：不写业务代码、不在每个 checkpoint 把关，只调整 harness（rule / skill / agent / hook）。

### 2.2 harness-cli 路线图

`harness-cli` 是 L2 的**工具底座**，一段 bootstrap，把人对约束的修改实例化成具体配置。

#### 命令矩阵

| 命令                    | 作用                                                       | 状态             |
| ----------------------- | ---------------------------------------------------------- | ---------------- |
| `harness init <name>`   | 生成业务 harness 仓骨架 + 迁移现有 `~/.claude/`            | ✅ Stage 1.2     |
| `harness doctor`        | 环境预检（node / claude / codex / cursor / mcp CLI）       | ✅ Stage 1.0     |
| `harness sync`          | 按 `harness.yaml` 渲染 `.claude/` / `.codex/` / `.cursor/` | ✅ Stage 1.0+    |
| `harness diff`          | 干跑预览                                                   | ✅ Stage 1.0     |
| `harness eval ingest`   | trajectory jsonl → Inspect AI EvalLog                      | ✅ Stage 2.0-2.2 |
| `harness eval score`    | 漏斗指标 scorer                                            | 🚧 Stage 2.3+    |
| `harness eval funnel`   | 直接对仓库现状跑漏斗（不需 trajectory）                    | 🚧 Stage 2.3+    |
| `harness eval annotate` | LLM judge bug 归因                                         | 🚧 Stage 2.5+    |
| `harness lint`          | 自研架构 lint（mvvm-lint 风格）                            | 🚧 Stage 3       |
| `harness ref check`     | 验证 reference projects 路径与 commit                      | 🚧 Stage 3       |

#### 架构基线

- **canonical 单向生成**：`AGENTS.md` / `rules/*.md` / `mcp.yaml` 是 SSoT，`CLAUDE.md` / `.cursor/rules/*.mdc` 由 adapter 生成（带 `<!-- generated by harness; do not edit -->` 标头）
- **多工具适配**：claude-code（10 capabilities）/ codex（2）/ cursor（2），按 enabled 标志分别落盘
- **partial-ownership JSON merger**：与 sailor 已有 `settings.json` 共存，只接管声明的 top-level keys
- **schema add-only**：`schema_version=1` 冻结，capability 名永不删改，向后兼容

### 2.3 harness-studio

L2 的**消费层 / 可视化 IDE**。与 harness-cli 分工：cli = 数据底座 + 命令行；studio = 可视化编辑 + dashboard + 多业务对比。

| 功能                    | 用来干什么                                                        |
| ----------------------- | ----------------------------------------------------------------- |
| 可视化编辑 harness.yaml | 表单式编辑 agents / skills / rules / hooks / MCP，实时校验 schema |
| 实时 sync diff          | 编辑时即看会改动哪些 `.claude/` 文件                              |
| 漏斗 dashboard          | 按业务 / 模块 / 时间序展示 5 率 + bug 归因 + 8 性能指标           |
| 跨业务对比              | 多业务相同环节指标横向 pairwise                                   |
| trajectory 回放         | 选一条 jsonl 重跑 + diff，配 Inspect AI viewer                    |
| rule 影响热力图         | 看哪条 rule 触发率高 / 修改后哪些指标变化                         |

### 2.4 何时该从 L1 进 L2

| 类型         | 信号                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **量化阈值** | 单业务 ADR ≥ 5 / rules ≥ 8 / skills ≥ 3；≥ 3 个模块跑完 10 Phase；events.jsonl ≥ 50 条 review_end |
| **质性信号** | 同一 pattern 在 ≥ 2 个业务反复出现；团队需要共享 harness 配置（新人不必从零搭）                   |
| **触发动作** | `harness init` 生成业务 harness 仓 → 拆 canonical → 多工具 adapter 渲染 → 跑 baseline 漏斗        |

### 2.5 落地节奏

| Phase       | 内容                                                        | 大致时机                     |
| ----------- | ----------------------------------------------------------- | ---------------------------- |
| **Phase A** | 各业务各自抽出 harness 仓                                   | harness-cli Stage 2.3 完成后 |
| **Phase B** | 跨仓 base harness + override pattern（重复 rule 抽到 base） | Phase A 之后 3-6 个月        |
| **Phase C** | harness-studio 上线 dashboard（漏斗 + 趋势）                | Phase B 同期                 |
| **Phase D** | 漏斗指标实时采集（CI 触发 → 自动 ingest）                   | Phase C 之后                 |

---

## 三、未来（L3 — 自演化）

L3 阶段，**agent 不只是被动执行约束，更要主动识别约束不足并提议升级**。人的角色从"约束架构师"进一步退到"哲学制定者"：定方向、定边界、定红线，具体规则由 agent 提议、人审批。

### 3.1 阶段定位

```
人定哲学 / 边界 / 红线
       ↓
agent 跑 N 轮 → 自动归纳失败模式 → 提议新 rule / ADR
       ↓
人审批（pass / reject / 修改）
       ↓
harness 自动升级 + 跑 baseline 对比 + 漏斗指标对比 → 不达标自动回滚
       ↓
达标 promote 到 base 层 / 跨业务推广
```

L3 的核心是**自演化飞轮**：harness 不再靠人手动维护，而是自己长出来。

### 3.2 关键能力展望

| 能力              | 怎么做                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| 自动 rule 提取    | 从 trajectory 失败模式 / bug 归因 / reviewer Critical 反复出现的聚合中起草 rule 候选              |
| 跨 agent 知识迁移 | 业务 A 沉淀的 pattern 自动提给业务 B；跨仓共享 ADR / rule / skill 候选；冲突时自动标差异给人审    |
| 自演化飞轮        | rule 升级前后自动跑漏斗指标对比；pass^k 不达标自动回滚；达标 promote 到 base 层                   |
| 自我反思          | agent 自评 + 长期学习（哪些 skill 不灵 / 哪些 rule 经常被违反）；meta-agent 给同伴 calibrate 建议 |

### 3.3 风险与边界

| 风险                       | 应对                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| LLM judge calibration 漂移 | bug 归因 / rule 提议依赖 LLM 判断，需持续校准（5-10% 抽检）      |
| rule 爆炸                  | 配 rule 退役机制：长期未触发的自动归档                           |
| 跨业务 rule 冲突           | 不同技术栈规范天然冲突，需 namespace 隔离                        |
| 人类介入边界               | 至少 ADR 级架构 / lint 规则升级 / 跨业务推广 / 安全合规 必须人审 |

L3 不是替代人，是把人从重复性维护中释放出来，专注方向决策。

---

## 附录

### A. 图片清单


### B. 关键引用文档

- [PLAN.md](../history/plan.md) — harness-cli 总体规划：定位 / 架构 / 自举策略 / 多工具适配 / 迭代路线
- [stage2-eval-infrastructure.md](../history/stages/stage2-eval-infrastructure.md) — Stage 2.0 trajectory ingest 基础设施
- [stage2-cc-parser.md](../history/stages/stage2-cc-parser.md) — Stage 2.1 Claude Code parser
- [stage2-codex-parser.md](../history/stages/stage2-codex-parser.md) — Stage 2.2 Codex parser
- [eval-harness-best-practices.md](../research/eval-harness-best-practices.md) — eval 行业最佳实践调研
- [Anthropic - Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — 性能指标官方版
- `~/Workspace/sailor_fe_c_kmp/CLAUDE.md` + `.claude/skills/kmp-feature/SKILL.md` — L1 实证项目工作流

### C. 缩略语

- **L1** = Level 1，AI Coding 阶段 1（SDD 沉淀 Spec）
- **L2** = Level 2，AI Coding 阶段 2（Harness 飞轮）
- **L3** = Level 3，AI Coding 阶段 3（自演化）
- **SDD** = Spec Driven Development
- **SSoT** = Single Source of Truth
- **ADR** = Architecture Decision Record
- **RTM** = Requirements Traceability Matrix
- **CC** = Claude Code
- **machpro** = sailor 项目的旧版 OC 实现（KMP 重构对齐基准）

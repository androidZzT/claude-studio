# harness 生态五层关系（含人）— source

## 核心一句

人不再写业务代码，人写的是"agent 应该如何写业务代码"的规则。
人 → harness-cli → harness 工程 → CC/Codex → 业务代码 → 反馈回到人。

## 五层节点

1. **人 (Engineer / 约束架构师)**
   - 不写业务代码 · 写"agent 该如何写业务代码"的规则
   - 工作工具：harness-cli
   - 介入时机：T0 设定 / T6 反馈调整（低频）

2. **harness-cli (人的杠杆 · bootstrap)**
   - 命令：init / sync / diff / eval / adapters
   - 把人对约束的修改实例化成具体配置
   - 一次性运行，配置就位后即退场

3. **harness 工程 (约束容器 / SSoT)**
   - 业务级独立仓：commander-harness / sailor-harness / xhs-ops-harness
   - 声明：agents / skills / rules / hooks / MCP / plugins
   - 产出：.claude/ + .codex/ + .cursor/ 三套原生配置

4. **CC / Codex (受约束 agent)**
   - 工具集 / 角色 / 行为规则 / hook 触发点都被 Layer 2 预定义
   - 全自动迭代业务代码
   - trajectory 自动落 session jsonl

5. **业务工程代码 (产出)**
   - commander / sailor_fe_c_kmp / xhs-ops / cc-statistics 等真实交付物
   - agent 修改的目标对象

## 反馈循环（关键）

业务代码 → trajectory jsonl → harness eval ingest → EvalLog 分析 → 暴露偏差 → 回到「人」节点改约束 → harness-cli sync → 新一轮闭环

人介入只在 T0（设定）和 T6（反馈调整），中间 agent 全自动作业。

## 类比

工厂厂长（不进车间，制定规章）→ 装配线安装工 → 车间规章制度 → 工人 → 产品。
**人升级成厂长，agent 是工人**。

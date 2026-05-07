import {
  renderResourcesForPrompt,
  resolveWorkflowSources,
  resolveWorkflowTargets,
} from "../named-resources.js";
import { requireBusinessModule } from "./args.js";
import { relativeTo } from "./paths.js";
import type {
  ALL_PROMPT_AGENTS,
  KmModuleDesignArgs,
  WorkflowPaths,
} from "./types.js";

function promptCommon(args: KmModuleDesignArgs, paths: WorkflowPaths): string {
  const required = requireBusinessModule(args);
  const sources = resolveWorkflowSources(args);
  const targets = resolveWorkflowTargets(args);
  return `# harness km-module-design 工作流

你正在参与由 \`harness km-module-design\` 生成的模块 Spec Pack。

输入：
- business_id: \`${required.business}\`
- module_id: \`${required.module}\`
- harness repo: \`${paths.harnessRepo}\`
- spec-pack dir: \`${relativeTo(paths.harnessRepo, paths.specPackDir)}\`
- reviewed reference dir: \`${relativeTo(paths.harnessRepo, `${paths.specPackDir}/../references`)}\`
- sources:
${renderResourcesForPrompt(sources, "未提供")}
- targets:
${renderResourcesForPrompt(targets, "未提供")}
- run dir: \`${relativeTo(paths.harnessRepo, paths.runDir)}\`

通用规则：
- 不要修改 target 工程生产代码。
- 并行 contributor 阶段保持 \`manifest.status=draft\`。
- 只能写入自己声明的 write scope。
- 所有强结论都必须有 path-line evidence，或明确写出 blocker。
- 如果本模块存在 \`references/**/architect.md\`，先把它作为已评审参考设计读取并抽取设计决策；不要把原文复制成最终规格。
- spec-pack 中的 Markdown 文档必须使用中文正文；稳定 ID、字段名、API 名、文件路径、平台类型名和枚举值可以保留英文。
- YAML 文件中的业务语义字段也优先使用中文；schema 字段名、contract id、trace id 和 status 枚举保持原样。
- 如果被阻塞，把 blocker 写入 \`${relativeTo(paths.harnessRepo, paths.statusDir)}/<agent>.md\` 后停止。
`;
}

export function buildPrompt(
  agent: (typeof ALL_PROMPT_AGENTS)[number],
  args: KmModuleDesignArgs,
  paths: WorkflowPaths,
): string {
  const common = promptCommon(args, paths);

  if (agent === "architect") {
    return `${common}
# 贡献者：architect

使用 \`skills/molecule/km-module-design/SKILL.md\` 和
\`skills/molecule/km-module-design/references/technical-design-template.md\`.

写入范围：
- \`architecture_design.md\`
- \`state_contract.yaml\`
- \`data_contract.yaml\`
- \`ui_semantic_tree.yaml\`
- \`layout_contract.yaml\`
- \`navigation_contract.yaml\`
- \`platform_generation_rules.md\`

职责：
1. 读取 named sources evidence、可选的模块 reviewed reference design，以及所有 named targets 当前代码现状。
2. 完成 Reviewed Reference Design Gate、Source Evidence Gate、Reuse Discovery Gate、Architecture Kernel Gate。
3. 填写 Architecture Invariants、State Ownership Matrix、Mutation Authority Matrix、Stress Scenario Matrix、Plan Handoff Trace。
4. 将 T0-T8 和 C0-C12 写入 \`architecture_design.md\`，正文使用中文。
5. 让 \`manifest.yaml\` 保持 draft；并行阶段不要把 contributors 标成 done。

不要写入：
- \`machpro_inventory.md\`
- \`traceability.yaml\`
- \`functional_contract.md\`
- \`analytics_contract.yaml\`
- \`acceptance_tests.md\`
- \`manifest.status=ready-for-plan\`

状态输出：
- 在 run dir 下写 \`status/architect.md\`，包含 \`done\` 或 \`blocked\`、已修改文件和剩余整合事项，正文使用中文。
`;
  }

  if (agent === "machpro-parity") {
    return `${common}
# 贡献者：machpro-parity

使用 \`agents/machpro-parity.md\`、\`machpro-evidence-extract\` 和 \`evidence-chain-verify\`。当前 agent id 沿用 machpro-parity 以兼容历史 spec-pack，但职责是抽取 source 工程事实。

写入范围：
- \`machpro_inventory.md\`
- \`traceability.yaml\`
- \`functional_contract.md\`
- \`analytics_contract.yaml\`

职责：
1. 优先读取 \`id=machpro\` 的 source；如果没有该 source，则读取所有 named sources，并抽取 route/page/component/store/service/API/style/asset/i18n/storage/analytics/permission/loading/empty/error 事实。
2. 每条事实都必须给出 path-line evidence。
3. 将可观察 source 元素映射到 \`NAV-* / ACT-* / STATE-* / UI-* / API-* / MODEL-* / RULE-* / TRACK-* / STORAGE-* / ERROR-* / TEST-*\`。
4. status 枚举只能使用 \`covered / intentionally_removed / deferred / unknown\`。
5. 不要猜；证据不足时保留 \`unknown\`。
6. \`machpro_inventory.md\` 和 \`functional_contract.md\` 的标题、说明、表格列名和行为描述都使用中文。

不要写入：
- \`architecture_design.md\`
- state/data/ui/layout/navigation/platform rules
- \`acceptance_tests.md\`
- \`manifest.status=ready-for-plan\`

状态输出：
- 在 run dir 下写 \`status/machpro-parity.md\`，包含 \`done\`、\`skipped\` 或 \`blocked\`、证据摘要和未解决 unknown，正文使用中文。
`;
  }

  if (agent === "tester") {
    return `${common}
# 贡献者：tester

使用 \`agents/tester.md\`、\`skills/molecule/km-maestro-case/SKILL.md\` contributor mode 和 \`test-matrix-build\`。

写入范围：
- \`acceptance_tests.md\`

职责：
1. 设计 P0/P1/P2 验收用例，使用“前置条件 / 操作 / 期望”的中文结构。
2. P0 是稳定冒烟覆盖。
3. P1 覆盖主流程和跨模块同步。
4. P2 覆盖 empty、API failure、rapid repeat、out-of-order response、platform lifecycle 和健壮性。
5. 每条 case 必须包含 acceptance id、priority、covered specs、可用的 trace ids、可用的 contract ids、可用的 stress ids 和 evidence。
6. \`acceptance_tests.md\` 的标题、说明、前置条件、操作、期望和断言描述都使用中文；字段名、case id 和 contract id 保持原样。

不要写入：
- 本 contributor 阶段不要写 target 工程测试或生产代码。
- 不要写 \`architecture_design.md\` 的 owner 决策。
- \`manifest.status=ready-for-plan\`

状态输出：
- 在 run dir 下写 \`status/tester.md\`，包含 \`done\` 或 \`blocked\`、case 列表和覆盖缺口，正文使用中文。
`;
  }

  return `${common}
# 顺序整合者：architect

只能在 architect、machpro-parity 和 tester 三个 contributor prompt 完成后运行。

写入范围：
- spec-pack 下任何需要整合修正的文件。
- 只有校验通过时，才写入 \`manifest.yaml\` 的最终 contributor status 和 \`status=ready-for-plan\`。

职责：
1. 读取 run dir 下所有 \`status/*.md\`。
2. 整合 traceability acceptance ids、C8/C12、Plan Handoff Trace 和 contributor 状态。
3. 解决或显式标记每个 \`unknown\`；如果仍有未解决 unknown，保持 \`manifest.status=draft\`。
4. 检查所有 spec-pack Markdown 文档正文为中文；英文只允许出现在 ID、路径、API 名、字段名、平台类型名和枚举值中。
5. 运行 \`python3 scripts/validate-machpro-spec-pack.py <spec-pack-dir>\`。
6. 如果校验通过，设置 \`manifest.status=ready-for-plan\`；否则保持 \`draft\` 并报告 blockers。

状态输出：
- 在 run dir 下写 \`status/architect-integrator.md\`，包含最终结果和校验命令输出，正文使用中文。
`;
}

import { requireBusinessPage } from "./args.js";
import { relativeTo } from "./paths.js";
import type { KmPageAnalysisArgs, PageAnalysisPaths } from "./types.js";

export function buildPrompt(
  args: KmPageAnalysisArgs,
  paths: PageAnalysisPaths,
): string {
  const required = requireBusinessPage(args);
  const knownModules =
    args.knownModules.length > 0
      ? args.knownModules.map((module) => `- ${module}`).join("\n")
      : "- 未提供；请从 machpro 证据和已有 spec-package 中识别。";

  return `# harness km-page-analysis 工作流

你正在参与由 \`harness km-page-analysis\` 生成的整页模块依赖分析。

输入：
- business_id: \`${required.business}\`
- page_id: \`${required.page}\`
- harness repo: \`${paths.harnessRepo}\`
- output dir: \`${relativeTo(paths.harnessRepo, paths.outputDir)}\`
- machpro repo: \`${args.machproRepo ?? "未提供"}\`
- machpro path: \`${args.machproPath ?? "未提供"}\`
- Android repo: \`${args.androidRepo ?? "未提供"}\`
- iOS repo: \`${args.iosRepo ?? "未提供"}\`
- run dir: \`${relativeTo(paths.harnessRepo, paths.runDir)}\`

已知模块：
${knownModules}

使用：
- \`skills/molecule/km-page-analysis/SKILL.md\`
- \`skills/molecule/km-page-analysis/references/page-analysis-template.md\`
- 必要时读取 \`skills/molecule/km-module-design/SKILL.md\`，但不要生成模块级 spec-pack。

Agent 角色：
- 本步骤由 architect 负责。你可以读取 machpro、Android、iOS 和现有 spec-package 作为证据，但不要修改 Android/iOS 生产代码。

写入范围：
- \`${relativeTo(paths.harnessRepo, paths.pageAnalysisPath)}\`
- \`${relativeTo(paths.harnessRepo, paths.dependencyPath)}\`
- 可选：\`spec-package/${required.business}/<module>/references/page-analysis.md\`，只写该模块相关摘录。
- \`${relativeTo(paths.harnessRepo, paths.statusDir)}/architect.md\`

硬约束：
1. 输出正文使用中文；ID、路径、API 名、类名和字段名可保留英文。
2. 每个模块必须有 source evidence、owner candidate、layer 和目标 spec-package 路径。
3. 每条 blocking dependency 必须有 kind、reason 和 owner_contract_hint。
4. batches 必须自底向上且拓扑无环；后续批次不得依赖未来批次产物。
5. 至少输出一个底层批次和一个页面整合批次；如果页面实质只有单模块，明确写出应改用 \`km-module-design\`。
6. 不要生成 \`spec-pack/\`，不要写 Android/iOS 代码。

状态输出：
- 完成后写 \`${relativeTo(paths.harnessRepo, paths.statusDir)}/architect.md\`。
- 如果被阻塞，写清 blocker、缺失证据和人工确认项，并停止。
`;
}

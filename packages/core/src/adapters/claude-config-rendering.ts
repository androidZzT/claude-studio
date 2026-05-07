import type { HarnessConfig, ModelProfile } from "../harness-config.js";

const DISPATCH_TABLE_START = "<!-- HARNESS_DISPATCH_TABLE:START -->";
const DISPATCH_TABLE_END = "<!-- HARNESS_DISPATCH_TABLE:END -->";

function ensureTrailingNewline(source: string): string {
  return source.endsWith("\n") ? source : `${source}\n`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderCrossPlatformPolicy(policy: NonNullable<HarnessConfig["dispatch"]>["cross_platform_policy"]): string {
  if (policy === "split_serial") {
    return "跨平台改动 → 拆分串行";
  }

  if (policy === "split_isolated_parallel") {
    return "跨平台改动 → 先 architect 写 C0-C12 双端统一契约 + contract_id todo，再 Android/iOS 拆分隔离并行";
  }

  return "跨平台改动 → 按 agent-role 原则处理";
}

function renderCrossPlatformPolicyLabel(policy: NonNullable<HarnessConfig["dispatch"]>["cross_platform_policy"]): string {
  if (policy === "split_isolated_parallel") {
    return "拆分隔离并行";
  }

  return "拆分串行";
}

export function renderDispatchTableMarkdown(config: HarnessConfig): string | undefined {
  if (!config.dispatch) {
    return undefined;
  }

  const lines = ["| 改动路径 | agent | 说明 |", "|---|---|---|"];

  for (const pattern of config.dispatch.patterns) {
    lines.push(
      `| \`${escapeMarkdownTableCell(pattern.match)}\` | \`${escapeMarkdownTableCell(pattern.agent)}\` | ${escapeMarkdownTableCell(pattern.note ?? "—")} |`
    );
  }

  lines.push(
    `| 跨平台改动 | **${renderCrossPlatformPolicyLabel(config.dispatch.cross_platform_policy)}** | ${renderCrossPlatformPolicy(config.dispatch.cross_platform_policy)} |`,
    "| 纯 markdown / rules / memory | team-lead 直改 | 兜底 |"
  );

  return lines.join("\n");
}

export function renderDispatchTableIntoMarkdown(source: string, config: HarnessConfig): string {
  const table = renderDispatchTableMarkdown(config);

  if (!table || !source.includes(DISPATCH_TABLE_START) || !source.includes(DISPATCH_TABLE_END)) {
    return source;
  }

  const pattern = new RegExp(`${DISPATCH_TABLE_START}[\\s\\S]*?${DISPATCH_TABLE_END}`);
  return ensureTrailingNewline(source.replace(pattern, `${DISPATCH_TABLE_START}\n${table}\n${DISPATCH_TABLE_END}`));
}

function getProfileModel(profile: ModelProfile | undefined): string | undefined {
  if (typeof profile === "string") {
    return profile;
  }

  return profile?.model;
}

function resolveConfiguredModel(config: HarnessConfig, agentName: string): string | undefined {
  const claudeModels = config.models?.["claude-code"];
  return getProfileModel(claudeModels?.agents[agentName]) ?? getProfileModel(claudeModels?.default);
}

function replaceModelLine(line: string, model: string): string {
  const match = line.match(/^(\s*model\s*:\s*)(.*?)(\s+#.*)?$/);

  if (!match) {
    return line;
  }

  const [, prefix, , comment = ""] = match;
  return `${prefix}${model}${comment}`;
}

function insertModelLine(frontmatterLines: string[], model: string): string[] {
  let insertionAnchor = -1;

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    if (/^\s*(name|description)\s*:/.test(frontmatterLines[index]!)) {
      insertionAnchor = index;
    }
  }

  const insertionIndex = insertionAnchor >= 0 ? insertionAnchor + 1 : Math.max(1, frontmatterLines.length - 1);

  return [...frontmatterLines.slice(0, insertionIndex), `model: ${model}`, ...frontmatterLines.slice(insertionIndex)];
}

export function injectAgentModelFrontmatter(source: string, agentName: string, config: HarnessConfig): string {
  const model = resolveConfiguredModel(config, agentName);

  if (!model) {
    return source;
  }

  const frontmatterMatch = source.match(/^(---\r?\n[\s\S]*?\r?\n---)([\s\S]*)$/);

  if (!frontmatterMatch) {
    return ensureTrailingNewline(`---\nmodel: ${model}\n---\n${source}`);
  }

  const frontmatter = frontmatterMatch[1]!;
  const tail = frontmatterMatch[2] ?? "";
  const frontmatterLines = frontmatter.split(/\r?\n/);
  const modelLineIndex = frontmatterLines.findIndex((line) => /^\s*model\s*:/.test(line));
  const nextFrontmatterLines =
    modelLineIndex >= 0
      ? frontmatterLines.map((line, index) => (index === modelLineIndex ? replaceModelLine(line, model) : line))
      : insertModelLine(frontmatterLines, model);

  return ensureTrailingNewline(`${nextFrontmatterLines.join("\n")}${tail}`);
}

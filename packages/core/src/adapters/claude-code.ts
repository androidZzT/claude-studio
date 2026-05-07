import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  CLAUDE_MD_OUTPUT_PATH,
  CLAUDE_REFERENCE_PROJECTS_OUTPUT_PATH,
  DEFAULT_CLAUDE_AGENTS_SOURCE_PATH,
  DEFAULT_CLAUDE_COMMANDS_SOURCE_PATH,
  DEFAULT_CLAUDE_DOCS_SOURCE_PATH,
  DEFAULT_CLAUDE_METRICS_SOURCE_PATH,
  DEFAULT_CLAUDE_REFERENCE_PROJECTS_SOURCE_PATH,
  DEFAULT_CLAUDE_RULES_SOURCE_PATH,
  DEFAULT_CLAUDE_SCRIPTS_SOURCE_PATH,
  DEFAULT_CLAUDE_SKILLS_SOURCE_PATH,
  DEFAULT_CODEX_TARGET
} from "../constants.js";
import { isAgentRoutedToTool } from "../agent-routing.js";
import type { ClaudeCodeCapability, HarnessConfig } from "../harness-config.js";
import { hasNoActiveContextDenyRead, isNoActiveContextDenyReadPath } from "../context-visibility.js";
import { renderReferenceProjectsDocument } from "../reference-projects.js";
import type { PlannedFile } from "../sync-types.js";

import { ADAPTER_FEATURES } from "./capabilities.js";
import { injectAgentModelFrontmatter, renderDispatchTableIntoMarkdown } from "./claude-config-rendering.js";
import { mirrorClaudeDirectoryTree } from "./claude-mirror.js";
import { buildClaudeSettingsPlan } from "./claude-settings.js";
import { planClaudeScriptsDirectory } from "./claude-scripts.js";
import { planClaudeSkillsDirectory } from "./claude-skills.js";
import { buildGeneratedInstructions, buildGeneratedMarkdown, createPlannedFile, readTemplate, toPortablePath } from "./shared.js";
import type { Adapter, AdapterPlanOptions } from "./types.js";

type ClaudeSubdirKind = "agents" | "commands" | "rules";

const METRICS_RUNTIME_FILE_PATTERN = /^events\.jsonl(\..+)?$/;

interface PlanMarkdownDirectoryOptions extends AdapterPlanOptions {
  readonly injectGeneratedMarkdown?: boolean;
}

async function collectNestedMarkdownWarnings(
  directoryPath: string,
  rootDir: string,
  onWarning?: (message: string) => void
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await collectNestedMarkdownWarnings(absolutePath, rootDir, onWarning);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      onWarning?.(`Warning: claude-code adapter ignoring nested file: ${toPortablePath(path.relative(rootDir, absolutePath))}`);
    }
  }
}

async function planClaudeDirectory(
  config: HarnessConfig,
  rootDir: string,
  targetRoot: string,
  sourcePath: string,
  targetSubdir: ClaudeSubdirKind,
  options?: PlanMarkdownDirectoryOptions
): Promise<PlannedFile[]> {
  const absoluteSourcePath = path.resolve(rootDir, sourcePath);
  let entries: Dirent[];

  try {
    entries = await readdir(absoluteSourcePath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const plannedFiles: PlannedFile[] = [];

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(absoluteSourcePath, entry.name);

    if (entry.isDirectory()) {
      await collectNestedMarkdownWarnings(absolutePath, rootDir, options?.onWarning);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const agentName = path.basename(entry.name, ".md");

    if (targetSubdir === "agents" && !isAgentRoutedToTool(config, agentName, "claude-code")) {
      continue;
    }

    const [source, sourceStat] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);
    const relativeSourcePath = toPortablePath(path.relative(rootDir, absolutePath));
    const transformedSource =
      targetSubdir === "agents"
        ? injectAgentModelFrontmatter(source, agentName, config)
        : targetSubdir === "rules"
          ? renderDispatchTableIntoMarkdown(source, config)
          : source;
    plannedFiles.push(
      createPlannedFile(
        rootDir,
        targetRoot,
        `.claude/${targetSubdir}/${entry.name}`,
        options?.injectGeneratedMarkdown === false ? transformedSource : buildGeneratedMarkdown(transformedSource, relativeSourcePath),
        sourceStat.mode & 0o777
      )
    );
  }

  return plannedFiles;
}

async function planClaudeReferenceProjectsPassthrough(
  rootDir: string,
  targetRoot: string,
  sourcePath: string
): Promise<PlannedFile[]> {
  const absoluteSourcePath = path.resolve(rootDir, sourcePath);

  try {
    const [sourceBytes, sourceStat] = await Promise.all([readFile(absoluteSourcePath), stat(absoluteSourcePath)]);
    return [createPlannedFile(rootDir, targetRoot, CLAUDE_REFERENCE_PROJECTS_OUTPUT_PATH, sourceBytes, sourceStat.mode & 0o777)];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function sourceExists(rootDir: string, sourcePath: string): Promise<boolean> {
  try {
    await stat(path.resolve(rootDir, sourcePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function planClaudeReferenceProjects(
  config: HarnessConfig,
  rootDir: string,
  targetRoot: string,
  sourcePath: string,
  options?: AdapterPlanOptions
): Promise<PlannedFile[]> {
  const renderedReferenceProjects = renderReferenceProjectsDocument(config);
  const projectReferencesDeclared = Object.keys(config.projects?.references ?? {}).length > 0;
  const rawSourceExists = await sourceExists(rootDir, sourcePath);

  if (renderedReferenceProjects) {
    if (projectReferencesDeclared && rawSourceExists) {
      options?.onWarning?.(
        "Warning: adapters.claude-code.reference_projects_source is deprecated when projects.references is declared; using harness.yaml projects.references."
      );
    }

    return [createPlannedFile(rootDir, targetRoot, CLAUDE_REFERENCE_PROJECTS_OUTPUT_PATH, renderedReferenceProjects)];
  }

  return rawSourceExists ? planClaudeReferenceProjectsPassthrough(rootDir, targetRoot, sourcePath) : [];
}

function getConfiguredCapabilities(config: HarnessConfig): ReadonlySet<ClaudeCodeCapability> | undefined {
  const configuredCapabilities = config.adapters["claude-code"]?.capabilities;
  if (!configuredCapabilities) {
    return undefined;
  }

  return new Set(configuredCapabilities);
}

async function warnOnIgnoredClaudeSources(
  config: HarnessConfig,
  rootDir: string,
  configuredCapabilities: ReadonlySet<ClaudeCodeCapability>,
  options?: AdapterPlanOptions
): Promise<void> {
  const claudeConfig = config.adapters["claude-code"];

  if (!claudeConfig) {
    return;
  }

  const checks: readonly {
    readonly capability: ClaudeCodeCapability;
    readonly field: keyof NonNullable<HarnessConfig["adapters"]["claude-code"]>;
    readonly sourcePath: string | undefined;
  }[] = [
    { capability: "agents", field: "agents_source", sourcePath: claudeConfig.agents_source },
    { capability: "commands", field: "commands_source", sourcePath: claudeConfig.commands_source },
    { capability: "docs", field: "docs_source", sourcePath: claudeConfig.docs_source },
    { capability: "metrics", field: "metrics_source", sourcePath: claudeConfig.metrics_source },
    { capability: "reference_projects", field: "reference_projects_source", sourcePath: claudeConfig.reference_projects_source },
    { capability: "rules", field: "rules_source", sourcePath: claudeConfig.rules_source },
    { capability: "scripts", field: "scripts_source", sourcePath: claudeConfig.scripts_source },
    { capability: "skills", field: "skills_source", sourcePath: claudeConfig.skills_source }
  ];

  await Promise.all(
    checks.map(async (check) => {
      if (configuredCapabilities.has(check.capability) || !check.sourcePath || !(await sourceExists(rootDir, check.sourcePath))) {
        return;
      }

      options?.onWarning?.(
        `Warning: adapters.claude-code.${String(check.field)} is set but ${check.capability} capability is not enabled; field will be ignored.`
      );
    })
  );
}

async function planClaudeCapabilityOutputs(
  config: HarnessConfig,
  cwd: string,
  targetRoot: string,
  configuredCapabilities: ReadonlySet<ClaudeCodeCapability>,
  options?: AdapterPlanOptions
): Promise<PlannedFile[]> {
  const plannedFiles: PlannedFile[] = [];

  const agentsSource = config.adapters["claude-code"]?.agents_source ?? DEFAULT_CLAUDE_AGENTS_SOURCE_PATH;
  const commandsSource = config.adapters["claude-code"]?.commands_source ?? DEFAULT_CLAUDE_COMMANDS_SOURCE_PATH;
  const docsSource = config.adapters["claude-code"]?.docs_source ?? DEFAULT_CLAUDE_DOCS_SOURCE_PATH;
  const metricsSource = config.adapters["claude-code"]?.metrics_source ?? DEFAULT_CLAUDE_METRICS_SOURCE_PATH;
  const referenceProjectsSource =
    config.adapters["claude-code"]?.reference_projects_source ?? DEFAULT_CLAUDE_REFERENCE_PROJECTS_SOURCE_PATH;
  const rulesSource = config.adapters["claude-code"]?.rules_source ?? DEFAULT_CLAUDE_RULES_SOURCE_PATH;
  const scriptsSource = config.adapters["claude-code"]?.scripts_source ?? DEFAULT_CLAUDE_SCRIPTS_SOURCE_PATH;
  const skillsSource = config.adapters["claude-code"]?.skills_source ?? DEFAULT_CLAUDE_SKILLS_SOURCE_PATH;
  const shouldIncludeActiveSourcePath = (relativeSourcePath: string) => !isNoActiveContextDenyReadPath(config, relativeSourcePath);

  await warnOnIgnoredClaudeSources(config, cwd, configuredCapabilities, options);

  if (configuredCapabilities.has("claude_md")) {
    const instructionsTemplate = await readTemplate(cwd, config.canonical.instructions, "claude-code");
    plannedFiles.push(createPlannedFile(cwd, targetRoot, CLAUDE_MD_OUTPUT_PATH, buildGeneratedInstructions(instructionsTemplate)));
  }

  if (configuredCapabilities.has("agents")) {
    plannedFiles.push(
      ...(await planClaudeDirectory(config, cwd, targetRoot, agentsSource, "agents", {
        ...options,
        injectGeneratedMarkdown: false
      }))
    );
  }

  if (configuredCapabilities.has("commands")) {
    plannedFiles.push(
      ...(await planClaudeDirectory(config, cwd, targetRoot, commandsSource, "commands", {
        ...options,
        injectGeneratedMarkdown: false
      }))
    );
  }

  if (configuredCapabilities.has("rules")) {
    plannedFiles.push(
      ...(await planClaudeDirectory(config, cwd, targetRoot, rulesSource, "rules", {
        ...options,
        injectGeneratedMarkdown: false
      }))
    );
  }

  if (configuredCapabilities.has("scripts")) {
    const absoluteScriptsSource = path.resolve(cwd, scriptsSource);
    try {
      plannedFiles.push(
        ...(await mirrorClaudeDirectoryTree(cwd, targetRoot, absoluteScriptsSource, absoluteScriptsSource, {
          injectMarkdownMarkers: false,
          outputRoot: ".claude/scripts",
          ...(options?.onWarning ? { onWarning: options.onWarning } : {}),
          shouldIncludeSourcePath: shouldIncludeActiveSourcePath,
          warningLabel: "script"
        }))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (configuredCapabilities.has("skills")) {
    const absoluteSkillsSource = path.resolve(cwd, skillsSource);
    try {
      plannedFiles.push(
        ...(await mirrorClaudeDirectoryTree(cwd, targetRoot, absoluteSkillsSource, absoluteSkillsSource, {
          injectMarkdownMarkers: false,
          maxDepthWarning: 6,
          outputRoot: ".claude/skills",
          ...(options?.onWarning ? { onWarning: options.onWarning } : {}),
          shouldIncludeSourcePath: shouldIncludeActiveSourcePath,
          warningLabel: "skill"
        }))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (configuredCapabilities.has("docs")) {
    const absoluteDocsSource = path.resolve(cwd, docsSource);
    try {
      plannedFiles.push(
        ...(await mirrorClaudeDirectoryTree(cwd, targetRoot, absoluteDocsSource, absoluteDocsSource, {
          injectMarkdownMarkers: false,
          outputRoot: ".claude/docs",
          ...(options?.onWarning ? { onWarning: options.onWarning } : {}),
          shouldIncludeSourcePath: shouldIncludeActiveSourcePath,
          warningLabel: "docs"
        }))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (configuredCapabilities.has("metrics")) {
    const absoluteMetricsSource = path.resolve(cwd, metricsSource);
    try {
      plannedFiles.push(
        ...(await mirrorClaudeDirectoryTree(cwd, targetRoot, absoluteMetricsSource, absoluteMetricsSource, {
          injectMarkdownMarkers: false,
          outputRoot: ".claude/metrics",
          ...(options?.onWarning ? { onWarning: options.onWarning } : {}),
          shouldIncludeSourcePath: shouldIncludeActiveSourcePath,
          shouldIncludeFile(relativePathFromSourceRoot) {
            return !METRICS_RUNTIME_FILE_PATTERN.test(path.posix.basename(relativePathFromSourceRoot));
          },
          warningLabel: "metrics"
        }))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (configuredCapabilities.has("reference_projects")) {
    plannedFiles.push(...(await planClaudeReferenceProjects(config, cwd, targetRoot, referenceProjectsSource, options)));
  }

  if (
    configuredCapabilities.has("hooks") ||
    configuredCapabilities.has("mcp") ||
    configuredCapabilities.has("plugins") ||
    hasNoActiveContextDenyRead(config)
  ) {
    const settingsPlan = buildClaudeSettingsPlan(
      config,
      cwd,
      targetRoot,
      {
        ...(options?.onWarning ? { onWarning: options.onWarning } : {}),
        preserveNonMatcherMatchers: true
      }
    );

    if (settingsPlan) {
      plannedFiles.push(settingsPlan);
    }
  }

  return plannedFiles;
}

export function createClaudeCodeAdapter(): Adapter {
  return {
    id: "claude-code",
    async plan(config: HarnessConfig, cwd: string, options?: AdapterPlanOptions): Promise<PlannedFile[]> {
      const targetRoot = path.resolve(cwd, config.adapters["claude-code"]?.target ?? DEFAULT_CODEX_TARGET);
      const configuredCapabilities = getConfiguredCapabilities(config);

      if (configuredCapabilities) {
        return planClaudeCapabilityOutputs(config, cwd, targetRoot, configuredCapabilities, options);
      }

      const instructionsTemplate = await readTemplate(cwd, config.canonical.instructions, "claude-code");
      const agentsSource = config.adapters["claude-code"]?.agents_source ?? DEFAULT_CLAUDE_AGENTS_SOURCE_PATH;
      const commandsSource = config.adapters["claude-code"]?.commands_source ?? DEFAULT_CLAUDE_COMMANDS_SOURCE_PATH;
      const rulesSource = config.adapters["claude-code"]?.rules_source ?? DEFAULT_CLAUDE_RULES_SOURCE_PATH;
      const scriptsSource = config.adapters["claude-code"]?.scripts_source ?? DEFAULT_CLAUDE_SCRIPTS_SOURCE_PATH;
      const skillsSource = config.adapters["claude-code"]?.skills_source ?? DEFAULT_CLAUDE_SKILLS_SOURCE_PATH;
      const referenceProjectsSource =
        config.adapters["claude-code"]?.reference_projects_source ?? DEFAULT_CLAUDE_REFERENCE_PROJECTS_SOURCE_PATH;
      const plannedReferenceProjects = await planClaudeReferenceProjects(config, cwd, targetRoot, referenceProjectsSource, options);
      const settingsPlan = buildClaudeSettingsPlan(
        config,
        cwd,
        targetRoot,
        options?.onWarning ? { onWarning: options.onWarning } : undefined
      );

      const [plannedAgents, plannedCommands, plannedRules, plannedScripts, plannedSkills] = await Promise.all([
        planClaudeDirectory(config, cwd, targetRoot, agentsSource, "agents", options),
        planClaudeDirectory(config, cwd, targetRoot, commandsSource, "commands", options),
        planClaudeDirectory(config, cwd, targetRoot, rulesSource, "rules", options),
        planClaudeScriptsDirectory(cwd, targetRoot, scriptsSource, options),
        planClaudeSkillsDirectory(cwd, targetRoot, skillsSource, options)
      ]);

      return [
        createPlannedFile(cwd, targetRoot, CLAUDE_MD_OUTPUT_PATH, buildGeneratedInstructions(instructionsTemplate)),
        ...plannedAgents,
        ...plannedCommands,
        ...plannedRules,
        ...plannedScripts,
        ...plannedSkills,
        ...plannedReferenceProjects,
        ...(settingsPlan ? [settingsPlan] : [])
      ];
    },
    capabilities() {
      return {
        features: [
          ADAPTER_FEATURES.CLAUDE_AGENTS_MD,
          ADAPTER_FEATURES.CLAUDE_COMMANDS_MD,
          ADAPTER_FEATURES.CLAUDE_DOCS,
          ADAPTER_FEATURES.CLAUDE_HOOKS,
          ADAPTER_FEATURES.CLAUDE_MCP,
          ADAPTER_FEATURES.CLAUDE_MD,
          ADAPTER_FEATURES.CLAUDE_METRICS,
          ADAPTER_FEATURES.CLAUDE_PLUGINS,
          ADAPTER_FEATURES.CLAUDE_REFERENCE_PROJECTS,
          ADAPTER_FEATURES.CLAUDE_RULES_MD,
          ADAPTER_FEATURES.CLAUDE_SCRIPTS,
          ADAPTER_FEATURES.CLAUDE_SKILLS
        ]
      };
    }
  };
}

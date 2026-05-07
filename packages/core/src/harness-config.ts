import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import {
  DEFAULT_CLAUDE_AGENTS_SOURCE_PATH,
  DEFAULT_CLAUDE_COMMANDS_SOURCE_PATH,
  DEFAULT_CLAUDE_DOCS_SOURCE_PATH,
  DEFAULT_CLAUDE_METRICS_SOURCE_PATH,
  DEFAULT_CLAUDE_REFERENCE_PROJECTS_SOURCE_PATH,
  DEFAULT_CLAUDE_RULES_SOURCE_PATH,
  DEFAULT_CLAUDE_SCRIPTS_SOURCE_PATH,
  DEFAULT_CLAUDE_SKILLS_SOURCE_PATH,
  DEFAULT_CODEX_TARGET,
  DEFAULT_CONFIG_FILE,
  DEFAULT_INSTRUCTIONS_TEMPLATE_PATH
} from "./constants.js";
import { mcpConfigSchema } from "./mcp.js";
import { pluginsConfigSchema } from "./plugins.js";
import { referenceProjectsConfigSchema } from "./reference-projects.js";

export const TOOL_NAMES = ["claude-code", "codex", "cursor", "aider", "gemini-cli"] as const;
export const LOCAL_CONFIG_FILE = "harness.local.yaml";
export const CONTEXT_VISIBILITY_MODES = ["soft_ignore", "deny_read"] as const;

export const toolNameSchema = z.enum(TOOL_NAMES);
export const contextVisibilityModeSchema = z.enum(CONTEXT_VISIBILITY_MODES);
export const CLAUDE_CODE_CAPABILITIES = [
  "claude_md",
  "agents",
  "commands",
  "docs",
  "hooks",
  "mcp",
  "plugins",
  "reference_projects",
  "rules",
  "scripts",
  "skills",
  "metrics"
] as const;
export const claudeCodeCapabilitySchema = z.enum(CLAUDE_CODE_CAPABILITIES);

const commandRequirementSchema = z
  .object({
    cmd: z.string().trim().min(1),
    min: z.string().trim().min(1).optional(),
    install: z.string().trim().min(1).optional()
  })
  .strict();

const scriptRequirementSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    script: z.string().trim().min(1),
    install: z.string().trim().min(1).optional()
  })
  .strict();

export const HOOK_NAMES = ["pre-commit"] as const;
export const HOOK_SHELLS = ["bash"] as const;
export const CLAUDE_LIFECYCLE_HOOK_NAMES = [
  "Elicitation",
  "Notification",
  "PermissionRequest",
  "PostCompact",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PreToolUse",
  "SessionEnd",
  "SessionStart",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TaskCompleted",
  "UserPromptSubmit",
  "WorktreeCreate"
] as const;
export const CLAUDE_MATCHER_HOOK_NAMES = [
  "PostToolUse",
  "PostToolUseFailure",
  "PreToolUse",
  "SubagentStart",
  "SubagentStop",
  "UserPromptSubmit"
] as const;
export const CLAUDE_NON_MATCHER_HOOK_NAMES = [
  "Elicitation",
  "Notification",
  "PermissionRequest",
  "PostCompact",
  "PreCompact",
  "SessionEnd",
  "SessionStart",
  "Stop",
  "StopFailure",
  "TaskCompleted",
  "WorktreeCreate"
] as const;

export const hookNameSchema = z.enum(HOOK_NAMES);
export const hookShellSchema = z.enum(HOOK_SHELLS);
export const claudeLifecycleHookNameSchema = z.enum(CLAUDE_LIFECYCLE_HOOK_NAMES);

const hookDefinitionSchema = z
  .object({
    enabled: z.boolean().default(true),
    run: z.string().min(1).refine((value) => value.trim().length > 0, {
      message: "Hook run script must not be empty."
    }),
    shell: hookShellSchema.default("bash")
  })
  .strict();

const lifecycleHookDefinitionSchema = z
  .object({
    enabled: z.boolean().default(true),
    matcher: z.string().optional(),
    run: z.string().min(1).refine((value) => value.trim().length > 0, {
      message: "Lifecycle hook run script must not be empty."
    }),
    timeout: z.number().int().positive().optional(),
    statusMessage: z.string().min(1).refine((value) => value.trim().length > 0, {
      message: "Lifecycle hook statusMessage must not be empty."
    }).optional()
  })
  .strict();

const lifecycleHooksSchemaShape = Object.fromEntries(
  CLAUDE_LIFECYCLE_HOOK_NAMES.map((hookName) => [hookName, z.array(lifecycleHookDefinitionSchema).optional()])
) as Record<ClaudeLifecycleHookName, z.ZodOptional<z.ZodArray<typeof lifecycleHookDefinitionSchema>>>;

const adapterSchema = z
  .object({
    enabled: z.boolean().default(true),
    target: z.string().trim().min(1).optional(),
    features: z.array(z.string().trim().min(1)).default([])
  })
  .strict();

const codexAdapterSchema = adapterSchema.extend({
  target: z.string().trim().min(1).default(DEFAULT_CODEX_TARGET)
});

const claudeCodeAdapterSchema = adapterSchema.extend({
  capabilities: z.array(claudeCodeCapabilitySchema).optional(),
  target: z.string().trim().min(1).default(DEFAULT_CODEX_TARGET),
  agents_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_AGENTS_SOURCE_PATH),
  commands_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_COMMANDS_SOURCE_PATH),
  docs_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_DOCS_SOURCE_PATH),
  metrics_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_METRICS_SOURCE_PATH),
  reference_projects_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_REFERENCE_PROJECTS_SOURCE_PATH),
  rules_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_RULES_SOURCE_PATH),
  scripts_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_SCRIPTS_SOURCE_PATH),
  skills_source: z.string().trim().min(1).default(DEFAULT_CLAUDE_SKILLS_SOURCE_PATH)
});

const cursorAdapterSchema = adapterSchema.extend({
  target: z.string().trim().min(1).default(DEFAULT_CODEX_TARGET)
});

const canonicalSchema = z
  .object({
    instructions: z.string().trim().min(1).default(DEFAULT_INSTRUCTIONS_TEMPLATE_PATH),
    codexConfig: z.string().trim().min(1).optional()
  })
  .strict()
  .default({
    instructions: DEFAULT_INSTRUCTIONS_TEMPLATE_PATH
  });

const modelProfileSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      model: z.string().trim().min(1).optional(),
      effort: z.string().trim().min(1).optional(),
      sandbox_mode: z.string().trim().min(1).optional(),
      approval_policy: z.string().trim().min(1).optional()
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, "Model profile objects must declare at least one field.")
]);

const toolModelsSchema = z
  .object({
    default: modelProfileSchema.optional(),
    agents: z.record(z.string().trim().min(1), modelProfileSchema).default({})
  })
  .strict();

const modelsSchema = z
  .record(toolNameSchema, toolModelsSchema)
  .optional();

const agentToolsSchema = z
  .object({
    default: toolNameSchema.default("claude-code"),
    agents: z.record(z.string().trim().min(1), toolNameSchema).default({})
  })
  .strict();

const projectPathSchema = z
  .object({
    path: z.string().trim().min(1),
    git_url: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    optional: z.boolean().optional(),
    lang: z.string().trim().min(1).optional(),
    module_paths: z.array(z.string().trim().min(1)).optional(),
    commands: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional()
  })
  .strict();

const projectsSchema = z
  .object({
    references: z.record(z.string().trim().min(1), projectPathSchema).default({}),
    targets: z.record(z.string().trim().min(1), projectPathSchema).default({})
  })
  .strict()
  .optional();

const dispatchSchema = z
  .object({
    patterns: z
      .array(
        z
          .object({
            match: z.string().trim().min(1),
            agent: z.string().trim().min(1),
            note: z.string().trim().min(1).optional()
          })
          .strict()
      )
      .default([]),
    cross_platform_policy: z.enum(["split_serial", "split_isolated_parallel"]).optional()
  })
  .strict()
  .optional();

const contextVisibilityRuleSchema = z
  .object({
    path: z.string().trim().min(1),
    reason: z.string().trim().min(1).optional(),
    mode: contextVisibilityModeSchema.default("deny_read")
  })
  .strict();

const contextSchema = z
  .object({
    no_active_context: z.array(contextVisibilityRuleSchema).default([])
  })
  .strict()
  .optional();

export const harnessConfigSchema = z
  .object({
    schema_version: z.union([z.literal(1), z.literal(2)]).optional(),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    scope: z.enum(["global", "project"]).default("project"),
    version: z.string().trim().min(1).optional(),
    tools: z.array(toolNameSchema).default([]),
    env: z
      .object({
        required: z.array(z.union([commandRequirementSchema, scriptRequirementSchema])).default([])
      })
      .default({ required: [] }),
    canonical: canonicalSchema,
    agent_tools: agentToolsSchema.optional(),
    models: modelsSchema,
    projects: projectsSchema,
    dispatch: dispatchSchema,
    context: contextSchema,
    mcp: mcpConfigSchema.optional(),
    plugins: pluginsConfigSchema.optional(),
    reference_projects: referenceProjectsConfigSchema.optional(),
    hooks: z
      .object({
        "pre-commit": hookDefinitionSchema.optional(),
        ...lifecycleHooksSchemaShape
      })
      .strict()
      .default({}),
    adapters: z
      .object({
        "claude-code": claudeCodeAdapterSchema.optional(),
        codex: codexAdapterSchema.optional(),
        cursor: cursorAdapterSchema.optional()
      })
      .catchall(adapterSchema)
      .default({})
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.agent_tools) {
      return;
    }

    const configuredTools = new Set(config.tools);
    const validateConfiguredTool = (tool: ToolName, pathSegments: (string | number)[]) => {
      if (!configuredTools.has(tool)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: pathSegments,
          message: `agent_tools value "${tool}" must be listed in tools.`
        });
      }
    };

    validateConfiguredTool(config.agent_tools.default, ["agent_tools", "default"]);

    for (const [agentName, tool] of Object.entries(config.agent_tools.agents)) {
      validateConfiguredTool(tool, ["agent_tools", "agents", agentName]);
    }
  });

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;
export type ContextVisibilityMode = z.infer<typeof contextVisibilityModeSchema>;
export type ContextVisibilityRule = z.infer<typeof contextVisibilityRuleSchema>;
export type ClaudeCodeCapability = z.infer<typeof claudeCodeCapabilitySchema>;
export type CommandRequirement = z.infer<typeof commandRequirementSchema>;
export type HookDefinition = z.infer<typeof hookDefinitionSchema>;
export type LifecycleHookDefinition = z.infer<typeof lifecycleHookDefinitionSchema>;
export type ScriptRequirement = z.infer<typeof scriptRequirementSchema>;
export type ClaudeCodeAdapterConfig = z.infer<typeof claudeCodeAdapterSchema>;
export type CodexAdapterConfig = z.infer<typeof codexAdapterSchema>;
export type CursorAdapterConfig = z.infer<typeof cursorAdapterSchema>;
export type PluginsConfig = z.infer<typeof pluginsConfigSchema>;
export type HookName = z.infer<typeof hookNameSchema>;
export type HookShell = z.infer<typeof hookShellSchema>;
export type ClaudeLifecycleHookName = z.infer<typeof claudeLifecycleHookNameSchema>;
export type ClaudeMatcherHookName = (typeof CLAUDE_MATCHER_HOOK_NAMES)[number];
export type ClaudeNonMatcherHookName = (typeof CLAUDE_NON_MATCHER_HOOK_NAMES)[number];
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export type ReferenceProjectsConfig = z.infer<typeof referenceProjectsConfigSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type AgentToolsConfig = z.infer<typeof agentToolsSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ToolModelsConfig = z.infer<typeof toolModelsSchema>;

export interface HarnessConfigParseOptions {
  readonly onWarning?: (message: string) => void;
}

export interface LoadedHarnessConfig {
  readonly config: HarnessConfig;
  readonly path: string;
  readonly localPath?: string;
}

export interface LoadHarnessConfigOptions {
  readonly noLocal?: boolean;
  readonly onWarning?: (message: string) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMergeConfig(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? deepMergeConfig(merged[key], value) : value;
  }

  return merged;
}

function lookupConfigValue(root: unknown, expression: string): unknown {
  const pathExpression = expression.startsWith("targets.") || expression.startsWith("references.") ? `projects.${expression}` : expression;

  return pathExpression.split(".").reduce<unknown>((current, segment) => {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }

    return current[segment];
  }, root);
}

function interpolateString(value: string, root: unknown): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, expression: string) => {
    const resolved = lookupConfigValue(root, expression.trim());
    return typeof resolved === "string" ? resolved : match;
  });
}

function interpolateConfigValue(value: unknown, root: unknown): unknown {
  if (typeof value === "string") {
    return interpolateString(value, root);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateConfigValue(item, root));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateConfigValue(item, root)]));
  }

  return value;
}

function getLegacyModelDefaultTool(rawConfig: Record<string, unknown>): string {
  const agentTools = rawConfig.agent_tools;

  if (isPlainObject(agentTools) && typeof agentTools.default === "string") {
    return agentTools.default;
  }

  return "claude-code";
}

function hasLegacyModelShape(models: Record<string, unknown>): boolean {
  return "default" in models || "agents" in models;
}

function normalizeLegacyModels(raw: unknown, options: HarnessConfigParseOptions = {}): unknown {
  if (!isPlainObject(raw) || !isPlainObject(raw.models) || raw.schema_version === 2 || !hasLegacyModelShape(raw.models)) {
    return raw;
  }

  const defaultTool = getLegacyModelDefaultTool(raw);
  const legacyModels = raw.models;
  const normalizedModels = Object.fromEntries(Object.entries(legacyModels).filter(([key]) => key !== "default" && key !== "agents"));
  const existingDefaultToolModels = isPlainObject(normalizedModels[defaultTool]) ? normalizedModels[defaultTool] : {};
  const existingDefaultToolAgents = isPlainObject(existingDefaultToolModels.agents) ? existingDefaultToolModels.agents : {};
  const legacyAgents = isPlainObject(legacyModels.agents) ? legacyModels.agents : {};

  normalizedModels[defaultTool] = {
    ...existingDefaultToolModels,
    ...("default" in legacyModels ? { default: legacyModels.default } : {}),
    agents: {
      ...existingDefaultToolAgents,
      ...legacyAgents
    }
  };

  options.onWarning?.(
    "Warning: harness.yaml models.default/models.agents are deprecated; use schema_version: 2 models.<tool>.default/models.<tool>.agents."
  );

  return {
    ...raw,
    models: normalizedModels
  };
}

function parseResolvedHarnessConfig(raw: unknown, options: HarnessConfigParseOptions = {}): HarnessConfig {
  const normalizedRaw = normalizeLegacyModels(raw, options);
  const parsed = harnessConfigSchema.parse(normalizedRaw);
  return harnessConfigSchema.parse(interpolateConfigValue(parsed, parsed));
}

export function parseHarnessConfig(source: string, options: HarnessConfigParseOptions = {}): HarnessConfig {
  return parseResolvedHarnessConfig(YAML.parse(source), options);
}

async function readOptionalYaml(filePath: string): Promise<unknown | undefined> {
  try {
    return YAML.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function loadHarnessConfig(
  cwd: string,
  configPath = DEFAULT_CONFIG_FILE,
  options: LoadHarnessConfigOptions = {}
): Promise<LoadedHarnessConfig> {
  const resolvedPath = path.resolve(cwd, configPath);
  const baseConfig = YAML.parse(await readFile(resolvedPath, "utf8"));
  const localPath = path.join(path.dirname(resolvedPath), LOCAL_CONFIG_FILE);
  const localConfig = options.noLocal ? undefined : await readOptionalYaml(localPath);
  const mergedConfig = localConfig === undefined ? baseConfig : deepMergeConfig(baseConfig, localConfig);

  return {
    config: parseResolvedHarnessConfig(mergedConfig, options),
    path: resolvedPath,
    ...(localConfig === undefined ? {} : { localPath })
  };
}

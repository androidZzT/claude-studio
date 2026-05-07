import path from "node:path";

import { getConfiguredAdapters } from "./adapters/registry.js";
import { MCP_NO_RENDERER_WARNING, PLUGINS_NO_RENDERER_WARNING, REFERENCE_PROJECTS_NO_RENDERER_WARNING } from "./constants.js";
import { harnessConfigSchema, loadHarnessConfig } from "./harness-config.js";
import { planHooks } from "./hooks/planner.js";
import { hasNonEmptyMcpServers } from "./mcp.js";
import { findUndeclaredPluginMarketplaceReferences, hasNonEmptyPlugins } from "./plugins.js";
import { hasDeclaredReferenceProjects } from "./reference-projects.js";
import { reconcile } from "./reconciler/index.js";
import type { ReconcileResult } from "./reconciler/index.js";
import type { PlannedFile } from "./sync-types.js";

interface SyncOptions {
  readonly adoptPartialJsonOwnership?: boolean;
  readonly configPath?: string;
  readonly dryRun?: boolean;
  readonly harnessRepoPath?: string;
  readonly noLocal?: boolean;
  readonly onWarning?: (message: string) => void;
}

function sortPlan(plan: readonly PlannedFile[]): PlannedFile[] {
  return [...plan].sort((left, right) => left.path.localeCompare(right.path));
}

export async function buildPlanForWorkspace(
  cwd: string,
  options: {
    readonly configPath?: string;
    readonly harnessRepoPath?: string;
    readonly noLocal?: boolean;
    readonly onWarning?: (message: string) => void;
  } = {}
): Promise<{ rootDir: string; plan: PlannedFile[] }> {
  const harnessRepoRoot = options.harnessRepoPath ? path.resolve(cwd, options.harnessRepoPath) : cwd;
  const loadedConfig = await loadHarnessConfig(harnessRepoRoot, options.configPath, {
    noLocal: options.noLocal ?? false,
    ...(options.onWarning ? { onWarning: options.onWarning } : {})
  });
  const configRootDir = path.dirname(loadedConfig.path);
  const workspaceRoot = cwd;
  const rebasedConfig = harnessConfigSchema.parse({
    ...loadedConfig.config,
    canonical: {
      ...loadedConfig.config.canonical,
      instructions: path.resolve(configRootDir, loadedConfig.config.canonical.instructions),
      ...(loadedConfig.config.canonical.codexConfig ? { codexConfig: path.resolve(configRootDir, loadedConfig.config.canonical.codexConfig) } : {})
    },
    adapters: {
      ...loadedConfig.config.adapters,
      ...(loadedConfig.config.adapters["claude-code"]
        ? {
            "claude-code": {
              ...loadedConfig.config.adapters["claude-code"],
              ...(loadedConfig.config.adapters["claude-code"]?.agents_source
                ? { agents_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].agents_source) }
                : {}),
              ...(loadedConfig.config.adapters["claude-code"]?.commands_source
                ? { commands_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].commands_source) }
                : {}),
              ...(loadedConfig.config.adapters["claude-code"]?.docs_source
                ? { docs_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].docs_source) }
                : {}),
              ...(loadedConfig.config.adapters["claude-code"]?.metrics_source
                ? { metrics_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].metrics_source) }
                : {}),
              ...(loadedConfig.config.adapters["claude-code"]?.reference_projects_source
                ? { reference_projects_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].reference_projects_source) }
                : {}),
              ...(loadedConfig.config.adapters["claude-code"]?.rules_source
                ? { rules_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].rules_source) }
                : {}),
              ...(loadedConfig.config.adapters["claude-code"]?.scripts_source
                ? { scripts_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].scripts_source) }
                : {}),
              ...(loadedConfig.config.adapters["claude-code"]?.skills_source
                ? { skills_source: path.resolve(configRootDir, loadedConfig.config.adapters["claude-code"].skills_source) }
                : {})
            }
          }
        : {})
    }
  });
  const adapters = getConfiguredAdapters(rebasedConfig);
  const enabledAdapterIds = new Set(adapters.map((adapter) => adapter.id));
  const plannedFiles = await Promise.all(
    adapters.map((adapter) => adapter.plan(rebasedConfig, workspaceRoot, options.onWarning ? { onWarning: options.onWarning } : {}))
  );
  const plannedHooks = await planHooks(rebasedConfig, workspaceRoot, options.onWarning ? { onWarning: options.onWarning } : {});

  if (hasNonEmptyMcpServers(rebasedConfig)) {
    if (!enabledAdapterIds.has("claude-code") && !enabledAdapterIds.has("codex") && !enabledAdapterIds.has("cursor")) {
      options.onWarning?.(MCP_NO_RENDERER_WARNING);
    }
  }

  for (const pluginId of findUndeclaredPluginMarketplaceReferences(rebasedConfig)) {
    const marketplaceId = pluginId.split("@")[1];
    options.onWarning?.(`Warning: plugin "${pluginId}" references undeclared marketplace "${marketplaceId}".`);
  }

  if (hasNonEmptyPlugins(rebasedConfig) && !enabledAdapterIds.has("claude-code")) {
    options.onWarning?.(PLUGINS_NO_RENDERER_WARNING);
  }

  if (hasDeclaredReferenceProjects(rebasedConfig) && !enabledAdapterIds.has("claude-code")) {
    options.onWarning?.(REFERENCE_PROJECTS_NO_RENDERER_WARNING);
  }

  return {
    rootDir: workspaceRoot,
    plan: sortPlan([...plannedFiles.flat(), ...plannedHooks])
  };
}

export async function runDiff(cwd: string, options: SyncOptions = {}): Promise<ReconcileResult> {
  const { rootDir, plan } = await buildPlanForWorkspace(cwd, options);
  return reconcile(plan, { dryRun: true, rootDir });
}

export async function runSync(cwd: string, options: SyncOptions = {}): Promise<ReconcileResult> {
  const { rootDir, plan } = await buildPlanForWorkspace(cwd, options);
  return reconcile(plan, {
    dryRun: options.dryRun ?? false,
    rootDir,
    ...(options.adoptPartialJsonOwnership !== undefined ? { adoptPartialJsonOwnership: options.adoptPartialJsonOwnership } : {})
  });
}

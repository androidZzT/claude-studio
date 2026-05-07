import { CLAUDE_SETTINGS_OUTPUT_PATH } from "../constants.js";
import { renderClaudeNoActiveContextSettings } from "../context-visibility.js";
import { CLAUDE_LIFECYCLE_HOOK_NAMES, CLAUDE_MATCHER_HOOK_NAMES } from "../harness-config.js";
import type { ClaudeLifecycleHookName, HarnessConfig, LifecycleHookDefinition } from "../harness-config.js";
import { getSortedMcpServers } from "../mcp.js";
import { renderClaudeEnabledPlugins, renderClaudePluginMarketplaces } from "../plugins.js";
import type { PartialPlannedFile } from "../sync-types.js";

import { createPartialJsonPlannedFile } from "./shared.js";

interface ClaudeCommandHook {
  readonly command: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
  readonly type: "command";
}

interface ClaudeLifecycleHookEntry {
  readonly hooks: readonly ClaudeCommandHook[];
  readonly matcher?: string;
}

interface ClaudeSettingsPlanOptions {
  readonly onWarning?: (message: string) => void;
  readonly preserveNonMatcherMatchers?: boolean;
}

const claudeMatcherHookNames = new Set<string>(CLAUDE_MATCHER_HOOK_NAMES);

function renderClaudeLifecycleHookEntry(
  hookName: ClaudeLifecycleHookName,
  entry: LifecycleHookDefinition,
  index: number,
  options?: ClaudeSettingsPlanOptions
): ClaudeLifecycleHookEntry {
  const renderedCommand: ClaudeCommandHook = {
    type: "command",
    command: entry.run,
    ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
    ...(entry.statusMessage !== undefined ? { statusMessage: entry.statusMessage } : {})
  };
  const renderedEntry: ClaudeLifecycleHookEntry = {
    hooks: [renderedCommand]
  };

  if (!claudeMatcherHookNames.has(hookName)) {
    if (options?.preserveNonMatcherMatchers && entry.matcher !== undefined) {
      return {
        ...renderedEntry,
        matcher: entry.matcher
      };
    }

    if (entry.matcher !== undefined) {
      options?.onWarning?.(
        `Warning: hook \`${hookName}[${index}]\` declares matcher but the event type does not use matcher; field will be ignored on render.`
      );
    }

    return renderedEntry;
  }

  if (entry.matcher !== undefined) {
    return {
      ...renderedEntry,
      matcher: entry.matcher
    };
  }

  return renderedEntry;
}

function renderClaudeHooks(
  config: HarnessConfig,
  options?: ClaudeSettingsPlanOptions
): Record<ClaudeLifecycleHookName, ClaudeLifecycleHookEntry[]> {
  const renderedHooks = {} as Record<ClaudeLifecycleHookName, ClaudeLifecycleHookEntry[]>;

  for (const hookName of CLAUDE_LIFECYCLE_HOOK_NAMES) {
    const configuredHooks = config.hooks[hookName] ?? [];
    const enabledHooks = configuredHooks
      .filter((entry) => entry.enabled !== false)
      .map((entry, index) => renderClaudeLifecycleHookEntry(hookName, entry, index, options));

    if (enabledHooks.length > 0) {
      renderedHooks[hookName] = enabledHooks;
    }
  }

  return renderedHooks;
}

function renderClaudeMcpServers(config: HarnessConfig): Record<string, unknown> {
  return getSortedMcpServers(config);
}

function renderClaudePluginSettings(config: HarnessConfig): {
  marketplaces: Record<string, unknown>;
  plugins: ReturnType<typeof renderClaudeEnabledPlugins>;
} {
  const renderedPlugins = renderClaudeEnabledPlugins(config);

  return {
    marketplaces: renderClaudePluginMarketplaces(config),
    plugins: renderedPlugins
  };
}

export function buildClaudeSettingsPlan(
  config: HarnessConfig,
  rootDir: string,
  targetRoot: string,
  options?: ClaudeSettingsPlanOptions
): PartialPlannedFile | undefined {
  const ownedValues: Record<string, unknown> = {};
  const hooks = renderClaudeHooks(config, options);
  const mcpServers = renderClaudeMcpServers(config);
  const pluginSettings = renderClaudePluginSettings(config);
  const noActiveContextSettings = renderClaudeNoActiveContextSettings(config);

  if (Object.keys(hooks).length > 0) {
    ownedValues.hooks = hooks;
  }

  if (Object.keys(mcpServers).length > 0) {
    ownedValues.mcpServers = mcpServers;
  }

  if (Object.keys(pluginSettings.marketplaces).length > 0) {
    ownedValues.marketplaces = pluginSettings.marketplaces;
  }

  const renderedPluginsValue = pluginSettings.plugins.value;
  const renderedPluginsCount = Array.isArray(renderedPluginsValue)
    ? renderedPluginsValue.length
    : Object.keys(renderedPluginsValue).length;

  if (pluginSettings.plugins.noteScopeDropped) {
    options?.onWarning?.("Note: enabledPlugins format does not support 'scope'; field will be dropped.");
  }

  if (renderedPluginsCount > 0) {
    ownedValues[pluginSettings.plugins.key] = renderedPluginsValue;
  }

  Object.assign(ownedValues, noActiveContextSettings);

  if (Object.keys(ownedValues).length === 0) {
    return undefined;
  }

  return createPartialJsonPlannedFile(rootDir, targetRoot, CLAUDE_SETTINGS_OUTPUT_PATH, ownedValues);
}

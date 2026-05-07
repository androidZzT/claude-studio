import path from "node:path";

import { CLAUDE_LIFECYCLE_HOOK_NAMES, type HarnessConfig } from "../../harness-config.js";
import { HarnessError } from "../../errors.js";
import type { EnabledPlugin, PluginMarketplace, PluginScope, PluginsConfig } from "../../plugins.js";
import type { McpServer } from "../../mcp.js";
import type { SettingsExtraction } from "../types.js";

import { readJsonObject } from "./shared.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLifecycleHooks(settingsHooks: unknown): HarnessConfig["hooks"] | undefined {
  if (!isPlainObject(settingsHooks)) {
    return undefined;
  }

  const hooks: HarnessConfig["hooks"] = {};

  for (const hookName of CLAUDE_LIFECYCLE_HOOK_NAMES) {
    const hookGroups = settingsHooks[hookName];
    if (!Array.isArray(hookGroups)) {
      continue;
    }

    const normalizedEntries = hookGroups.flatMap((group) => {
      if (!isPlainObject(group)) {
        return [];
      }

      const matcher = typeof group.matcher === "string" ? group.matcher : undefined;
      const hookCommands = Array.isArray(group.hooks) ? group.hooks : [];

      return hookCommands.flatMap((hook) => {
        if (!isPlainObject(hook) || hook.type !== "command" || typeof hook.command !== "string" || hook.command.trim().length === 0) {
          return [];
        }

        return [
          {
            ...(matcher !== undefined ? { matcher } : {}),
            enabled: true,
            run: hook.command,
            ...(typeof hook.timeout === "number" ? { timeout: hook.timeout } : {}),
            ...(typeof hook.statusMessage === "string" && hook.statusMessage.length > 0 ? { statusMessage: hook.statusMessage } : {})
          }
        ];
      });
    });

    if (normalizedEntries.length > 0) {
      hooks[hookName] = normalizedEntries;
    }
  }

  return Object.keys(hooks).length > 0 ? hooks : undefined;
}

function normalizeMcp(mcpServers: unknown): { servers: Record<string, McpServer> } | undefined {
  if (!isPlainObject(mcpServers)) {
    return undefined;
  }

  const servers: Record<string, McpServer> = {};

  for (const [serverName, serverValue] of Object.entries(mcpServers)) {
    if (!isPlainObject(serverValue) || typeof serverValue.command !== "string" || serverValue.command.trim().length === 0) {
      continue;
    }

    servers[serverName] = {
      command: serverValue.command,
      args: Array.isArray(serverValue.args) ? serverValue.args.filter((value): value is string => typeof value === "string") : [],
      env: isPlainObject(serverValue.env)
        ? Object.fromEntries(Object.entries(serverValue.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {}
    };
  }

  return Object.keys(servers).length > 0 ? { servers } : undefined;
}

function normalizePluginMarketplaces(marketplaces: unknown): PluginMarketplace[] {
  if (!isPlainObject(marketplaces)) {
    return [];
  }

  return Object.keys(marketplaces)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((marketplaceId) => {
      const marketplace = marketplaces[marketplaceId];
      if (!isPlainObject(marketplace) || typeof marketplace.source !== "string" || marketplace.source.trim().length === 0) {
        return [];
      }

      return [
        {
          id: marketplaceId,
          source: marketplace.source,
          autoUpdate: marketplace.autoUpdate === true
        }
      ];
    });
}

function normalizeEnabledPlugins(enabledPlugins: unknown): { format: PluginsConfig["format"]; enabled: EnabledPlugin[] } | undefined {
  if (isPlainObject(enabledPlugins)) {
    return {
      format: "enabledPlugins",
      enabled: Object.keys(enabledPlugins)
        .sort((left, right) => left.localeCompare(right))
        .filter((pluginId) => enabledPlugins[pluginId] === true)
        .map((pluginId) => ({
          id: pluginId,
          scope: "user"
        }))
    };
  }

  const normalizeScope = (value: unknown): PluginScope => {
    if (value === "project" || value === "local" || value === "user") {
      return value;
    }

    return "user";
  };

  if (Array.isArray(enabledPlugins)) {
    const normalizedPlugins = enabledPlugins.flatMap((entry) => {
      if (!isPlainObject(entry) || typeof entry.plugin !== "string" || entry.plugin.trim().length === 0) {
        return [];
      }

      return [
        {
          id: entry.plugin,
          scope: normalizeScope(entry.scope)
        }
      ];
    });

    return normalizedPlugins.length > 0 ? { format: "plugins", enabled: normalizedPlugins } : undefined;
  }

  return undefined;
}

function normalizePlugins(settings: Record<string, unknown>): PluginsConfig | undefined {
  const normalizedEnabled =
    normalizeEnabledPlugins(settings.enabledPlugins) ??
    normalizeEnabledPlugins(settings.plugins);
  const marketplaces = normalizePluginMarketplaces(settings.marketplaces ?? settings.extraKnownMarketplaces);

  if (!normalizedEnabled && marketplaces.length === 0) {
    return undefined;
  }

  return {
    format: normalizedEnabled?.format ?? "plugins",
    marketplaces,
    enabled: normalizedEnabled?.enabled ?? []
  };
}

export async function extractSettings(sourceRoot: string): Promise<SettingsExtraction> {
  const settingsPath = path.join(sourceRoot, ".claude", "settings.json");

  try {
    const settings = await readJsonObject(settingsPath);
    const hooks = normalizeLifecycleHooks(settings.hooks);
    const mcp = normalizeMcp(settings.mcpServers);
    const plugins = normalizePlugins(settings);
    return {
      warnings: [],
      ...(hooks ? { hooks } : {}),
      ...(mcp ? { mcp } : {}),
      ...(plugins ? { plugins } : {})
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        warnings: [`Warning: settings.json not found: ${settingsPath}`]
      };
    }

    if (error instanceof HarnessError) {
      throw new HarnessError(`Failed to extract settings from ${settingsPath}: ${error.message}`, error.code);
    }

    throw error;
  }
}

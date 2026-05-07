import { z } from "zod";

import type { HarnessConfig } from "./harness-config.js";

const marketplaceSourcePattern = /^(github:|https?:\/\/|git\+|file:)/;

function hasSingleMarketplaceSeparator(value: string): boolean {
  return value.split("@").length <= 2;
}

function collectDuplicateIds(entries: readonly { readonly id: string }[]): string[] {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right));
}

export const pluginSettingsFormatSchema = z.enum(["plugins", "enabledPlugins"]);
export const pluginScopeSchema = z.enum(["user", "project", "local"]);

export const pluginReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .refine(hasSingleMarketplaceSeparator, "Plugin references do not support version pinning or multiple @ segments.");

export const pluginMarketplaceSchema = z
  .object({
    id: z.string().trim().min(1),
    source: z
      .string()
      .trim()
      .min(1)
      .regex(marketplaceSourcePattern, "Plugin marketplace sources must start with github:, http(s)://, git+, or file:."),
    autoUpdate: z.boolean().default(false)
  })
  .strict();

const pluginEnabledInputSchema = z.union([
  pluginReferenceSchema.transform((id) => ({
    id,
    scope: "user" as const
  })),
  z
    .object({
      id: pluginReferenceSchema,
      scope: pluginScopeSchema.default("user")
    })
    .strict()
]);

export const pluginsConfigSchema = z
  .object({
    format: pluginSettingsFormatSchema.default("plugins"),
    marketplaces: z
      .array(pluginMarketplaceSchema)
      .superRefine((marketplaces, context) => {
        const duplicateIds = collectDuplicateIds(marketplaces);

        for (const id of duplicateIds) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Plugin marketplace ids must be unique: ${id}`
          });
        }
      })
      .default([]),
    enabled: z
      .array(pluginEnabledInputSchema)
      .superRefine((enabledPlugins, context) => {
        const duplicateIds = collectDuplicateIds(enabledPlugins);

        for (const id of duplicateIds) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Enabled plugin ids must be unique: ${id}`
          });
        }
      })
      .default([])
  })
  .strict();

export type PluginScope = z.infer<typeof pluginScopeSchema>;
export type PluginSettingsFormat = z.infer<typeof pluginSettingsFormatSchema>;
export type PluginMarketplace = z.infer<typeof pluginMarketplaceSchema>;
export type EnabledPlugin = z.infer<typeof pluginEnabledInputSchema>;
export type PluginsConfig = z.infer<typeof pluginsConfigSchema>;

interface ClaudePluginMarketplace {
  readonly autoUpdate?: true;
  readonly source: string;
}

interface ClaudePluginEntry {
  readonly enabled: true;
  readonly plugin: string;
  readonly scope: PluginScope;
}

interface RenderedClaudePlugins {
  readonly key: "enabledPlugins" | "plugins";
  readonly noteScopeDropped: boolean;
  readonly value: Readonly<Record<string, true>> | readonly ClaudePluginEntry[];
}

function sortById<T extends { readonly id: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

function extractMarketplaceReference(pluginId: string): string | undefined {
  const separatorIndex = pluginId.indexOf("@");
  if (separatorIndex === -1) {
    return undefined;
  }

  return pluginId.slice(separatorIndex + 1);
}

export function hasDeclaredPlugins(config: HarnessConfig): boolean {
  return config.plugins !== undefined;
}

export function hasNonEmptyPlugins(config: HarnessConfig): boolean {
  return (config.plugins?.marketplaces.length ?? 0) > 0 || (config.plugins?.enabled.length ?? 0) > 0;
}

export function findUndeclaredPluginMarketplaceReferences(config: HarnessConfig): string[] {
  const declaredMarketplaces = new Set((config.plugins?.marketplaces ?? []).map((marketplace) => marketplace.id));
  const referencedPluginIds = config.plugins?.enabled ?? [];

  return referencedPluginIds
    .filter((plugin) => {
      const marketplaceId = extractMarketplaceReference(plugin.id);
      return marketplaceId !== undefined && !declaredMarketplaces.has(marketplaceId);
    })
    .map((plugin) => plugin.id)
    .sort((left, right) => left.localeCompare(right));
}

export function renderClaudePluginMarketplaces(config: HarnessConfig): Record<string, ClaudePluginMarketplace> {
  return Object.fromEntries(
    sortById(config.plugins?.marketplaces ?? []).map((marketplace) => [
      marketplace.id,
      {
        source: marketplace.source,
        ...(marketplace.autoUpdate ? { autoUpdate: true as const } : {})
      }
    ])
  );
}

export function renderClaudeEnabledPluginsArray(config: HarnessConfig): ClaudePluginEntry[] {
  return sortById(config.plugins?.enabled ?? []).map((plugin) => ({
    plugin: plugin.id,
    scope: plugin.scope,
    enabled: true as const
  }));
}

export function renderClaudeEnabledPluginsObject(config: HarnessConfig): Record<string, true> {
  return Object.fromEntries(sortById(config.plugins?.enabled ?? []).map((plugin) => [plugin.id, true as const]));
}

export function renderClaudeEnabledPlugins(config: HarnessConfig): RenderedClaudePlugins {
  const format = config.plugins?.format ?? "plugins";
  const enabledPlugins = config.plugins?.enabled ?? [];

  if (format === "enabledPlugins") {
    return {
      key: "enabledPlugins",
      noteScopeDropped: enabledPlugins.some((plugin) => plugin.scope !== "user"),
      value: renderClaudeEnabledPluginsObject(config)
    };
  }

  return {
    key: "plugins",
    noteScopeDropped: false,
    value: renderClaudeEnabledPluginsArray(config)
  };
}

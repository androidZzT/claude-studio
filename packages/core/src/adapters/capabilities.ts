import { z } from "zod";

import { toolNameSchema } from "../harness-config.js";

import type { Adapter } from "./types.js";

export const ADAPTERS_CAPABILITIES_SCHEMA_VERSION = 1;

export const ADAPTER_FEATURES = Object.freeze({
  CLAUDE_AGENTS_MD: "claude-agents-md",
  CLAUDE_COMMANDS_MD: "claude-commands-md",
  CLAUDE_DOCS: "claude-docs",
  CLAUDE_HOOKS: "claude-hooks",
  CLAUDE_MCP: "claude-mcp",
  CLAUDE_MD: "claude-md",
  CLAUDE_METRICS: "claude-metrics",
  CLAUDE_PLUGINS: "claude-plugins",
  CLAUDE_REFERENCE_PROJECTS: "claude-reference-projects",
  CLAUDE_RULES_MD: "claude-rules-md",
  CLAUDE_SCRIPTS: "claude-scripts",
  CLAUDE_SKILLS: "claude-skills",
  AGENTS_MD: "agents-md",
  CODEX_CONFIG_TOML: "codex-config-toml",
  CURSOR_MCP_JSON: "cursor-mcp-json",
  CURSOR_RULES_MDC: "cursor-rules-mdc"
} as const);

const adapterFeatureSchema = z.string().trim().min(1);

export const adapterCapabilitiesEntrySchema = z
  .object({
    id: toolNameSchema,
    features: z.array(adapterFeatureSchema)
  })
  .strict();

export const adaptersCapabilitiesReportSchema = z
  .object({
    schema_version: z.literal(ADAPTERS_CAPABILITIES_SCHEMA_VERSION),
    adapters: z.array(adapterCapabilitiesEntrySchema)
  })
  .strict();

export type AdapterCapabilitiesEntry = z.infer<typeof adapterCapabilitiesEntrySchema>;
export type AdaptersCapabilitiesReport = z.infer<typeof adaptersCapabilitiesReportSchema>;

function sortFeatures(features: readonly string[]): string[] {
  return [...new Set(features)].sort((left, right) => left.localeCompare(right));
}

export function describeAdapterCapabilities(adapters: readonly Adapter[]): AdaptersCapabilitiesReport {
  return adaptersCapabilitiesReportSchema.parse({
    schema_version: ADAPTERS_CAPABILITIES_SCHEMA_VERSION,
    adapters: [...adapters]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((adapter) => ({
        id: adapter.id,
        features: sortFeatures(adapter.capabilities().features)
      }))
  });
}

import YAML from "yaml";

import type { HarnessConfig } from "../harness-config.js";

import type { AdoptBuildInput } from "./types.js";

const capabilityOrder: readonly string[] = [
  "agents",
  "skills",
  "rules",
  "scripts",
  "commands",
  "hooks",
  "mcp",
  "plugins",
  "reference_projects",
  "docs",
  "metrics"
];

function sortCapabilities(capabilities: readonly string[]): string[] {
  return capabilityOrder.filter((capability) => capabilities.includes(capability));
}

export function buildHarnessYaml(input: AdoptBuildInput): string {
  const document: Record<string, unknown> = {
    schema_version: 1,
    name: input.name,
    description: input.description,
    tools: ["claude-code"],
    canonical: {
      instructions: "./AGENTS.md.template"
    },
    adapters: {
      "claude-code": {
        enabled: true,
        target: ".",
        capabilities: sortCapabilities(input.capabilities),
        agents_source: "./agents",
        commands_source: "./commands",
        docs_source: "./docs",
        metrics_source: "./metrics",
        reference_projects_source: "./reference-project.json",
        rules_source: "./rules",
        scripts_source: "./scripts",
        skills_source: "./skills"
      },
      codex: {
        enabled: false
      },
      cursor: {
        enabled: false
      }
    }
  };

  if (input.hooks && Object.keys(input.hooks).length > 0) {
    document.hooks = input.hooks;
  }

  if (input.mcp && Object.keys(input.mcp.servers).length > 0) {
    document.mcp = input.mcp;
  }

  if (input.plugins && (input.plugins.marketplaces.length > 0 || input.plugins.enabled.length > 0)) {
    document.plugins = input.plugins;
  }

  return YAML.stringify(document as HarnessConfig & { readonly schema_version: 1; readonly description: string });
}

import path from "node:path";

import * as TOML from "@iarna/toml";

import {
  CODEX_AGENTS_OUTPUT_PATH,
  CODEX_CONFIG_OUTPUT_PATH,
  DEFAULT_CODEX_TARGET
} from "../constants.js";
import {
  getAgentsWithExplicitToolRoute,
  getAgentTool,
  hasResolvedModelProfileFields,
  resolveToolModelProfile
} from "../agent-routing.js";
import { renderCodexNoActiveContextFragment } from "../context-visibility.js";
import type { HarnessConfig } from "../harness-config.js";
import type { ResolvedModelProfile } from "../agent-routing.js";
import { renderCodexMcpFragment } from "../mcp.js";
import type { PlannedFile } from "../sync-types.js";

import { ADAPTER_FEATURES } from "./capabilities.js";
import { buildGeneratedInstructions, createPlannedFile, readTemplate } from "./shared.js";
import type { Adapter, AdapterPlanOptions } from "./types.js";

function appendTomlFragment(source: string, fragment: string): string {
  if (!fragment) {
    return source;
  }

  if (source.length === 0) {
    return fragment;
  }

  return `${source}${source.endsWith("\n") ? "\n" : "\n\n"}${fragment}`;
}

function renderTomlValue(key: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return `${key} = ${TOML.stringify.value(value)}`;
}

function renderCodexProfileFields(profile: ResolvedModelProfile): string[] {
  return [
    renderTomlValue("model", profile.model),
    renderTomlValue("model_reasoning_effort", profile.effort),
    renderTomlValue("sandbox_mode", profile.sandbox_mode),
    renderTomlValue("approval_policy", profile.approval_policy)
  ].filter((line): line is string => line !== undefined);
}

function renderTomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : TOML.stringify.value(value);
}

function getCodexProfileAgentNames(config: HarnessConfig): string[] {
  const routedAgentNames = new Set(getAgentsWithExplicitToolRoute(config, "codex"));

  for (const agentName of Object.keys(config.models?.codex?.agents ?? {})) {
    if (getAgentTool(config, agentName) === "codex") {
      routedAgentNames.add(agentName);
    }
  }

  return [...routedAgentNames].sort((left, right) => left.localeCompare(right));
}

export function renderCodexProfilesFragment(config: HarnessConfig): string {
  const sections = getCodexProfileAgentNames(config).flatMap((agentName) => {
    const profile = resolveToolModelProfile(config, "codex", agentName);

    if (!hasResolvedModelProfileFields(profile)) {
      return [];
    }

    return [`[profiles.${renderTomlKeySegment(agentName)}]\n${renderCodexProfileFields(profile).join("\n")}`];
  });

  return sections.join("\n\n");
}

export function createCodexAdapter(): Adapter {
  return {
    id: "codex",
    async plan(config: HarnessConfig, cwd: string, options?: AdapterPlanOptions): Promise<PlannedFile[]> {
      void options;
      const targetRoot = path.resolve(cwd, config.adapters.codex?.target ?? DEFAULT_CODEX_TARGET);
      const instructionsTemplate = await readTemplate(cwd, config.canonical.instructions, "codex");
      const plannedFiles = [
        createPlannedFile(cwd, targetRoot, CODEX_AGENTS_OUTPUT_PATH, buildGeneratedInstructions(instructionsTemplate))
      ];

      const codexConfigTemplate = config.canonical.codexConfig
        ? await readTemplate(cwd, config.canonical.codexConfig, "codex")
        : "";
      const codexConfigContent = appendTomlFragment(
        appendTomlFragment(
          appendTomlFragment(codexConfigTemplate, renderCodexProfilesFragment(config)),
          renderCodexNoActiveContextFragment(config)
        ),
        renderCodexMcpFragment(config)
      );

      if (config.canonical.codexConfig || codexConfigContent.length > 0) {
        plannedFiles.push(createPlannedFile(cwd, targetRoot, CODEX_CONFIG_OUTPUT_PATH, codexConfigContent));
      }

      return plannedFiles;
    },
    capabilities() {
      return {
        features: [ADAPTER_FEATURES.AGENTS_MD, ADAPTER_FEATURES.CODEX_CONFIG_TOML]
      };
    }
  };
}

import type { HarnessConfig, ModelProfile, ToolName } from "./harness-config.js";

export interface ResolvedModelProfile {
  readonly approval_policy?: string;
  readonly effort?: string;
  readonly model?: string;
  readonly sandbox_mode?: string;
}

function modelProfileToObject(profile: ModelProfile | undefined): ResolvedModelProfile {
  if (!profile) {
    return {};
  }

  if (typeof profile === "string") {
    return {
      model: profile
    };
  }

  return {
    ...(profile.approval_policy !== undefined ? { approval_policy: profile.approval_policy } : {}),
    ...(profile.effort !== undefined ? { effort: profile.effort } : {}),
    ...(profile.model !== undefined ? { model: profile.model } : {}),
    ...(profile.sandbox_mode !== undefined ? { sandbox_mode: profile.sandbox_mode } : {})
  };
}

export function getAgentTool(config: HarnessConfig, agentName: string): ToolName {
  return config.agent_tools?.agents[agentName] ?? config.agent_tools?.default ?? "claude-code";
}

export function isAgentRoutedToTool(config: HarnessConfig, agentName: string, tool: ToolName): boolean {
  return getAgentTool(config, agentName) === tool;
}

export function getAgentsWithExplicitToolRoute(config: HarnessConfig, tool: ToolName): string[] {
  return Object.entries(config.agent_tools?.agents ?? {})
    .filter(([, routedTool]) => routedTool === tool)
    .map(([agentName]) => agentName)
    .sort((left, right) => left.localeCompare(right));
}

export function resolveToolModelProfile(config: HarnessConfig, tool: ToolName, agentName: string): ResolvedModelProfile {
  const toolModels = config.models?.[tool];

  return {
    ...modelProfileToObject(toolModels?.default),
    ...modelProfileToObject(toolModels?.agents[agentName])
  };
}

export function hasResolvedModelProfileFields(profile: ResolvedModelProfile): boolean {
  return Object.keys(profile).length > 0;
}

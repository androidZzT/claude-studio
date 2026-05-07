import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { CURSOR_MCP_OUTPUT_PATH, DEFAULT_CODEX_TARGET } from "../constants.js";
import type { HarnessConfig } from "../harness-config.js";
import { renderCursorMcpDocument } from "../mcp.js";
import type { PlannedFile } from "../sync-types.js";

import { ADAPTER_FEATURES } from "./capabilities.js";
import { buildGeneratedInstructions, createPlannedFile, readTemplate } from "./shared.js";
import type { Adapter, AdapterPlanOptions } from "./types.js";

const CURSOR_RULES_PATH = ".cursor/rules/main.mdc";

const cursorFrontmatterSchema = z
  .object({
    description: z.literal("Harness-managed development rules"),
    alwaysApply: z.literal(true)
  })
  .strict();

function renderCursorFrontmatter(): string {
  const frontmatter = YAML.stringify(
    cursorFrontmatterSchema.parse({
      description: "Harness-managed development rules",
      alwaysApply: true
    })
  ).trimEnd();

  return `---\n${frontmatter}\n---`;
}

function buildCursorRulesDocument(source: string): string {
  return `${renderCursorFrontmatter()}\n\n${buildGeneratedInstructions(source)}`;
}

export function createCursorAdapter(): Adapter {
  return {
    id: "cursor",
    async plan(config: HarnessConfig, cwd: string, options?: AdapterPlanOptions): Promise<PlannedFile[]> {
      void options;
      const targetRoot = path.resolve(cwd, config.adapters.cursor?.target ?? DEFAULT_CODEX_TARGET);
      const instructionsTemplate = await readTemplate(cwd, config.canonical.instructions, "cursor");
      const plannedFiles = [createPlannedFile(cwd, targetRoot, CURSOR_RULES_PATH, buildCursorRulesDocument(instructionsTemplate))];
      const mcpDocument = renderCursorMcpDocument(config);

      if (mcpDocument) {
        plannedFiles.push(createPlannedFile(cwd, targetRoot, CURSOR_MCP_OUTPUT_PATH, mcpDocument));
      }

      return plannedFiles;
    },
    capabilities() {
      return {
        features: [ADAPTER_FEATURES.CURSOR_MCP_JSON, ADAPTER_FEATURES.CURSOR_RULES_MDC]
      };
    }
  };
}

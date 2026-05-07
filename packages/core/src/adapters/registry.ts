import { HarnessError } from "../errors.js";
import type { HarnessConfig, ToolName } from "../harness-config.js";

import { createClaudeCodeAdapter } from "./claude-code.js";
import { createCodexAdapter } from "./codex.js";
import { createCursorAdapter } from "./cursor.js";
import type { Adapter } from "./types.js";

const claudeCodeAdapter = createClaudeCodeAdapter();
const codexAdapter = createCodexAdapter();
const cursorAdapter = createCursorAdapter();

const registry: Readonly<Partial<Record<ToolName, Adapter>>> = Object.freeze({
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter
});

function isSupportedAdapter(tool: ToolName): tool is "claude-code" | "codex" | "cursor" {
  return tool === "claude-code" || tool === "codex" || tool === "cursor";
}

export function findRegisteredAdapter(adapterId: string): Adapter | undefined {
  return registry[adapterId as ToolName];
}

export function listRegisteredAdapters(): Adapter[] {
  return Object.values(registry)
    .flatMap((adapter) => (adapter ? [adapter] : []))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getAdapter(adapterId: string): Adapter {
  const adapter = findRegisteredAdapter(adapterId);
  if (!adapter) {
    throw new HarnessError(`Unknown adapter: ${adapterId}`, "ADAPTER_UNKNOWN");
  }

  return adapter;
}

export function getConfiguredAdapters(config: HarnessConfig): Adapter[] {
  const adapters: Adapter[] = [];

  for (const tool of config.tools) {
    if (!isSupportedAdapter(tool)) {
      throw new HarnessError(`Adapter \`${tool}\` is not implemented in this stage.`, "ADAPTER_UNSUPPORTED");
    }

    if (config.adapters[tool]?.enabled === false) {
      continue;
    }

    adapters.push(getAdapter(tool));
  }

  return adapters;
}

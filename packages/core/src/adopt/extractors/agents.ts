import path from "node:path";

import type { CapabilityExtraction } from "../types.js";

import { collectTopLevelMarkdownFiles } from "./shared.js";

export async function extractAgents(sourceRoot: string): Promise<CapabilityExtraction> {
  return {
    capability: "agents",
    files: await collectTopLevelMarkdownFiles(path.join(sourceRoot, ".claude", "agents"), "agents", { allowMissing: true })
  };
}

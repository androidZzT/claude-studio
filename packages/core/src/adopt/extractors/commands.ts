import path from "node:path";

import type { CapabilityExtraction } from "../types.js";

import { collectTopLevelMarkdownFiles } from "./shared.js";

export async function extractCommands(sourceRoot: string): Promise<CapabilityExtraction> {
  return {
    capability: "commands",
    files: await collectTopLevelMarkdownFiles(path.join(sourceRoot, ".claude", "commands"), "commands", { allowMissing: true })
  };
}

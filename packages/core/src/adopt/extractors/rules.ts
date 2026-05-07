import path from "node:path";

import type { CapabilityExtraction } from "../types.js";

import { collectTopLevelMarkdownFiles } from "./shared.js";

export async function extractRules(sourceRoot: string): Promise<CapabilityExtraction> {
  return {
    capability: "rules",
    files: await collectTopLevelMarkdownFiles(path.join(sourceRoot, ".claude", "rules"), "rules", { allowMissing: true })
  };
}

import path from "node:path";

import type { CapabilityExtraction } from "../types.js";

import { collectRecursiveFiles } from "./shared.js";

export async function extractScripts(
  sourceRoot: string,
  options: { readonly onWarning?: (message: string) => void } = {}
): Promise<CapabilityExtraction> {
  return {
    capability: "scripts",
    files: await collectRecursiveFiles(path.join(sourceRoot, ".claude", "scripts"), "scripts", {
      allowMissing: true,
      ...(options.onWarning ? { onWarning: options.onWarning } : {})
    })
  };
}

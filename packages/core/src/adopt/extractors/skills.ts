import path from "node:path";

import type { CapabilityExtraction } from "../types.js";

import { collectRecursiveFiles } from "./shared.js";

export async function extractSkills(
  sourceRoot: string,
  options: { readonly onWarning?: (message: string) => void } = {}
): Promise<CapabilityExtraction> {
  return {
    capability: "skills",
    files: await collectRecursiveFiles(path.join(sourceRoot, ".claude", "skills"), "skills", {
      allowMissing: true,
      ...(options.onWarning ? { onWarning: options.onWarning } : {})
    })
  };
}

import path from "node:path";

import type { CapabilityExtraction } from "../types.js";

import { collectRecursiveFiles } from "./shared.js";

const METRICS_RUNTIME_FILE_PATTERN = /^events\.jsonl(\..+)?$/;

export async function extractDocs(
  sourceRoot: string,
  options: { readonly onWarning?: (message: string) => void } = {}
): Promise<CapabilityExtraction> {
  return {
    capability: "docs",
    files: await collectRecursiveFiles(path.join(sourceRoot, ".claude", "docs"), "docs", {
      allowMissing: true,
      ...(options.onWarning ? { onWarning: options.onWarning } : {})
    })
  };
}

export async function extractMetrics(
  sourceRoot: string,
  options: { readonly onWarning?: (message: string) => void } = {}
): Promise<CapabilityExtraction> {
  return {
    capability: "metrics",
    files: await collectRecursiveFiles(path.join(sourceRoot, ".claude", "metrics"), "metrics", {
      allowMissing: true,
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
      shouldIncludeFile(relativePath) {
        return !METRICS_RUNTIME_FILE_PATTERN.test(path.posix.basename(relativePath));
      }
    })
  };
}

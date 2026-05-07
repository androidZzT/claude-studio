import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { CapabilityExtraction } from "../types.js";

export async function extractReferenceProjects(sourceRoot: string): Promise<CapabilityExtraction> {
  const absolutePath = path.join(sourceRoot, ".claude", "reference-project.json");

  try {
    const [content, sourceStat] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    return {
      capability: "reference_projects",
      files: [
        {
          sourcePath: absolutePath,
          targetPath: "reference-project.json",
          content,
          mode: sourceStat.mode & 0o777
        }
      ]
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        capability: "reference_projects",
        files: []
      };
    }

    throw error;
  }
}

import path from "node:path";

import { z } from "zod";

import { DEFAULT_MANIFEST_PATH, MANIFEST_SCHEMA_VERSION } from "../constants.js";
import type { PlannedFile } from "../sync-types.js";

import { atomicWriteText, readTextIfExists, sha256 } from "./file-ops.js";
import { hashOwnedValues } from "./partial-json.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const manifestEntrySchema = z
  .object({
    path: z.string().trim().min(1),
    kind: z.enum(["full", "partial-json"]).optional(),
    sha256: hashSchema.optional(),
    owned_keys: z.array(z.string().trim().min(1)).optional(),
    owned_sha256: hashSchema.optional(),
    mode: z.number().int().min(0).max(0o777)
  })
  .strict()
  .superRefine((entry, context) => {
    const kind = entry.kind ?? "full";

    if (kind === "full") {
      if (!entry.sha256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Full manifest entries require sha256."
        });
      }

      if (entry.owned_keys || entry.owned_sha256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Full manifest entries cannot declare owned_keys or owned_sha256."
        });
      }

      return;
    }

    if (!entry.owned_keys || entry.owned_keys.length === 0 || !entry.owned_sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Partial JSON manifest entries require owned_keys and owned_sha256."
      });
    }

    if (entry.sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Partial JSON manifest entries cannot declare sha256."
      });
    }
  });

export const manifestSchema = z
  .object({
    schema_version: z.literal(MANIFEST_SCHEMA_VERSION),
    files: z.array(manifestEntrySchema)
  })
  .strict();

export type ManifestFile = z.infer<typeof manifestSchema>;
export type ManifestEntry = ManifestFile["files"][number];

function sortManifestEntries(manifest: ManifestFile): ManifestFile {
  return {
    schema_version: manifest.schema_version,
    files: [...manifest.files].sort((left, right) => left.path.localeCompare(right.path))
  };
}

export function getManifestPath(rootDir: string): string {
  return path.resolve(rootDir, DEFAULT_MANIFEST_PATH);
}

export async function loadManifest(rootDir: string): Promise<ManifestFile> {
  const source = await readTextIfExists(getManifestPath(rootDir));
  if (!source) {
    return {
      schema_version: MANIFEST_SCHEMA_VERSION,
      files: []
    };
  }

  return sortManifestEntries(manifestSchema.parse(JSON.parse(source)));
}

export async function saveManifest(rootDir: string, manifest: ManifestFile): Promise<void> {
  const serialized = `${JSON.stringify(sortManifestEntries(manifest), null, 2)}\n`;
  await atomicWriteText(getManifestPath(rootDir), serialized, 0o644);
}

export function createManifestFromPlan(plan: readonly PlannedFile[]): ManifestFile {
  return sortManifestEntries({
    schema_version: MANIFEST_SCHEMA_VERSION,
    files: plan.map((file) =>
      file.kind === "partial-json"
        ? {
            path: file.path,
            kind: "partial-json" as const,
            owned_keys: [...file.ownedKeys],
            owned_sha256: hashOwnedValues(file.ownedValues),
            mode: file.mode
          }
        : {
            path: file.path,
            sha256: sha256(file.content),
            mode: file.mode
          }
    )
  });
}

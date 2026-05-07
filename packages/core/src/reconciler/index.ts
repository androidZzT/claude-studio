import path from "node:path";

import { HarnessError } from "../errors.js";
import type { PlannedFile } from "../sync-types.js";

import { atomicWriteFile, readBytesIfExists, readModeIfExists, removeFileIfExists, sha256 } from "./file-ops.js";
import { createManifestFromPlan, loadManifest, saveManifest } from "./manifest.js";
import type { ManifestEntry } from "./manifest.js";
import { hashOwnedValues, mergeWrite, readJsonObjectIfExists, readPartial, removePartial } from "./partial-json.js";

export interface ReconcileEntry {
  readonly path: string;
  readonly reason: string;
}

export interface ReconcileResult {
  readonly added: ReconcileEntry[];
  readonly modified: ReconcileEntry[];
  readonly removed: ReconcileEntry[];
  readonly unchanged: ReconcileEntry[];
}

export interface ReconcileOptions {
  readonly dryRun: boolean;
  readonly rootDir?: string;
  readonly adoptPartialJsonOwnership?: boolean;
}

function createEmptyResult(): ReconcileResult {
  return {
    added: [],
    modified: [],
    removed: [],
    unchanged: []
  };
}

function getRootDir(plan: readonly PlannedFile[], rootDir?: string): string {
  if (rootDir) {
    return rootDir;
  }

  const plannedRoot = plan[0]?.rootDir;
  if (!plannedRoot) {
    throw new HarnessError("Cannot reconcile an empty plan without a root directory.", "RECONCILE_ROOT_REQUIRED");
  }

  return plannedRoot;
}

function assertUniquePaths(plan: readonly PlannedFile[]): void {
  const seenPaths = new Set<string>();

  for (const file of plan) {
    if (seenPaths.has(file.path)) {
      throw new HarnessError(`Duplicate planned file path: ${file.path}`, "RECONCILE_DUPLICATE_PATH");
    }

    seenPaths.add(file.path);
  }
}

function getModifiedReason(contentMatches: boolean, modeMatches: boolean): string {
  if (!contentMatches && !modeMatches) {
    return "content-and-mode-mismatch";
  }

  if (!contentMatches) {
    return "sha256-mismatch";
  }

  return "mode-mismatch";
}

async function classifyFile(
  file: PlannedFile,
  manifestEntry?: ManifestEntry
): Promise<{ bucket: keyof ReconcileResult; entry: ReconcileEntry }> {
  if (file.kind === "partial-json") {
    const existingMode = await readModeIfExists(file.absolutePath);
    if (existingMode === undefined) {
      return {
        bucket: "added",
        entry: {
          path: file.path,
          reason: "new"
        }
      };
    }

    const effectiveOwnedKeys = [...new Set([...(manifestEntry?.owned_keys ?? []), ...file.ownedKeys])].sort((left, right) =>
      left.localeCompare(right)
    );
    const existingOwnedSubset = await readPartial(file.absolutePath, effectiveOwnedKeys);
    const contentMatches = hashOwnedValues(existingOwnedSubset) === hashOwnedValues(file.ownedValues);
    const modeMatches = existingMode === file.mode;

    if (contentMatches && modeMatches) {
      return {
        bucket: "unchanged",
        entry: {
          path: file.path,
          reason: "sha256-match"
        }
      };
    }

    return {
      bucket: "modified",
      entry: {
        path: file.path,
        reason: getModifiedReason(contentMatches, modeMatches)
      }
    };
  }

  const existingContent = await readBytesIfExists(file.absolutePath);
  if (existingContent === undefined) {
    return {
      bucket: "added",
      entry: {
        path: file.path,
        reason: "new"
      }
    };
  }

  const existingMode = await readModeIfExists(file.absolutePath);
  const contentMatches = sha256(existingContent) === sha256(file.content);
  const modeMatches = existingMode === file.mode;

  if (contentMatches && modeMatches) {
    return {
      bucket: "unchanged",
      entry: {
        path: file.path,
        reason: "sha256-match"
      }
    };
  }

  return {
    bucket: "modified",
    entry: {
      path: file.path,
      reason: getModifiedReason(contentMatches, modeMatches)
    }
  };
}

function sortEntries(entries: readonly ReconcileEntry[]): ReconcileEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

async function assertPartialOwnershipSafe(
  plan: readonly PlannedFile[],
  manifestByPath: ReadonlyMap<string, ManifestEntry>,
  adoptPartialJsonOwnership: boolean
): Promise<void> {
  for (const file of plan) {
    if (file.kind !== "partial-json") {
      continue;
    }

    if (adoptPartialJsonOwnership) {
      continue;
    }

    const existingDocument = await readJsonObjectIfExists(file.absolutePath);
    if (!existingDocument) {
      continue;
    }

    const manifestEntry = manifestByPath.get(file.path);
    if (!manifestEntry) {
      throw new HarnessError(
        `${file.path} already exists and harness wants to manage keys (${file.ownedKeys.join(", ")}). Run with --adopt-settings to take ownership; existing values will be overwritten.`,
        "RECONCILE_PARTIAL_OWNERSHIP_CONFLICT"
      );
    }

    const protectedKeys = [...new Set([...(manifestEntry.owned_keys ?? []), ...file.ownedKeys])].sort((left, right) =>
      left.localeCompare(right)
    );
    const existingProtectedKeys = protectedKeys.filter((key) => key in existingDocument);
    if (existingProtectedKeys.length > 0) {
      continue;
    }

    throw new HarnessError(
      `${file.path} no longer contains harness-managed keys (${protectedKeys.join(", ")}). Run with --adopt-settings to take ownership again; existing values will be overwritten.`,
      "RECONCILE_PARTIAL_OWNERSHIP_CONFLICT"
    );
  }
}

async function applyWrites(
  planByPath: ReadonlyMap<string, PlannedFile>,
  manifestByPath: ReadonlyMap<string, ManifestEntry>,
  result: ReconcileResult,
  rootDir: string
): Promise<void> {
  for (const entry of [...result.added, ...result.modified]) {
    const file = planByPath.get(entry.path);
    if (!file) {
      throw new HarnessError(`Missing planned file for ${entry.path}`, "RECONCILE_MISSING_PLAN");
    }

    if (file.kind === "partial-json") {
      const cleanupKeys = [...new Set([...(manifestByPath.get(file.path)?.owned_keys ?? []), ...file.ownedKeys])].sort((left, right) =>
        left.localeCompare(right)
      );
      const existingMode = await readModeIfExists(file.absolutePath);
      const existingOwnedSubset = await readPartial(file.absolutePath, cleanupKeys);
      if (existingMode === file.mode && hashOwnedValues(existingOwnedSubset) === hashOwnedValues(file.ownedValues)) {
        continue;
      }
      await mergeWrite(file.absolutePath, cleanupKeys, file.ownedValues, file.mode);
      continue;
    }

    await atomicWriteFile(file.absolutePath, file.content, file.mode);
  }

  for (const entry of result.removed) {
    const manifestEntry = manifestByPath.get(entry.path);
    const absolutePath = path.resolve(rootDir, entry.path);

    if (manifestEntry?.kind === "partial-json") {
      await removePartial(absolutePath, manifestEntry.owned_keys ?? [], manifestEntry.mode);
      continue;
    }

    await removeFileIfExists(absolutePath);
  }
}

export async function reconcile(plan: PlannedFile[], options: ReconcileOptions): Promise<ReconcileResult> {
  assertUniquePaths(plan);

  const rootDir = getRootDir(plan, options.rootDir);
  const result = createEmptyResult();
  const manifest = await loadManifest(rootDir);
  const planByPath = new Map(plan.map((file) => [file.path, file]));
  const manifestByPath = new Map(manifest.files.map((file) => [file.path, file]));

  for (const manifestEntry of manifest.files) {
    if (!planByPath.has(manifestEntry.path)) {
      result.removed.push({
        path: manifestEntry.path,
        reason: "manifest-owned-not-planned"
      });
    }
  }

  for (const file of plan) {
    const classified = await classifyFile(file, manifestByPath.get(file.path));
    result[classified.bucket].push(classified.entry);
  }

  const sortedResult: ReconcileResult = {
    added: sortEntries(result.added),
    modified: sortEntries(result.modified),
    removed: sortEntries(result.removed),
    unchanged: sortEntries(result.unchanged)
  };

  if (!options.dryRun) {
    await assertPartialOwnershipSafe(plan, manifestByPath, options.adoptPartialJsonOwnership ?? false);
    await applyWrites(planByPath, manifestByPath, sortedResult, rootDir);
    await saveManifest(rootDir, createManifestFromPlan(plan));
  }

  return sortedResult;
}

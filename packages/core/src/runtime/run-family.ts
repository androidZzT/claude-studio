import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { RunStorePaths } from "./run-store.js";

export const runFamilyEntrySchema = z
  .object({
    run_id: z.string().min(1),
    run_root: z.string().min(1),
    status: z.string().optional(),
    thread_id: z.string().min(1),
  })
  .strict();

export const runFamilySchema = z
  .object({
    parent_run_id: z.string().min(1).optional(),
    run_id: z.string().min(1),
    runs: z.array(runFamilyEntrySchema),
    task_card_hash: z.string().min(1).optional(),
    thread_id: z.string().min(1),
  })
  .strict();

export type RunFamily = z.infer<typeof runFamilySchema>;
export type RunFamilyEntry = z.infer<typeof runFamilyEntrySchema>;

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function listRunRoots(runsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runsRoot, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readRunEntry(runRoot: string): Promise<RunFamilyEntry | undefined> {
  const metadata = (await readJsonIfExists(path.join(runRoot, "run.json"))) as
    | {
        readonly run_id?: string;
        readonly task_card_hash?: string;
        readonly thread_id?: string;
      }
    | undefined;
  if (!metadata?.run_id || !metadata.thread_id) {
    return undefined;
  }

  const state = (await readJsonIfExists(path.join(runRoot, "state.json"))) as
    | { readonly status?: string }
    | undefined;
  return {
    run_id: metadata.run_id,
    run_root: runRoot,
    ...(state?.status ? { status: state.status } : {}),
    thread_id: metadata.thread_id,
  };
}

export async function resolveRunFamily(options: {
  readonly paths: RunStorePaths;
  readonly taskCardHash?: string;
}): Promise<RunFamily> {
  const metadata = (await readJsonIfExists(
    path.join(options.paths.rootDir, "run.json"),
  )) as
    | {
        readonly parent_run_id?: string;
        readonly run_id?: string;
        readonly task_card_hash?: string;
        readonly thread_id?: string;
      }
    | undefined;
  const taskCardHash = options.taskCardHash ?? metadata?.task_card_hash;
  const runsRoot = path.dirname(options.paths.rootDir);
  const runRoots = await listRunRoots(runsRoot);
  const entries: RunFamilyEntry[] = [];

  for (const runRoot of runRoots) {
    const runMetadata = (await readJsonIfExists(path.join(runRoot, "run.json"))) as
      | { readonly task_card_hash?: string }
      | undefined;
    if (taskCardHash && runMetadata?.task_card_hash !== taskCardHash) {
      continue;
    }

    const entry = await readRunEntry(runRoot);
    if (entry) {
      entries.push(entry);
    }
  }

  const ownEntry =
    entries.find((entry) => entry.run_root === options.paths.rootDir) ??
    ({
      run_id: metadata?.run_id ?? path.basename(options.paths.rootDir),
      run_root: options.paths.rootDir,
      thread_id: metadata?.thread_id ?? path.basename(options.paths.rootDir),
    } satisfies RunFamilyEntry);

  const family: RunFamily = {
    ...(metadata?.parent_run_id ? { parent_run_id: metadata.parent_run_id } : {}),
    run_id: ownEntry.run_id,
    runs: entries.length > 0 ? entries : [ownEntry],
    ...(taskCardHash ? { task_card_hash: taskCardHash } : {}),
    thread_id: ownEntry.thread_id,
  };
  return runFamilySchema.parse(family);
}

export async function writeRunFamily(
  paths: RunStorePaths,
  family: RunFamily,
): Promise<void> {
  await mkdir(paths.rootDir, { recursive: true });
  await writeFile(
    path.join(paths.rootDir, "run-family.json"),
    `${JSON.stringify(runFamilySchema.parse(family), null, 2)}\n`,
    "utf8",
  );
}

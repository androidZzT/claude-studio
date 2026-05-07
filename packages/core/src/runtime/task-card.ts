import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { HarnessError } from "../errors.js";
import type { RunStorePaths } from "./run-store.js";

const portablePathPattern = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;

export const taskCardBudgetSchema = z
  .object({
    max_cost_usd: z.number().nonnegative().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_tool_calls: z.number().int().nonnegative().optional(),
    max_turns: z.number().int().positive().optional(),
    timeout_seconds: z.number().int().positive().optional(),
  })
  .strict();

export const taskCardSchema = z
  .object({
    acceptance_criteria: z.array(z.string().trim().min(1)).min(1),
    allowed_paths: z
      .array(z.string().trim().min(1).regex(portablePathPattern))
      .min(1),
    budget: taskCardBudgetSchema,
    context_paths: z.array(z.string().trim().min(1).regex(portablePathPattern)),
    denied_actions: z.array(z.string().trim().min(1)),
    goal: z.string().trim().min(1),
    human_review_required: z.boolean(),
    risk_level: z.enum(["low", "medium", "high"]),
    test_commands: z.array(z.string().trim().min(1)),
  })
  .strict();

export type TaskCard = z.infer<typeof taskCardSchema>;
export type TaskCardBudget = z.infer<typeof taskCardBudgetSchema>;

export interface LoadedTaskCard {
  readonly hash: string;
  readonly path: string;
  readonly taskCard: TaskCard;
}

function parseTaskCardSource(source: string, filePath: string): unknown {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    return YAML.parse(source);
  }

  return JSON.parse(source);
}

function canonicalTaskCardSource(taskCard: TaskCard): string {
  return `${JSON.stringify(taskCard, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function loadTaskCard(
  cwd: string,
  taskCardPath: string,
): Promise<LoadedTaskCard> {
  const resolvedPath = path.resolve(cwd, taskCardPath);
  const source = await readFile(resolvedPath, "utf8");
  const parsed = taskCardSchema.parse(parseTaskCardSource(source, resolvedPath));
  const canonicalSource = canonicalTaskCardSource(parsed);

  return {
    hash: sha256(canonicalSource),
    path: resolvedPath,
    taskCard: parsed,
  };
}

export async function readTaskCardFromRunStore(
  paths: RunStorePaths,
): Promise<LoadedTaskCard | undefined> {
  try {
    const source = await readFile(paths.taskCardPath, "utf8");
    const taskCard = taskCardSchema.parse(JSON.parse(source));
    const hash = (await readFile(paths.taskCardHashPath, "utf8")).trim();
    return {
      hash,
      path: paths.taskCardPath,
      taskCard,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function writeTaskCardArtifacts(
  paths: RunStorePaths,
  loaded: LoadedTaskCard,
): Promise<void> {
  await mkdir(paths.rootDir, { recursive: true });
  await Promise.all([
    writeFile(
      paths.taskCardPath,
      canonicalTaskCardSource(loaded.taskCard),
      "utf8",
    ),
    writeFile(paths.taskCardHashPath, `${loaded.hash}\n`, "utf8"),
  ]);
}

export function renderTaskCardPromptSection(
  loaded: LoadedTaskCard | undefined,
): string[] {
  if (!loaded) {
    return [
      "## TaskCard",
      "",
      "No TaskCard was provided. Follow the brief and phase spec only.",
      "",
    ];
  }

  return [
    "## TaskCard",
    "",
    `task_card_hash: ${loaded.hash}`,
    `goal: ${loaded.taskCard.goal}`,
    `risk_level: ${loaded.taskCard.risk_level}`,
    `human_review_required: ${loaded.taskCard.human_review_required}`,
    "",
    "### Acceptance Criteria",
    "",
    ...loaded.taskCard.acceptance_criteria.map((item) => `- ${item}`),
    "",
    "### Allowed Paths",
    "",
    ...loaded.taskCard.allowed_paths.map((item) => `- ${item}`),
    "",
    "### Denied Actions",
    "",
    ...loaded.taskCard.denied_actions.map((item) => `- ${item}`),
    "",
    "### Test Commands",
    "",
    ...loaded.taskCard.test_commands.map((item) => `- ${item}`),
    "",
    "### Budget",
    "",
    `\`\`\`json\n${JSON.stringify(loaded.taskCard.budget, null, 2)}\n\`\`\``,
    "",
  ];
}

export function assertTaskCardPathAllowed(
  taskCard: TaskCard,
  changedFile: string,
): void {
  if (!isPathAllowedByTaskCard(taskCard, changedFile)) {
    throw new HarnessError(
      `Changed file is outside TaskCard allowed_paths: ${changedFile}`,
      "TASK_CARD_CHANGED_FILE_OUT_OF_SCOPE",
    );
  }
}

export function isPathAllowedByTaskCard(
  taskCard: TaskCard,
  changedFile: string,
): boolean {
  const normalized = changedFile.split(path.sep).join("/").replace(/^\.?\//, "");
  return taskCard.allowed_paths.some((pattern) =>
    pathPatternMatches(pattern, normalized),
  );
}

export function pathPatternMatches(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.replace(/^\.?\//, "");
  if (
    normalizedPattern === "." ||
    normalizedPattern === "**" ||
    normalizedPattern === "**/*"
  ) {
    return true;
  }

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return value === prefix || value.startsWith(`${prefix}/`);
  }

  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -2);
    return value.startsWith(`${prefix}/`) && !value.slice(prefix.length + 1).includes("/");
  }

  return value === normalizedPattern || value.startsWith(`${normalizedPattern}/`);
}

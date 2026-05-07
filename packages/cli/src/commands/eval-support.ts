import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { simpleGit } from "simple-git";

import type { FunnelScore, QualityScoreInputs } from "@harness/core";

interface JsonObject {
  readonly [key: string]: unknown;
}

export interface EvalQualityInputPaths {
  readonly bugsPath?: string;
  readonly eventsPath?: string;
  readonly lintPath?: string;
  readonly repoPath?: string;
  readonly smokePath?: string;
}

type MutableQualityScoreInputs = {
  -readonly [Key in keyof QualityScoreInputs]?: QualityScoreInputs[Key];
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatScoreValue(value: number | null): string {
  if (value === null) {
    return "—";
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(4).replace(/\.?0+$/, "");
}

function countLines(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  let lines = 0;

  for (const byte of buffer) {
    if (byte === 10) {
      lines += 1;
    }
  }

  return buffer.at(-1) === 10 ? lines : lines + 1;
}

async function countTrackedLoc(repoPath: string): Promise<number> {
  const git = simpleGit(repoPath);
  const trackedFilesOutput = await git.raw(["ls-files", "-z"]);
  const trackedFiles = trackedFilesOutput
    .split("\u0000")
    .filter((filePath) => filePath.length > 0);

  let totalLoc = 0;

  for (const relativePath of trackedFiles) {
    totalLoc += countLines(await readFile(path.join(repoPath, relativePath)));
  }

  return totalLoc;
}

async function countMarkdownFiles(directoryPath: string): Promise<number> {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }

    throw error;
  }

  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
}

async function countTotalRules(repoPath: string): Promise<number> {
  const ruleCount = await countMarkdownFiles(path.join(repoPath, ".claude", "rules"));
  const adrCount = await countMarkdownFiles(path.join(repoPath, "architecture", "adr"));

  return ruleCount + adrCount;
}

function getLatestReviewEndWith(
  records: readonly JsonObject[],
  predicate: (record: JsonObject) => boolean
): JsonObject | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;

    if (predicate(record)) {
      return record;
    }
  }

  return undefined;
}

function extractReworkLines(record: JsonObject, aiProducedLines: number): number | undefined {
  const directValue = [
    record.rework_lines,
    record.reworkLines,
    record.loc_reworked,
    record.loc_modified,
    record.churn_lines
  ]
    .map((value) => readNumber(value))
    .find((value) => value !== undefined);

  if (directValue !== undefined) {
    return directValue;
  }

  const adoptionRate = readNumber(record.adoption_rate);
  return adoptionRate !== undefined ? aiProducedLines * (1 - adoptionRate) : undefined;
}

async function parseEventsInputs(eventsPath: string): Promise<QualityScoreInputs> {
  const source = await readFile(eventsPath, "utf8");
  const reviewEndRecords = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed = JSON.parse(line) as unknown;
      return isRecord(parsed) && parsed.event === "review_end" ? [parsed] : [];
    });

  const latestReviewForReviewRound = getLatestReviewEndWith(
    reviewEndRecords,
    (record) => (readNumber(record.review_round) ?? 0) > 0
  );
  const latestReviewForAdoption = getLatestReviewEndWith(reviewEndRecords, (record) => {
    const aiProducedLines = readNumber(record.loc_added);
    return aiProducedLines !== undefined && aiProducedLines > 0;
  });
  const qualityInputs: MutableQualityScoreInputs = {};

  const reviewRound = latestReviewForReviewRound ? readNumber(latestReviewForReviewRound.review_round) : undefined;
  if (reviewRound !== undefined && reviewRound > 0) {
    qualityInputs.reviewPassEfficiency = {
      reviewRound
    };
  }

  const reviewRoundRecords = reviewEndRecords.filter((record) => (readNumber(record.review_round) ?? 0) > 0);
  if (reviewRoundRecords.length > 0) {
    qualityInputs.firstPassRate = {
      firstPassPRs: reviewRoundRecords.filter((record) => readNumber(record.review_round) === 1).length,
      totalPRs: reviewRoundRecords.length
    };
  }

  const aiProducedLines = latestReviewForAdoption ? readNumber(latestReviewForAdoption.loc_added) : undefined;
  if (latestReviewForAdoption && aiProducedLines !== undefined && aiProducedLines > 0) {
    const reworkLines = extractReworkLines(latestReviewForAdoption, aiProducedLines);

    if (reworkLines !== undefined && reworkLines >= 0) {
      qualityInputs.adoptionRate = {
        aiProducedLines,
        reworkLines
      };
    }
  }

  return qualityInputs;
}

async function parseBugCount(bugsPath: string): Promise<number> {
  try {
    const source = await readFile(bugsPath, "utf8");
    return [...source.matchAll(/^(#{1,2})\s+\S+/gm)].length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

function findFirstNumericValue(root: unknown, keys: readonly string[]): number | undefined {
  if (!isRecord(root)) {
    return undefined;
  }

  for (const key of keys) {
    const value = readNumber(root[key]);
    if (value !== undefined) {
      return value;
    }
  }

  for (const value of Object.values(root)) {
    const nestedValue = findFirstNumericValue(value, keys);
    if (nestedValue !== undefined) {
      return nestedValue;
    }
  }

  return undefined;
}

async function parseLintInput(lintPath: string, repoPath: string): Promise<QualityScoreInputs> {
  const parsed = JSON.parse(await readFile(lintPath, "utf8")) as unknown;
  const violations =
    readNumber(isRecord(parsed) ? parsed.violations : undefined) ??
    findFirstNumericValue(parsed, ["violations", "total_violations"]);
  const totalRules = await countTotalRules(repoPath);

  if (violations === undefined) {
    return {};
  }

  return {
    techDesignConformance: {
      violations,
      totalRules
    }
  };
}

async function parseSmokeInput(smokePath: string): Promise<QualityScoreInputs> {
  const parsed = JSON.parse(await readFile(smokePath, "utf8")) as unknown;
  const smokePassed =
    readNumber(isRecord(parsed) ? parsed.passed : undefined) ??
    findFirstNumericValue(parsed, ["passed", "numPassedTests", "passCount"]);
  const smokeTotal =
    readNumber(isRecord(parsed) ? parsed.total : undefined) ??
    findFirstNumericValue(parsed, ["total", "numTotalTests", "testCount"]);

  if (smokePassed === undefined || smokeTotal === undefined) {
    return {};
  }

  return {
    smokePassRate: {
      smokePassed,
      smokeTotal
    }
  };
}

async function resolveInputOrWarn<T>(
  label: string,
  onWarning: (message: string) => void,
  resolver: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await resolver();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    onWarning(`Warning: Failed to parse ${label}; related metrics skipped. ${message}`);
    return undefined;
  }
}

export async function resolveQualityInputs(
  inputPaths: EvalQualityInputPaths,
  onWarning: (message: string) => void
): Promise<QualityScoreInputs> {
  const qualityInputs: MutableQualityScoreInputs = {};

  if (inputPaths.eventsPath) {
    const parsed = await resolveInputOrWarn("--events", onWarning, () => parseEventsInputs(inputPaths.eventsPath!));
    Object.assign(qualityInputs, parsed);
  }

  if (inputPaths.repoPath && inputPaths.bugsPath) {
    const totalLOC = await resolveInputOrWarn("--repo", onWarning, () => countTrackedLoc(inputPaths.repoPath!));
    const bugCount = await resolveInputOrWarn("--bugs", onWarning, () => parseBugCount(inputPaths.bugsPath!));

    if (totalLOC !== undefined && bugCount !== undefined) {
      qualityInputs.bugDensity = {
        bugCount,
        totalLOC
      };
    }
  }

  if (inputPaths.repoPath && inputPaths.lintPath) {
    const parsed = await resolveInputOrWarn("--lint", onWarning, () => parseLintInput(inputPaths.lintPath!, inputPaths.repoPath!));
    Object.assign(qualityInputs, parsed);
  }

  if (inputPaths.smokePath) {
    const parsed = await resolveInputOrWarn("--smoke", onWarning, () => parseSmokeInput(inputPaths.smokePath!));
    Object.assign(qualityInputs, parsed);
  }

  return qualityInputs;
}

export function renderFunnelScoreTable(score: FunnelScore): string[] {
  const labels = [
    "tech_design_conformance",
    "adoption_rate",
    "review_pass_efficiency",
    "first_pass_rate",
    "smoke_pass_rate",
    "bug_density",
    "n_turns",
    "n_toolcalls",
    "n_total_tokens",
    "time_to_first_token",
    "output_tokens_per_sec",
    "time_to_last_token"
  ];
  const width = Math.max(...labels.map((label) => label.length));

  return [
    `Funnel Score (schema_version=${score.schema_version})`,
    "Quality",
    `  ${"tech_design_conformance".padEnd(width)}  ${formatScoreValue(score.quality.tech_design_conformance)}`,
    `  ${"adoption_rate".padEnd(width)}  ${formatScoreValue(score.quality.adoption_rate)}`,
    `  ${"review_pass_efficiency".padEnd(width)}  ${formatScoreValue(score.quality.review_pass_efficiency)}`,
    `  ${"first_pass_rate".padEnd(width)}  ${formatScoreValue(score.quality.first_pass_rate)}`,
    `  ${"smoke_pass_rate".padEnd(width)}  ${formatScoreValue(score.quality.smoke_pass_rate)}`,
    `  ${"bug_density".padEnd(width)}  ${formatScoreValue(score.quality.bug_density)}`,
    "Performance",
    `  ${"n_turns".padEnd(width)}  ${formatScoreValue(score.performance.n_turns)}`,
    `  ${"n_toolcalls".padEnd(width)}  ${formatScoreValue(score.performance.n_toolcalls)}`,
    `  ${"n_total_tokens".padEnd(width)}  ${formatScoreValue(score.performance.n_total_tokens)}`,
    `  ${"time_to_first_token".padEnd(width)}  ${formatScoreValue(score.performance.time_to_first_token)}`,
    `  ${"output_tokens_per_sec".padEnd(width)}  ${formatScoreValue(score.performance.output_tokens_per_sec)}`,
    `  ${"time_to_last_token".padEnd(width)}  ${formatScoreValue(score.performance.time_to_last_token)}`
  ];
}

export function hasQualityInputs(inputPaths: EvalQualityInputPaths): boolean {
  return Boolean(
    inputPaths.eventsPath || inputPaths.bugsPath || inputPaths.repoPath || inputPaths.lintPath || inputPaths.smokePath
  );
}

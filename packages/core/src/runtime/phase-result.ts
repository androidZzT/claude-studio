import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { TaskCard } from "./task-card.js";
import { isPathAllowedByTaskCard } from "./task-card.js";
import type { PhaseExecutionResult, PhaseSpec } from "./phase-executor.js";
import type { RunStorePaths } from "./run-store.js";

export const phaseResultArtifactSchema = z
  .object({
    changed_files: z.array(z.string().trim().min(1)),
    commands_run: z.array(z.string().trim().min(1)),
    next_action: z.string().trim().min(1),
    risk_flags: z.array(z.string().trim().min(1)),
    status: z.enum(["OK", "FAILED", "BLOCKED", "NEEDS_REVIEW"]),
    summary: z.string().trim().min(1),
    tests: z.array(
      z.union([
        z.string().trim().min(1),
        z
          .object({
            command: z.string().trim().min(1),
            status: z.enum(["pass", "fail", "skipped"]),
          })
          .passthrough(),
      ]),
    ),
  })
  .strict();

export type PhaseResultArtifact = z.infer<typeof phaseResultArtifactSchema>;

export interface PhaseResultValidationFinding {
  readonly code: string;
  readonly message: string;
  readonly severity: "critical" | "warning";
}

export interface PhaseResultValidationReport {
  readonly critical_count: number;
  readonly findings: readonly PhaseResultValidationFinding[];
  readonly phase_id: string;
  readonly result_path: string;
  readonly status: "pass" | "critical";
  readonly synthesized: boolean;
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function hasNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function phaseDir(paths: RunStorePaths, phaseId: string): string {
  return path.join(paths.phasesDir, phaseId);
}

function resultPath(paths: RunStorePaths, phaseId: string): string {
  return path.join(phaseDir(paths, phaseId), "result.json");
}

function validationPath(paths: RunStorePaths, phaseId: string): string {
  return path.join(paths.validationDir, phaseId, "result-schema.json");
}

function outputPreview(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return "No phase output was captured.";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 480
    ? `${normalized.slice(0, 480)}...`
    : normalized;
}

function synthesizePhaseResult(
  phaseResult: PhaseExecutionResult,
  outputMd: string | undefined,
): PhaseResultArtifact {
  return {
    changed_files: [],
    commands_run: [],
    next_action:
      phaseResult.status === "completed" ? "continue" : "stop_and_review",
    risk_flags:
      phaseResult.status === "completed" ? [] : [phaseResult.reason ?? "failed"],
    status: phaseResult.status === "completed" ? "OK" : "FAILED",
    summary: outputPreview(outputMd),
    tests: [],
  };
}

function validateChangedFiles(
  artifact: PhaseResultArtifact,
  taskCard: TaskCard | undefined,
): PhaseResultValidationFinding[] {
  if (!taskCard) {
    return [];
  }

  return artifact.changed_files
    .filter((changedFile) => !isPathAllowedByTaskCard(taskCard, changedFile))
    .map((changedFile) => ({
      code: "changed_file_outside_allowed_paths",
      message: `changed_files contains an out-of-scope path: ${changedFile}`,
      severity: "critical" as const,
    }));
}

async function validateRequiredArtifacts(options: {
  readonly cwd: string;
  readonly requiredArtifacts: readonly string[] | undefined;
}): Promise<PhaseResultValidationFinding[]> {
  if (!options.requiredArtifacts || options.requiredArtifacts.length === 0) {
    return [];
  }

  const findings: PhaseResultValidationFinding[] = [];
  for (const artifactPath of options.requiredArtifacts) {
    const resolvedPath = path.resolve(options.cwd, artifactPath);
    const relative = path.relative(options.cwd, resolvedPath);
    const safe =
      relative !== "" &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative);
    if (!safe) {
      findings.push({
        code: "required_artifact_path_unsafe",
        message: `required_artifacts contains an unsafe path: ${artifactPath}`,
        severity: "critical",
      });
      continue;
    }

    if (!(await hasNonEmptyFile(resolvedPath))) {
      findings.push({
        code: "required_artifact_missing",
        message: `required artifact is missing or empty: ${artifactPath}`,
        severity: "critical",
      });
    }
  }

  return findings;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function validatePhaseResultArtifact(options: {
  readonly cwd: string;
  readonly paths: RunStorePaths;
  readonly phase: PhaseSpec;
  readonly phaseResult: PhaseExecutionResult;
  readonly taskCard?: TaskCard;
}): Promise<PhaseResultValidationReport> {
  const filePath = resultPath(options.paths, options.phase.phase_id);
  const outputMd = await readTextIfExists(options.phaseResult.output_path);
  const source = await readTextIfExists(filePath);
  let synthesized = false;
  let artifact: PhaseResultArtifact | undefined;
  const findings: PhaseResultValidationFinding[] = [];

  if (source === undefined) {
    artifact = synthesizePhaseResult(options.phaseResult, outputMd);
    synthesized = true;
    await writeJson(filePath, artifact);
    findings.push({
      code: "result_json_synthesized",
      message:
        "phase result.json was missing; runtime synthesized a minimal artifact from output.md",
      severity: "warning",
    });
  } else {
    const parsed = phaseResultArtifactSchema.safeParse(JSON.parse(source));
    if (!parsed.success) {
      findings.push({
        code: "result_json_invalid",
        message: parsed.error.message,
        severity: "critical",
      });
    } else {
      artifact = parsed.data;
    }
  }

  if (artifact) {
    findings.push(...validateChangedFiles(artifact, options.taskCard));
  }

  findings.push(
    ...(await validateRequiredArtifacts({
      cwd: options.cwd,
      requiredArtifacts: options.phase.required_artifacts,
    })),
  );

  const criticalCount = findings.filter(
    (finding) => finding.severity === "critical",
  ).length;
  const report: PhaseResultValidationReport = {
    critical_count: criticalCount,
    findings,
    phase_id: options.phase.phase_id,
    result_path: filePath,
    status: criticalCount > 0 ? "critical" : "pass",
    synthesized,
  };

  await writeJson(validationPath(options.paths, options.phase.phase_id), report);
  return report;
}

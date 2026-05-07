import { HarnessError, renderRunInspectionText } from "@harness/core";
import type {
  AutonomousDryRunReport,
  AutonomousRunReport,
  RunVisualizationResult,
} from "@harness/core";

import {
  ADAPTERS_HELP_TEXT,
  EVAL_HELP_TEXT,
  HELP_TEXT,
  INIT_HELP_TEXT,
  RUN_HELP_TEXT,
} from "./constants.js";
import type {
  AdoptResponse,
  HelpTopic,
  InitResponse,
  ReconcileResponse,
} from "./types.js";

export function formatDoctorLine(check: {
  readonly status: "pass" | "fail";
  readonly message: string;
  readonly installHint?: string;
}): string {
  const prefix = check.status === "pass" ? "[PASS]" : "[FAIL]";
  const hint = check.installHint ? ` | install: ${check.installHint}` : "";

  return `${prefix} ${check.message}${hint}`;
}

export function hasDrift(result: ReconcileResponse): boolean {
  return (
    result.added.length > 0 ||
    result.modified.length > 0 ||
    result.removed.length > 0
  );
}

function renderEntries(
  label: string,
  entries: readonly { readonly path: string; readonly reason: string }[],
): string[] {
  const lines = [`${label}: ${entries.length}`];

  for (const entry of entries) {
    lines.push(`  - ${entry.path} (${entry.reason})`);
  }

  return lines;
}

function renderFileList(label: string, files: readonly string[]): string[] {
  const lines = [`${label}: ${files.length}`];

  for (const filePath of files) {
    lines.push(`  - ${filePath}`);
  }

  return lines;
}

export function renderReconcileResult(
  command: "diff" | "sync",
  result: ReconcileResponse,
  dryRun: boolean,
): string[] {
  const lines: string[] = [];

  if (!hasDrift(result)) {
    lines.push(
      command === "diff" || dryRun
        ? "No drift detected."
        : "Sync completed with no changes.",
    );
  } else {
    lines.push(
      command === "diff" || dryRun ? "Drift detected." : "Sync completed.",
    );
  }

  lines.push(...renderEntries("Added", result.added));
  lines.push(...renderEntries("Modified", result.modified));
  lines.push(...renderEntries("Removed", result.removed));
  lines.push(...renderEntries("Unchanged", result.unchanged));
  return lines;
}

export function renderInitResult(result: InitResponse): string[] {
  return [
    `Initialized harness workspace in ${result.targetDir}`,
    ...renderFileList("Created", result.createdFiles),
    ...renderFileList("Skipped", result.skippedFiles),
  ];
}

export function renderAdoptResult(result: AdoptResponse): string[] {
  return [
    `${result.dryRun ? "Adopt plan prepared" : "Adopted harness workspace"} in ${result.targetDir}`,
    ...renderFileList("Created", result.createdFiles),
    ...renderFileList("Capabilities", result.detectedCapabilities),
    ...renderFileList("Skipped", result.skippedCapabilities),
    ...renderFileList("Warnings", result.warnings),
  ];
}

export function renderAutonomousDryRunReport(
  report: AutonomousDryRunReport,
): string[] {
  return [
    "Autonomous dry-run preflight",
    `Harness repo: ${report.harness_repo_path}`,
    `Config: ${report.config_path}`,
    `Skill: ${report.skill_path}`,
    ...(report.skill_name ? [`Skill name: ${report.skill_name}`] : []),
    ...(report.task_card_hash
      ? [`TaskCard hash: ${report.task_card_hash}`]
      : []),
    `Run root: ${report.run_root}`,
    "Required ignored paths:",
    ...report.required_ignored_paths.map(
      (entry) =>
        `  - ${entry.path} (${entry.ignored ? "ignored" : "not ignored"})`,
    ),
    "Phase graph:",
    ...report.phase_graph.map(renderDryRunPhaseLine),
    report.note,
  ];
}

function renderDryRunPhaseLine(
  phase: AutonomousDryRunReport["phase_graph"][number],
): string {
  const mode = phase.mode ? ` mode=${phase.mode}` : "";
  const parallelGroup = phase.parallel_group
    ? ` parallel_group=${phase.parallel_group}`
    : "";
  const profile = phase.profile ? ` profile=${phase.profile}` : "";
  const stallTimeout =
    phase.provider_stall_timeout_seconds !== undefined
      ? ` provider_stall_timeout_seconds=${phase.provider_stall_timeout_seconds}`
      : "";
  return `  - ${phase.phase_id} agent=${phase.agent} tool=${phase.tool}${profile}${mode} profile_resolved=${phase.profile_resolved} cwd_ref=${phase.cwd_ref} cwd=${phase.cwd}${parallelGroup} pre_gates=${phase.pre_phase_gate_command_count} gates=${phase.gate_command_count} audits=${phase.audit_count} audit_policy=${phase.audit_blocking_policy}${stallTimeout} trajectory=${phase.trajectory_capture}`;
}

export function renderRunVisualizationResult(
  result: RunVisualizationResult,
): string[] {
  return [
    `Run visualization: ${result.html_path}`,
    `Mermaid workflow: ${result.mermaid_path}`,
    ...renderRunInspectionText(result.report),
  ];
}

export function renderAutonomousRunReport(
  report: AutonomousRunReport,
): string[] {
  return [
    `Autonomous run ${report.status}`,
    `Thread: ${report.thread_id}`,
    `Run id: ${report.run_id}`,
    `Run root: ${report.run_root}`,
    `Skill: ${report.skill_path}`,
    ...(report.task_card_hash
      ? [`TaskCard hash: ${report.task_card_hash}`]
      : []),
    `Completed phases: ${report.completed_phase_count}`,
    ...(report.failed_reason ? [`Failed reason: ${report.failed_reason}`] : []),
    `Summary: ${report.summary_path}`,
    ...(report.visualization_html_path
      ? [`Visualization: ${report.visualization_html_path}`]
      : []),
  ];
}

export function getHelpText(topic?: HelpTopic): string {
  if (topic === "adapters") {
    return ADAPTERS_HELP_TEXT;
  }

  if (topic === "eval") {
    return EVAL_HELP_TEXT;
  }

  if (topic === "init") {
    return INIT_HELP_TEXT;
  }

  if (topic === "run") {
    return RUN_HELP_TEXT;
  }

  return HELP_TEXT;
}

export function getExitCodeForError(error: unknown): number {
  if (error instanceof HarnessError && error.code === "CLI_INVALID_COMMAND") {
    return 2;
  }

  return 1;
}

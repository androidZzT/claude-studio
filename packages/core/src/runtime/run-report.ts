import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  getDefaultRunRoot,
  getRunStorePaths,
  inspectRunLiveness,
} from "./run-store.js";
import type { RunStorePaths } from "./run-store.js";

const phaseSessionSchema = z
  .object({
    agent: z.string().optional(),
    audit_blocked: z.boolean().optional(),
    completed_at_iso: z.string().optional(),
    cwd: z.string().optional(),
    cwd_ref: z.string().optional(),
    mode: z.string().optional(),
    phase_id: z.string().optional(),
    profile: z.string().optional(),
    session_id: z.string().optional(),
    started_at_iso: z.string().optional(),
    status: z.string().optional(),
    tool: z.string().optional(),
    trajectory_status: z.string().optional(),
  })
  .passthrough();

const taskCardSummarySchema = z
  .object({
    acceptance_criteria: z.array(z.string()).optional(),
    allowed_paths: z.array(z.string()).optional(),
    goal: z.string().optional(),
    human_review_required: z.boolean().optional(),
    risk_level: z.string().optional(),
  })
  .passthrough();

const auditSummarySchema = z
  .object({
    audit_id: z.string(),
    blocked: z.boolean(),
    critical_count: z.number(),
    recommendation: z.string(),
    score: z.number(),
  })
  .passthrough();

const trajectorySummarySchema = z
  .object({
    event_count: z.number().optional(),
    final_output_preview: z.string().optional(),
    reason: z.string().optional(),
    status: z.string(),
    tool_call_count: z.number().optional(),
    total_tokens: z.number().optional(),
    usage_reliable: z.boolean().optional(),
  })
  .passthrough();

const phaseGraphEntrySchema = z
  .object({
    agent: z.string().optional(),
    cwd_ref: z.string().optional(),
    index: z.number().int().nonnegative(),
    mode: z.string().optional(),
    parallel_group: z.string().optional(),
    phase_id: z.string(),
    tool: z.string().optional(),
  })
  .passthrough();

const validationReportSchema = z
  .object({
    critical_count: z.number().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const runFamilySchema = z
  .object({
    runs: z
      .array(
        z
          .object({
            run_id: z.string(),
            run_root: z.string(),
            status: z.string().optional(),
            thread_id: z.string(),
          })
          .passthrough(),
      )
      .optional(),
    task_card_hash: z.string().optional(),
  })
  .passthrough();

export interface RunPhaseInspection {
  readonly agent?: string;
  readonly audit_blocked: boolean;
  readonly audits: readonly {
    readonly audit_id: string;
    readonly blocked: boolean;
    readonly critical_count: number;
    readonly recommendation: string;
    readonly score: number;
  }[];
  readonly cwd?: string;
  readonly duration_ms?: number;
  readonly exit_code?: number | null;
  readonly output_path?: string;
  readonly mode?: string;
  readonly parallel_group?: string;
  readonly partial_output_path?: string;
  readonly phase_id: string;
  readonly reason?: string;
  readonly session_id?: string;
  readonly status: string;
  readonly tool?: string;
  readonly trajectory?: {
    readonly event_count: number;
    readonly final_output_preview?: string;
    readonly reason?: string;
    readonly status: string;
    readonly tool_call_count: number;
    readonly total_tokens: number;
    readonly usage_reliable: boolean;
  };
  readonly validation?: {
    readonly budget_status?: string;
    readonly result_status?: string;
    readonly risk_status?: string;
  };
}

export interface RunInspectionReport {
  readonly events_count: number;
  readonly group_audits: readonly {
    readonly audit_id: string;
    readonly blocked: boolean;
    readonly critical_count: number;
    readonly group_id: string;
    readonly recommendation: string;
    readonly score: number;
  }[];
  readonly liveness: string;
  readonly phases: readonly RunPhaseInspection[];
  readonly run_family?: {
    readonly run_count: number;
    readonly task_card_hash?: string;
  };
  readonly run_root: string;
  readonly state?: unknown;
  readonly task_card?: {
    readonly goal?: string;
    readonly risk_level?: string;
    readonly human_review_required?: boolean;
  };
}

export interface RunVisualizationResult {
  readonly html_path: string;
  readonly mermaid_path: string;
  readonly report: RunInspectionReport;
}

export function resolveRunStorePathsForThread(
  harnessRepoPath: string,
  threadId: string,
  runRoot?: string,
): RunStorePaths {
  return getRunStorePaths(
    path.resolve(runRoot ?? getDefaultRunRoot(harnessRepoPath, threadId)),
  );
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

async function readJsonIfExists(
  filePath: string,
): Promise<unknown | undefined> {
  const source = await readTextIfExists(filePath);
  return source === undefined ? undefined : JSON.parse(source);
}

async function listDirectories(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function listJsonFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(directoryPath, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readAudits(
  paths: RunStorePaths,
  phaseId: string,
): Promise<RunPhaseInspection["audits"]> {
  const auditFiles = await listJsonFiles(path.join(paths.auditsDir, phaseId));
  const audits = await Promise.all(
    auditFiles.map(async (filePath) =>
      auditSummarySchema.parse(await readJsonIfExists(filePath)),
    ),
  );

  return audits.map((audit) => ({
    audit_id: audit.audit_id,
    blocked: audit.blocked,
    critical_count: audit.critical_count,
    recommendation: audit.recommendation,
    score: audit.score,
  }));
}

async function readPhaseInspection(
  paths: RunStorePaths,
  phaseId: string,
  phaseGraphEntry?: z.infer<typeof phaseGraphEntrySchema>,
): Promise<RunPhaseInspection> {
  const phaseDir = path.join(paths.phasesDir, phaseId);
  const session = phaseSessionSchema.parse(
    (await readJsonIfExists(path.join(phaseDir, "session.json"))) ?? {},
  );
  const exitCode = (await readJsonIfExists(
    path.join(phaseDir, "exit_code.json"),
  )) as
    | {
        readonly duration_ms?: number;
        readonly exit_code?: number | null;
        readonly output_path?: string;
        readonly partial_output_path?: string;
        readonly reason?: string;
        readonly status?: string;
      }
    | undefined;
  const trajectoryRaw = await readJsonIfExists(
    path.join(paths.trajectoryDir, phaseId, "summary.json"),
  );
  const trajectory = trajectoryRaw
    ? trajectorySummarySchema.parse(trajectoryRaw)
    : undefined;
  const audits = await readAudits(paths, phaseId);
  const resolvedMode = session.mode ?? phaseGraphEntry?.mode;
  const resultValidation = validationReportSchema.safeParse(
    await readJsonIfExists(
      path.join(paths.validationDir, phaseId, "result-schema.json"),
    ),
  );
  const budgetValidation = validationReportSchema.safeParse(
    await readJsonIfExists(path.join(paths.validationDir, phaseId, "budget.json")),
  );
  const riskValidation = validationReportSchema.safeParse(
    await readJsonIfExists(path.join(paths.validationDir, phaseId, "risk.json")),
  );

  return {
    ...(session.agent ? { agent: session.agent } : {}),
    audit_blocked:
      session.audit_blocked ?? audits.some((audit) => audit.blocked),
    audits,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(exitCode?.duration_ms !== undefined
      ? { duration_ms: exitCode.duration_ms }
      : {}),
    ...(exitCode && "exit_code" in exitCode
      ? { exit_code: exitCode.exit_code }
      : {}),
    ...(exitCode?.output_path ? { output_path: exitCode.output_path } : {}),
    ...(resolvedMode ? { mode: resolvedMode } : {}),
    ...(phaseGraphEntry?.parallel_group
      ? { parallel_group: phaseGraphEntry.parallel_group }
      : {}),
    ...(exitCode?.partial_output_path
      ? { partial_output_path: exitCode.partial_output_path }
      : {}),
    phase_id: phaseId,
    ...(exitCode?.reason ? { reason: exitCode.reason } : {}),
    ...(session.session_id ? { session_id: session.session_id } : {}),
    status: exitCode?.status ?? session.status ?? "unknown",
    ...(session.tool ? { tool: session.tool } : {}),
    ...(resultValidation.success ||
    budgetValidation.success ||
    riskValidation.success
      ? {
          validation: {
            ...(budgetValidation.success && budgetValidation.data.status
              ? { budget_status: budgetValidation.data.status }
              : {}),
            ...(resultValidation.success && resultValidation.data.status
              ? { result_status: resultValidation.data.status }
              : {}),
            ...(riskValidation.success && riskValidation.data.status
              ? { risk_status: riskValidation.data.status }
              : {}),
          },
        }
      : {}),
    ...(trajectory
      ? {
          trajectory: {
            event_count: trajectory.event_count ?? 0,
            ...(trajectory.final_output_preview
              ? { final_output_preview: trajectory.final_output_preview }
              : {}),
            ...(trajectory.reason ? { reason: trajectory.reason } : {}),
            status: trajectory.status,
            tool_call_count: trajectory.tool_call_count ?? 0,
            total_tokens: trajectory.total_tokens ?? 0,
            usage_reliable: trajectory.usage_reliable ?? true,
          },
        }
      : {}),
  };
}

async function countEventLines(eventsPath: string): Promise<number> {
  const source = await readTextIfExists(eventsPath);
  if (!source) {
    return 0;
  }

  return source.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

async function readPhaseGraph(
  paths: RunStorePaths,
): Promise<z.infer<typeof phaseGraphEntrySchema>[]> {
  const raw = await readJsonIfExists(
    path.join(paths.rootDir, "phase_graph.json"),
  );
  if (!raw) {
    return [];
  }

  return z
    .array(phaseGraphEntrySchema)
    .parse(raw)
    .sort((left, right) => left.index - right.index);
}

async function readGroupAudits(
  paths: RunStorePaths,
): Promise<RunInspectionReport["group_audits"]> {
  const groupsDir = path.join(paths.auditsDir, "_groups");
  let groups: string[];
  try {
    groups = await readdir(groupsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const audits: {
    readonly audit_id: string;
    readonly blocked: boolean;
    readonly critical_count: number;
    readonly group_id: string;
    readonly recommendation: string;
    readonly score: number;
  }[] = [];
  for (const groupId of groups.sort((left, right) =>
    left.localeCompare(right),
  )) {
    const files = await listJsonFiles(path.join(groupsDir, groupId));
    for (const file of files) {
      const audit = auditSummarySchema.parse(await readJsonIfExists(file));
      audits.push({
        audit_id: audit.audit_id,
        blocked: audit.blocked,
        critical_count: audit.critical_count,
        group_id: groupId,
        recommendation: audit.recommendation,
        score: audit.score,
      });
    }
  }

  return audits;
}

export async function inspectRunStore(
  paths: RunStorePaths,
): Promise<RunInspectionReport> {
  const phaseIds = await listDirectories(paths.phasesDir);
  const phaseGraph = await readPhaseGraph(paths);
  const phaseGraphOrder = phaseGraph.map((entry) => entry.phase_id);
  const phaseGraphById = new Map(
    phaseGraph.map((entry) => [entry.phase_id, entry] as const),
  );
  const orderedPhaseIds =
    phaseGraphOrder.length > 0
      ? [
          ...phaseGraphOrder.filter((phaseId) => phaseIds.includes(phaseId)),
          ...phaseIds.filter((phaseId) => !phaseGraphOrder.includes(phaseId)),
        ]
      : phaseIds;
  const phases = await Promise.all(
    orderedPhaseIds.map((phaseId) =>
      readPhaseInspection(paths, phaseId, phaseGraphById.get(phaseId)),
    ),
  );
  const liveness = await inspectRunLiveness(paths);
  const taskCardRaw = await readJsonIfExists(paths.taskCardPath);
  const taskCard = taskCardSummarySchema.safeParse(taskCardRaw);
  const runFamily = runFamilySchema.safeParse(
    await readJsonIfExists(path.join(paths.rootDir, "run-family.json")),
  );

  return {
    events_count: await countEventLines(paths.eventsPath),
    group_audits: await readGroupAudits(paths),
    liveness: liveness.liveness,
    phases,
    ...(runFamily.success
      ? {
          run_family: {
            run_count: runFamily.data.runs?.length ?? 0,
            ...(runFamily.data.task_card_hash
              ? { task_card_hash: runFamily.data.task_card_hash }
              : {}),
          },
        }
      : {}),
    run_root: paths.rootDir,
    ...(await readJsonIfExists(paths.statePath).then((state) =>
      state !== undefined ? { state } : {},
    )),
    ...(taskCard.success
      ? {
          task_card: {
            ...(taskCard.data.goal ? { goal: taskCard.data.goal } : {}),
            ...(taskCard.data.human_review_required !== undefined
              ? {
                  human_review_required:
                    taskCard.data.human_review_required,
                }
              : {}),
            ...(taskCard.data.risk_level
              ? { risk_level: taskCard.data.risk_level }
              : {}),
          },
        }
      : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nodeLabel(phase: RunPhaseInspection): string {
  const score = phase.audits[0]?.score;
  const scoreText = score === undefined ? "score n/a" : `score ${score}`;
  const trajectoryText = phase.trajectory
    ? `trajectory ${phase.trajectory.status}`
    : "trajectory n/a";
  const modeText = phase.mode ? `mode ${phase.mode}` : "mode n/a";
  return `${phase.phase_id}\\n${phase.status}\\n${modeText}\\n${scoreText}\\n${trajectoryText}`;
}

export function renderWorkflowMermaid(report: RunInspectionReport): string {
  const lines = ["flowchart TD"];

  for (const phase of report.phases) {
    const shape =
      phase.audit_blocked || phase.status !== "completed" ? "{{" : "[";
    const closeShape =
      phase.audit_blocked || phase.status !== "completed" ? "}}" : "]";
    lines.push(
      `  ${safeMermaidId(phase.phase_id)}${shape}"${nodeLabel(phase)}"${closeShape}`,
    );
  }

  const batches = collectMermaidBatches(report.phases);
  for (const batch of batches) {
    const groupId = batch[0]?.parallel_group;
    if (!groupId || batch.length < 2) {
      continue;
    }

    lines.push(`  subgraph G_${safeMermaidId(groupId)}["${groupId}"]`);
    for (const phase of batch) {
      lines.push(`    ${safeMermaidId(phase.phase_id)}`);
    }
    lines.push("  end");
  }

  for (let index = 0; index < batches.length - 1; index += 1) {
    const currentBatch = batches[index]!;
    const nextBatch = batches[index + 1]!;
    for (const current of currentBatch) {
      for (const next of nextBatch) {
        lines.push(
          `${safeMermaidId(current.phase_id)} --> ${safeMermaidId(next.phase_id)}`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function safeMermaidId(value: string): string {
  return `P_${value.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function collectMermaidBatches(
  phases: readonly RunPhaseInspection[],
): RunPhaseInspection[][] {
  const batches: RunPhaseInspection[][] = [];
  for (const phase of phases) {
    const lastBatch = batches.at(-1);
    const lastGroup = lastBatch?.[0]?.parallel_group;
    if (
      lastBatch &&
      phase.parallel_group &&
      lastGroup === phase.parallel_group
    ) {
      lastBatch.push(phase);
      continue;
    }

    batches.push([phase]);
  }

  return batches;
}

export function renderRunInspectionText(report: RunInspectionReport): string[] {
  const lines = [
    `Run root: ${report.run_root}`,
    `Liveness: ${report.liveness}`,
    `Events: ${report.events_count}`,
    ...(report.task_card?.goal
      ? [`TaskCard: ${report.task_card.goal}`]
      : []),
    ...(report.run_family
      ? [
          `Run family: ${report.run_family.run_count} run(s)${
            report.run_family.task_card_hash
              ? ` hash=${report.run_family.task_card_hash}`
              : ""
          }`,
        ]
      : []),
    "Phases:",
  ];
  for (const phase of report.phases) {
    const audit = phase.audits[0];
    const score = audit
      ? ` score=${audit.score} critical=${audit.critical_count} blocked=${audit.blocked}`
      : " score=n/a";
    const trajectory = phase.trajectory
      ? ` trajectory=${phase.trajectory.status} events=${phase.trajectory.event_count}`
      : " trajectory=n/a";
    const validation = phase.validation
      ? ` validation=${phase.validation.result_status ?? "n/a"}/${phase.validation.budget_status ?? "n/a"}/${phase.validation.risk_status ?? "n/a"}`
      : "";
    lines.push(
      `  - ${phase.phase_id} status=${phase.status}${phase.mode ? ` mode=${phase.mode}` : ""}${phase.reason ? ` reason=${phase.reason}` : ""}${score}${trajectory}${validation}`,
    );
  }
  if (report.group_audits.length > 0) {
    lines.push("Group audits:");
    for (const audit of report.group_audits) {
      lines.push(
        `  - ${audit.group_id}/${audit.audit_id} score=${audit.score} critical=${audit.critical_count} blocked=${audit.blocked}`,
      );
    }
  }

  return lines;
}

export function renderRunHtml(
  report: RunInspectionReport,
  mermaid: string,
): string {
  const phaseRows = report.phases
    .map((phase) => {
      const audit = phase.audits[0];
      return [
        "<tr>",
        `<td>${escapeHtml(phase.phase_id)}</td>`,
        `<td>${escapeHtml(phase.agent ?? "")}</td>`,
        `<td>${escapeHtml(phase.tool ?? "")}</td>`,
        `<td>${escapeHtml(phase.mode ?? "")}</td>`,
        `<td>${escapeHtml(phase.status)}</td>`,
        `<td>${escapeHtml(phase.reason ?? "")}</td>`,
        `<td>${audit ? escapeHtml(String(audit.score)) : ""}</td>`,
        `<td>${audit ? escapeHtml(String(audit.critical_count)) : ""}</td>`,
        `<td>${phase.trajectory ? escapeHtml(phase.trajectory.status) : ""}</td>`,
        `<td>${phase.trajectory ? escapeHtml(String(phase.trajectory.tool_call_count)) : ""}</td>`,
        `<td>${phase.trajectory ? escapeHtml(String(phase.trajectory.total_tokens)) : ""}</td>`,
        `<td>${phase.trajectory ? escapeHtml(String(phase.trajectory.usage_reliable)) : ""}</td>`,
        `<td>${escapeHtml(phase.validation?.result_status ?? "")}</td>`,
        `<td>${escapeHtml(phase.validation?.budget_status ?? "")}</td>`,
        `<td>${escapeHtml(phase.validation?.risk_status ?? "")}</td>`,
        `<td>${phase.partial_output_path ? escapeHtml(phase.partial_output_path) : ""}</td>`,
        `<td>${phase.trajectory?.final_output_preview ? escapeHtml(phase.trajectory.final_output_preview) : ""}</td>`,
        "</tr>",
      ].join("");
    })
    .join("\n");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Harness Run Report</title>",
    "<style>",
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:24px;line-height:1.45;color:#1f2937;background:#fafafa}",
    "table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top}th{background:#f3f4f6}",
    "pre{background:#111827;color:#f9fafb;padding:16px;overflow:auto}section{margin:24px 0}",
    "</style>",
    '<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"; mermaid.initialize({startOnLoad:true});</script>',
    "</head>",
    "<body>",
    "<h1>Harness Run Report</h1>",
    `<p><strong>Run root:</strong> ${escapeHtml(report.run_root)} · <strong>Events:</strong> ${report.events_count}</p>`,
    `<p><strong>Liveness:</strong> ${escapeHtml(report.liveness)}</p>`,
    ...(report.task_card
      ? [
          "<section><h2>TaskCard</h2>",
          `<p><strong>Goal:</strong> ${escapeHtml(report.task_card.goal ?? "")}</p>`,
          `<p><strong>Risk:</strong> ${escapeHtml(report.task_card.risk_level ?? "")} · <strong>Human review:</strong> ${escapeHtml(String(report.task_card.human_review_required ?? ""))}</p>`,
          "</section>",
        ]
      : []),
    ...(report.run_family
      ? [
          "<section><h2>Run Family</h2>",
          `<p><strong>Runs:</strong> ${report.run_family.run_count} · <strong>TaskCard hash:</strong> ${escapeHtml(report.run_family.task_card_hash ?? "")}</p>`,
          "</section>",
        ]
      : []),
    "<section><h2>Workflow</h2>",
    `<pre class="mermaid">${escapeHtml(mermaid)}</pre>`,
    "</section>",
    "<section><h2>Phases</h2>",
    "<table><thead><tr><th>phase</th><th>agent</th><th>tool</th><th>mode</th><th>status</th><th>reason</th><th>score</th><th>critical</th><th>trajectory</th><th>tools</th><th>tokens</th><th>usage reliable</th><th>result</th><th>budget</th><th>risk</th><th>partial output</th><th>final output preview</th></tr></thead>",
    `<tbody>${phaseRows}</tbody></table>`,
    "</section>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export async function generateRunVisualization(
  paths: RunStorePaths,
): Promise<RunVisualizationResult> {
  const report = await inspectRunStore(paths);
  const mermaid = renderWorkflowMermaid(report);
  const mermaidPath = path.join(paths.visualizationDir, "workflow.mmd");
  const htmlPath = path.join(paths.visualizationDir, "run.html");
  await mkdir(paths.visualizationDir, { recursive: true });
  await Promise.all([
    writeFile(mermaidPath, mermaid, "utf8"),
    writeFile(htmlPath, renderRunHtml(report, mermaid), "utf8"),
  ]);

  return {
    html_path: htmlPath,
    mermaid_path: mermaidPath,
    report,
  };
}

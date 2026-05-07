import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { parseWorkflowDocument } from './workflow-document';

export type VisualNodeStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'skipped';

export type VisualWorkflowSource = 'harness-run' | 'workflow-md' | 'skill-phases';

export interface PhaseTrajectorySummary {
  readonly phase_id?: string;
  readonly session_id?: string;
  readonly source?: string;
  readonly status?: string;
  readonly event_count?: number;
  readonly user_prompt_count?: number;
  readonly assistant_message_count?: number;
  readonly tool_call_count?: number;
  readonly tool_result_count?: number;
  readonly skill_use_count?: number;
  readonly total_tokens?: number;
  readonly final_output_preview?: string;
  readonly common_events_path?: string;
  readonly normalized_events_path?: string;
  readonly raw_path?: string;
  readonly [key: string]: unknown;
}

export interface VisualWorkflowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type?: 'dispatch' | 'parallel' | 'derived';
}

export interface VisualWorkflowValidationSummary {
  readonly resultStatus?: string;
  readonly budgetStatus?: string;
  readonly riskStatus?: string;
}

export interface VisualWorkflowRunFamilySummary {
  readonly runCount: number;
  readonly taskCardHash?: string;
}

export interface VisualWorkflowNode {
  readonly id: string;
  readonly label: string;
  readonly agent?: string;
  readonly tool?: string;
  readonly task?: string;
  readonly status: VisualNodeStatus;
  readonly mode?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly error?: string;
  readonly reason?: string;
  readonly providerStallDetail?: string;
  readonly promptSha256?: string;
  readonly taskCardHash?: string;
  readonly cwd?: string;
  readonly cwdRef?: string;
  readonly profile?: string;
  readonly parallelGroup?: string;
  readonly checkpoint?: boolean;
  readonly sessionId?: string;
  readonly exitCode?: number;
  readonly auditBlocked?: boolean;
  readonly trajectoryStatus?: string;
  readonly promptPath?: string;
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
  readonly outputPath?: string;
  readonly partialOutputPath?: string;
  readonly resultPath?: string;
  readonly costPath?: string;
  readonly sessionPath?: string;
  readonly exitCodePath?: string;
  readonly validationResultPath?: string;
  readonly validationBudgetPath?: string;
  readonly validationRiskPath?: string;
  readonly rollbackPath?: string;
  readonly rollbackBaselinePath?: string;
  readonly trajectoryEventsPath?: string;
  readonly trajectorySummaryPath?: string;
  readonly trajectorySummary?: PhaseTrajectorySummary;
  readonly validation?: VisualWorkflowValidationSummary;
  readonly requiredArtifacts?: readonly string[];
  readonly trajectoryCapture?: boolean;
}

export interface VisualWorkflowRun {
  readonly runId: string;
  readonly runRoot: string;
  readonly source: VisualWorkflowSource;
  readonly status: VisualNodeStatus;
  readonly nodes: readonly VisualWorkflowNode[];
  readonly edges: readonly VisualWorkflowEdge[];
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt?: string;
  readonly definitionPath?: string;
  readonly summaryPath?: string;
  readonly taskCardPath?: string;
  readonly taskCardHashPath?: string;
  readonly runFamilyPath?: string;
  readonly runFamily?: VisualWorkflowRunFamilySummary;
}

export interface VisualWorkflowRunSummary {
  readonly runId: string;
  readonly runRoot: string;
  readonly source: VisualWorkflowSource;
  readonly status: VisualNodeStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt?: string;
  readonly nodeCount: number;
  readonly failedNodeCount: number;
  readonly runningNodeCount: number;
  readonly definitionPath?: string;
}

export interface VisualRunArtifact {
  readonly kind: string;
  readonly path?: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly sizeBytes: number;
}

export type VisualTraceEventKind =
  | 'user_prompt'
  | 'assistant_message'
  | 'skill_use'
  | 'tool_call'
  | 'tool_result'
  | 'tokens'
  | 'final_output'
  | 'lifecycle'
  | 'error';

export interface VisualTraceEvent {
  readonly event_id?: string;
  readonly phase_id?: string;
  readonly sequence?: number;
  readonly session_id?: string;
  readonly source?: string;
  readonly timestamp?: string;
  readonly kind: VisualTraceEventKind | string;
  readonly name?: string;
  readonly text?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly tokens?: number;
  readonly error?: string;
}

export interface VisualTraceResult {
  readonly phaseId: string;
  readonly path?: string;
  readonly events: readonly VisualTraceEvent[];
  readonly truncated: boolean;
  readonly missing: boolean;
}

interface RunEvent {
  readonly ts?: string;
  readonly kind?: string;
  readonly phase_id?: string;
  readonly payload?: Record<string, unknown>;
}

interface PhaseStaticSpec {
  readonly id: string;
  readonly agent?: string;
  readonly tool?: string;
  readonly task?: string;
  readonly cwdRef?: string;
  readonly profile?: string;
  readonly parallelGroup?: string;
  readonly mode?: string;
  readonly checkpoint?: boolean;
  readonly dependsOn?: readonly string[];
  readonly requiredArtifacts?: readonly string[];
  readonly trajectoryCapture?: boolean;
}

interface StaticWorkflowSpec {
  readonly source: VisualWorkflowSource;
  readonly definitionPath?: string;
  readonly nodes: readonly PhaseStaticSpec[];
  readonly edges: readonly VisualWorkflowEdge[];
}

interface PhaseRuntimeState {
  id: string;
  status?: VisualNodeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  agent?: string;
  tool?: string;
  mode?: string;
  cwd?: string;
  cwdRef?: string;
  profile?: string;
  sessionId?: string;
  exitCode?: number;
  auditBlocked?: boolean;
  trajectoryStatus?: string;
  error?: string;
  reason?: string;
}

const ARTIFACT_FILE_NAMES: Record<string, string> = {
  prompt: 'prompt.md',
  stdout: 'stdout.log',
  stderr: 'stderr.log',
  output: 'output.md',
  partial: 'partial-output.md',
  result: 'result.json',
  cost: 'cost.json',
  session: 'session.json',
  exit: 'exit_code.json',
  trajectory: 'trajectory.json',
};

const TEXT_PREVIEW_LIMIT = 6_000;

export async function readVisualWorkflowRuns(projectPath: string): Promise<readonly VisualWorkflowRunSummary[]> {
  const runRoots = await listRunRoots(projectPath);
  const summaries = await Promise.all(
    runRoots.map(async ({ runId, runRoot }) => readRunSummary(runId, runRoot).catch(() => null)),
  );
  return summaries
    .filter((summary): summary is VisualWorkflowRunSummary => summary !== null)
    .sort((a, b) => compareDateDesc(a.startedAt ?? a.updatedAt, b.startedAt ?? b.updatedAt));
}

export async function readVisualWorkflowRun(projectPath: string, runId: string): Promise<VisualWorkflowRun> {
  const runRoot = await resolveRunRoot(projectPath, runId);
  const [state, runJson, events, runStat] = await Promise.all([
    readJsonObject(path.join(runRoot, 'state.json')),
    readJsonObject(path.join(runRoot, 'run.json')),
    readJsonl(path.join(runRoot, 'events.jsonl')),
    fs.stat(runRoot),
  ]);

  const definitionPath = asString(runJson.skill_path) ?? asString(runJson.workflow_path);
  const [phaseGraphSpec, definitionSpec] = await Promise.all([
    readPhaseGraphSpec(runRoot),
    definitionPath ? readStaticSpec(definitionPath).catch(() => null) : Promise.resolve(null),
  ]);
  const staticSpec = phaseGraphSpec ?? definitionSpec;
  const phaseIds = await collectPhaseIds(runRoot, events, staticSpec);
  const runtimeById = buildRuntimeState(events);

  const nodes = await Promise.all(
    phaseIds.map((phaseId) => buildVisualNode(runRoot, phaseId, runtimeById.get(phaseId), staticSpec)),
  );

  const edges = await readPhaseGraphEdges(runRoot, phaseIds)
    ?? staticSpec?.edges
    ?? deriveEdgesFromEvents(events)
    ?? deriveSequentialEdges(phaseIds.map((id) => [id]));

  const status = mapRunStatus(asString(state.status), nodes);
  const startedAt = asString(state.started_at_iso) ?? minDate(nodes.map((node) => node.startedAt));
  const completedAt = asString(state.completed_at_iso) ?? maxDate(nodes.map((node) => node.completedAt));
  const [summaryPath, taskCardPath, taskCardHashPath, runFamilyPath, runFamily] = await Promise.all([
    existingPath(path.join(runRoot, 'summary.md')),
    existingPath(path.join(runRoot, 'task-card.json')),
    existingPath(path.join(runRoot, 'task-card.sha256')),
    existingPath(path.join(runRoot, 'run-family.json')),
    readRunFamilySummary(runRoot),
  ]);

  return {
    runId,
    runRoot,
    source: 'harness-run',
    status,
    nodes,
    edges: edges.filter((edge) => phaseIds.includes(edge.source) && phaseIds.includes(edge.target)),
    startedAt,
    completedAt,
    updatedAt: runStat.mtime.toISOString(),
    definitionPath: definitionSpec?.definitionPath ?? definitionPath ?? staticSpec?.definitionPath,
    summaryPath,
    taskCardPath,
    taskCardHashPath,
    runFamilyPath,
    runFamily,
  };
}

export async function readStaticSkillVisualWorkflow(skillPath: string): Promise<VisualWorkflowRun | null> {
  const spec = await readSkillPhaseSpec(skillPath);
  if (!spec) return null;
  const stat = await fs.stat(skillPath).catch(() => null);
  return {
    runId: path.basename(path.dirname(skillPath)),
    runRoot: path.dirname(skillPath),
    source: 'skill-phases',
    status: 'pending',
    nodes: spec.nodes.map((node) => ({
      id: node.id,
      label: node.id,
      agent: node.agent,
      tool: node.tool,
      task: node.task,
      status: 'pending',
      mode: node.mode,
      cwdRef: node.cwdRef,
      profile: node.profile,
      parallelGroup: node.parallelGroup,
      checkpoint: node.checkpoint,
      requiredArtifacts: node.requiredArtifacts,
      trajectoryCapture: node.trajectoryCapture,
    })),
    edges: spec.edges,
    updatedAt: stat?.mtime.toISOString(),
    definitionPath: skillPath,
  };
}

export async function readStaticWorkflowVisualWorkflow(workflowPath: string): Promise<VisualWorkflowRun | null> {
  const content = await fs.readFile(workflowPath, 'utf-8');
  const parsed = parseWorkflowDocument(content);
  if (!parsed) return null;
  const nodes = parsed.nodes.map((node) => ({
    id: node.id,
    label: node.id,
    agent: node.agent,
    task: node.task,
    status: 'pending' as const,
    checkpoint: node.checkpoint,
  }));
  const edges = parsed.nodes.flatMap((node) =>
    (node.depends_on ?? []).map((dep) => ({
      id: `dispatch:${dep}->${node.id}`,
      source: dep,
      target: node.id,
      type: 'dispatch' as const,
    })),
  );
  const stat = await fs.stat(workflowPath).catch(() => null);
  return {
    runId: parsed.name ?? path.basename(workflowPath, path.extname(workflowPath)),
    runRoot: path.dirname(workflowPath),
    source: 'workflow-md',
    status: 'pending',
    nodes,
    edges,
    updatedAt: stat?.mtime.toISOString(),
    definitionPath: workflowPath,
  };
}

export async function readVisualRunArtifact(
  projectPath: string,
  runId: string,
  phaseId: string | undefined,
  kind: string,
  maxBytes = 96_000,
): Promise<VisualRunArtifact> {
  const runRoot = await resolveRunRoot(projectPath, runId);
  const filePath = resolveArtifactPath(runRoot, phaseId, kind);
  if (!filePath || !isPathWithin(runRoot, filePath) || !(await fileExists(filePath))) {
    return { kind, content: '', truncated: false, sizeBytes: 0 };
  }

  const stat = await fs.stat(filePath);
  const sizeBytes = stat.size;
  const handle = await fs.open(filePath, 'r');
  try {
    const bytesToRead = Math.min(sizeBytes, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, 0);
    return {
      kind,
      path: filePath,
      content: buffer.toString('utf-8'),
      truncated: sizeBytes > maxBytes,
      sizeBytes,
    };
  } finally {
    await handle.close();
  }
}

export async function readVisualRunTrace(
  projectPath: string,
  runId: string,
  phaseId: string,
  maxEvents = 500,
): Promise<VisualTraceResult> {
  const runRoot = await resolveRunRoot(projectPath, runId);
  const eventsPath = path.join(runRoot, 'trajectory', phaseId, 'events.jsonl');
  if (!isPathWithin(runRoot, eventsPath) || !(await fileExists(eventsPath))) {
    return { phaseId, events: [], truncated: false, missing: true };
  }

  const rawEvents = await readJsonl(eventsPath);
  const visible = rawEvents
    .map((event) => normalizeTraceEvent(event))
    .filter((event): event is VisualTraceEvent => event !== null);
  return {
    phaseId,
    path: eventsPath,
    events: visible.slice(0, maxEvents),
    truncated: visible.length > maxEvents,
    missing: false,
  };
}

async function readRunSummary(runId: string, runRoot: string): Promise<VisualWorkflowRunSummary> {
  const [state, runJson, events, stat] = await Promise.all([
    readJsonObject(path.join(runRoot, 'state.json')),
    readJsonObject(path.join(runRoot, 'run.json')),
    readJsonl(path.join(runRoot, 'events.jsonl')),
    fs.stat(runRoot),
  ]);
  const definitionPath = asString(runJson.skill_path) ?? asString(runJson.workflow_path);
  const [phaseGraphSpec, definitionSpec] = await Promise.all([
    readPhaseGraphSpec(runRoot),
    definitionPath ? readStaticSpec(definitionPath).catch(() => null) : Promise.resolve(null),
  ]);
  const staticSpec = phaseGraphSpec ?? definitionSpec;
  const runtimeById = buildRuntimeState(events);
  const phaseDirs = await listPhaseDirs(runRoot);
  const nodeIds = new Set<string>([
    ...(staticSpec?.nodes.map((node) => node.id) ?? []),
    ...runtimeById.keys(),
    ...phaseDirs,
  ]);
  const statuses = Array.from(nodeIds).map((id) => runtimeById.get(id)?.status ?? 'pending');
  return {
    runId,
    runRoot,
    source: 'harness-run',
    status: mapRunStatus(asString(state.status), statuses.map((status, index) => ({
      id: String(index),
      label: String(index),
      status,
    }))),
    startedAt: asString(state.started_at_iso),
    completedAt: asString(state.completed_at_iso),
    updatedAt: stat.mtime.toISOString(),
    nodeCount: nodeIds.size,
    failedNodeCount: statuses.filter((status) => status === 'failed' || status === 'blocked').length,
    runningNodeCount: statuses.filter((status) => status === 'running' || status === 'queued').length,
    definitionPath: definitionSpec?.definitionPath ?? definitionPath ?? staticSpec?.definitionPath,
  };
}

async function buildVisualNode(
  runRoot: string,
  phaseId: string,
  runtime: PhaseRuntimeState | undefined,
  staticSpec: StaticWorkflowSpec | null,
): Promise<VisualWorkflowNode> {
  const staticNode = staticSpec?.nodes.find((node) => node.id === phaseId);
  const phaseRoot = path.join(runRoot, 'phases', phaseId);
  const trajectoryRoot = path.join(runRoot, 'trajectory', phaseId);
  const validationRoot = path.join(runRoot, 'validation', phaseId);
  const rollbackRoot = path.join(runRoot, 'rollback', phaseId);
  const [session, exitCode, trajectorySummary, validation] = await Promise.all([
    readJsonObject(path.join(phaseRoot, 'session.json')),
    readJsonObject(path.join(phaseRoot, 'exit_code.json')),
    readTrajectorySummary(runRoot, phaseId),
    readValidationSummary(runRoot, phaseId),
  ]);

  const auditBlocked = asBoolean(exitCode.audit_blocked) ?? runtime?.auditBlocked;
  const status = mapPhaseStatus(
    asString(exitCode.status) ?? asString(session.status) ?? runtime?.status,
    asNumber(exitCode.exit_code) ?? runtime?.exitCode,
    auditBlocked,
  );

  const stderrPath = await existingPath(path.join(phaseRoot, 'stderr.log'));
  const error = status === 'failed' || status === 'blocked'
    ? await readErrorPreview(stderrPath)
    : undefined;

  return {
    id: phaseId,
    label: phaseId,
    agent: asString(session.agent) ?? runtime?.agent ?? staticNode?.agent,
    tool: asString(session.tool) ?? runtime?.tool ?? staticNode?.tool,
    task: staticNode?.task,
    status,
    mode: asString(session.mode) ?? runtime?.mode ?? staticNode?.mode,
    startedAt: asString(session.started_at_iso) ?? runtime?.startedAt,
    completedAt: asString(session.completed_at_iso) ?? runtime?.completedAt,
    durationMs: asNumber(exitCode.duration_ms) ?? runtime?.durationMs,
    error,
    reason: asString(exitCode.reason) ?? runtime?.reason,
    providerStallDetail: asString(exitCode.provider_stall_detail) ?? asString(session.provider_stall_detail),
    promptSha256: asString(exitCode.prompt_sha256) ?? asString(session.prompt_sha256),
    taskCardHash: asString(session.task_card_hash),
    cwd: asString(session.cwd) ?? asString(exitCode.cwd) ?? runtime?.cwd,
    cwdRef: asString(session.cwd_ref) ?? runtime?.cwdRef ?? staticNode?.cwdRef,
    profile: asString(session.profile) ?? runtime?.profile ?? staticNode?.profile,
    parallelGroup: staticNode?.parallelGroup,
    checkpoint: staticNode?.checkpoint,
    sessionId: asString(session.session_id) ?? asString(exitCode.session_id) ?? runtime?.sessionId,
    exitCode: asNumber(exitCode.exit_code) ?? runtime?.exitCode,
    auditBlocked,
    trajectoryStatus: asString(session.trajectory_status) ?? asString(exitCode.trajectory_status) ?? runtime?.trajectoryStatus ?? trajectorySummary?.status,
    promptPath: await existingPath(path.join(phaseRoot, 'prompt.md')),
    stdoutPath: await existingPath(path.join(phaseRoot, 'stdout.log')),
    stderrPath,
    outputPath: await existingPath(path.join(phaseRoot, 'output.md')),
    partialOutputPath: await existingPath(path.join(phaseRoot, 'partial-output.md')),
    resultPath: await existingPath(path.join(phaseRoot, 'result.json')),
    costPath: await existingPath(path.join(phaseRoot, 'cost.json')),
    sessionPath: await existingPath(path.join(phaseRoot, 'session.json')),
    exitCodePath: await existingPath(path.join(phaseRoot, 'exit_code.json')),
    validationResultPath: await existingPath(path.join(validationRoot, 'result-schema.json')),
    validationBudgetPath: await existingPath(path.join(validationRoot, 'budget.json')),
    validationRiskPath: await existingPath(path.join(validationRoot, 'risk.json')),
    rollbackPath: await existingPath(path.join(rollbackRoot, 'rollback.md')),
    rollbackBaselinePath: await existingPath(path.join(rollbackRoot, 'baseline.diff')),
    trajectoryEventsPath: await existingPath(path.join(trajectoryRoot, 'events.jsonl')),
    trajectorySummaryPath: await existingPath(path.join(trajectoryRoot, 'summary.json')),
    trajectorySummary: trajectorySummary ?? undefined,
    validation,
    requiredArtifacts: staticNode?.requiredArtifacts,
    trajectoryCapture: staticNode?.trajectoryCapture,
  };
}

async function collectPhaseIds(
  runRoot: string,
  events: readonly Record<string, unknown>[],
  staticSpec: StaticWorkflowSpec | null,
): Promise<readonly string[]> {
  const ids = new Set<string>();
  for (const node of staticSpec?.nodes ?? []) ids.add(node.id);
  for (const event of events) {
    const phaseId = asString(event.phase_id);
    if (phaseId && phaseId !== 'run-store') ids.add(phaseId);
  }
  for (const phaseId of await listPhaseDirs(runRoot)) ids.add(phaseId);
  return Array.from(ids);
}

function buildRuntimeState(events: readonly Record<string, unknown>[]): Map<string, PhaseRuntimeState> {
  const result = new Map<string, PhaseRuntimeState>();
  for (const raw of events) {
    const event = raw as RunEvent;
    const phaseId = event.phase_id;
    if (!phaseId || phaseId === 'run-store') continue;
    const current = result.get(phaseId) ?? { id: phaseId };
    const payload = event.payload ?? {};

    if (event.kind === 'phase_start') {
      result.set(phaseId, {
        ...current,
        status: 'running',
        startedAt: event.ts ?? current.startedAt,
        agent: asString(payload.agent) ?? current.agent,
        tool: asString(payload.tool) ?? current.tool,
        mode: asString(payload.mode) ?? current.mode,
        cwdRef: asString(payload.cwd_ref) ?? current.cwdRef,
      });
      continue;
    }

    if (event.kind === 'phase_end') {
      const auditBlocked = asBoolean(payload.audit_blocked) ?? current.auditBlocked;
      result.set(phaseId, {
        ...current,
        status: mapPhaseStatus(asString(payload.status), asNumber(payload.exit_code), auditBlocked),
        completedAt: event.ts ?? current.completedAt,
        durationMs: asNumber(payload.duration_ms) ?? current.durationMs,
        exitCode: asNumber(payload.exit_code) ?? current.exitCode,
        auditBlocked,
        trajectoryStatus: asString(payload.trajectory_status) ?? current.trajectoryStatus,
        reason: asString(payload.reason) ?? current.reason,
      });
      continue;
    }

    if (event.kind === 'gate_fail') {
      result.set(phaseId, {
        ...current,
        status: 'blocked',
        completedAt: event.ts ?? current.completedAt,
        error: asString(payload.error) ?? current.error,
        reason: asString(payload.reason) ?? current.reason,
      });
    }
  }
  return result;
}

async function readStaticSpec(definitionPath: string): Promise<StaticWorkflowSpec | null> {
  if (!(await fileExists(definitionPath))) return null;
  if (path.basename(definitionPath) === 'SKILL.md') {
    return readSkillPhaseSpec(definitionPath);
  }
  const workflow = await readStaticWorkflowVisualWorkflow(definitionPath);
  if (!workflow) return null;
  return {
    source: 'workflow-md',
    definitionPath,
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      agent: node.agent,
      tool: node.tool,
      task: node.task,
      checkpoint: node.checkpoint,
      mode: node.mode,
      requiredArtifacts: node.requiredArtifacts,
      trajectoryCapture: node.trajectoryCapture,
    })),
    edges: workflow.edges,
  };
}

async function readPhaseGraphSpec(runRoot: string): Promise<StaticWorkflowSpec | null> {
  const graphPath = path.join(runRoot, 'phase_graph.json');
  const raw = await readJsonUnknown(graphPath);
  if (!Array.isArray(raw)) return null;

  const nodes = phaseGraphEntriesToStaticNodes(raw);
  if (nodes.length === 0) return null;

  return {
    source: 'harness-run',
    definitionPath: graphPath,
    nodes,
    edges: deriveEdgesFromStaticNodes(nodes),
  };
}

function phaseGraphEntriesToStaticNodes(entries: readonly unknown[]): readonly PhaseStaticSpec[] {
  return entries
    .map((entry): (PhaseStaticSpec & { readonly index?: number }) | null => {
      if (!isRecord(entry)) return null;
      const id = asString(entry.phase_id) ?? asString(entry.id);
      if (!id) return null;
      return {
        id,
        agent: asString(entry.agent),
        tool: asString(entry.tool),
        cwdRef: asString(entry.cwd_ref),
        profile: asString(entry.profile),
        parallelGroup: asString(entry.parallel_group),
        mode: asString(entry.mode),
        requiredArtifacts: asStringArray(entry.required_artifacts),
        trajectoryCapture: asBoolean(entry.trajectory_capture),
        index: asNumber(entry.index),
      };
    })
    .filter((node): node is PhaseStaticSpec & { readonly index?: number } => node !== null)
    .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER))
    .map((node): PhaseStaticSpec => ({
      id: node.id,
      agent: node.agent,
      tool: node.tool,
      cwdRef: node.cwdRef,
      profile: node.profile,
      parallelGroup: node.parallelGroup,
      mode: node.mode,
      requiredArtifacts: node.requiredArtifacts,
      trajectoryCapture: node.trajectoryCapture,
    }));
}

async function readSkillPhaseSpec(skillPath: string): Promise<StaticWorkflowSpec | null> {
  const content = await fs.readFile(skillPath, 'utf-8');
  const parsed = matter(content);
  const phases = parsed.data.phases;
  if (!Array.isArray(phases)) return null;

  const nodes = phases
    .map((phase): PhaseStaticSpec | null => {
      if (!phase || typeof phase !== 'object' || Array.isArray(phase)) return null;
      const record = phase as Record<string, unknown>;
      const id = asString(record.phase_id) ?? asString(record.id);
      if (!id) return null;
      return {
        id,
        agent: asString(record.agent),
        tool: asString(record.tool),
        task: instructionsToTask(record.instructions),
        cwdRef: asString(record.cwd_ref),
        profile: asString(record.profile),
        parallelGroup: asString(record.parallel_group),
        mode: asString(record.mode),
        checkpoint: Boolean(asString(record.checkpoint_model)),
        dependsOn: asStringArray(record.depends_on) ?? asStringArray(record.dependencies),
        requiredArtifacts: asStringArray(record.required_artifacts),
        trajectoryCapture: asBoolean(record.trajectory_capture),
      };
    })
    .filter((node): node is PhaseStaticSpec => node !== null);

  return {
    source: 'skill-phases',
    definitionPath: skillPath,
    nodes,
    edges: deriveEdgesFromStaticNodes(nodes),
  };
}

function deriveEdgesFromStaticNodes(nodes: readonly PhaseStaticSpec[]): readonly VisualWorkflowEdge[] {
  const explicitEdges = nodes.flatMap((node) =>
    (node.dependsOn ?? []).map((dep) => ({
      id: `dispatch:${dep}->${node.id}`,
      source: dep,
      target: node.id,
      type: 'dispatch' as const,
    })),
  );
  if (explicitEdges.length > 0) return explicitEdges;
  return deriveSequentialEdges(groupStaticNodesByParallelPhase(nodes));
}

function groupStaticNodesByParallelPhase(nodes: readonly PhaseStaticSpec[]): readonly (readonly string[])[] {
  const groups: string[][] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node.parallelGroup) {
      groups.push([node.id]);
      continue;
    }

    const currentGroup = [node.id];
    let cursor = index + 1;
    while (cursor < nodes.length && nodes[cursor].parallelGroup === node.parallelGroup) {
      currentGroup.push(nodes[cursor].id);
      cursor++;
    }
    groups.push(currentGroup);
    index = cursor - 1;
  }
  return groups;
}

function deriveEdgesFromEvents(events: readonly Record<string, unknown>[]): readonly VisualWorkflowEdge[] | null {
  const groups: string[][] = [];
  const active = new Set<string>();
  let currentGroup: string[] = [];

  for (const raw of events) {
    const event = raw as RunEvent;
    const phaseId = event.phase_id;
    if (!phaseId || phaseId === 'run-store') continue;

    if (event.kind === 'phase_start') {
      if (active.size === 0 && currentGroup.length === 0) {
        currentGroup = [];
      }
      active.add(phaseId);
      currentGroup.push(phaseId);
      continue;
    }

    if (event.kind === 'phase_end') {
      active.delete(phaseId);
      if (active.size === 0 && currentGroup.length > 0) {
        groups.push(dedupe(currentGroup));
        currentGroup = [];
      }
    }
  }

  if (currentGroup.length > 0) groups.push(dedupe(currentGroup));
  if (groups.length < 2) return null;
  return deriveSequentialEdges(groups);
}

function deriveSequentialEdges(groups: readonly (readonly string[])[]): readonly VisualWorkflowEdge[] {
  const edges: VisualWorkflowEdge[] = [];
  for (let index = 1; index < groups.length; index++) {
    for (const source of groups[index - 1]) {
      for (const target of groups[index]) {
        edges.push({
          id: `dispatch:${source}->${target}`,
          source,
          target,
          type: groups[index].length > 1 || groups[index - 1].length > 1 ? 'parallel' : 'dispatch',
        });
      }
    }
  }
  return edges;
}

async function readPhaseGraphEdges(runRoot: string, phaseIds: readonly string[]): Promise<readonly VisualWorkflowEdge[] | null> {
  const graph = await readJsonUnknown(path.join(runRoot, 'phase_graph.json'));
  const phaseIdSet = new Set(phaseIds);

  if (Array.isArray(graph)) {
    const edges = deriveEdgesFromStaticNodes(phaseGraphEntriesToStaticNodes(graph))
      .filter((edge) => phaseIdSet.has(edge.source) && phaseIdSet.has(edge.target));
    return edges.length > 0 ? edges : null;
  }

  if (!isRecord(graph)) return null;
  const rawEdges = graph.edges;
  if (!Array.isArray(rawEdges)) return null;

  const edges = rawEdges
    .map((edge): VisualWorkflowEdge | null => {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) return null;
      const record = edge as Record<string, unknown>;
      const source = asString(record.source) ?? asString(record.from);
      const target = asString(record.target) ?? asString(record.to);
      if (!source || !target || !phaseIdSet.has(source) || !phaseIdSet.has(target)) return null;
      return { id: `dispatch:${source}->${target}`, source, target, type: 'dispatch' };
    })
    .filter((edge): edge is VisualWorkflowEdge => edge !== null);
  return edges.length > 0 ? edges : null;
}

async function readTrajectorySummary(runRoot: string, phaseId: string): Promise<PhaseTrajectorySummary | null> {
  const primary = path.join(runRoot, 'trajectory', phaseId, 'summary.json');
  const fallback = path.join(runRoot, 'phases', phaseId, 'trajectory.json');
  const summary = await readJsonObject(primary);
  if (Object.keys(summary).length > 0) return summary as PhaseTrajectorySummary;
  const fallbackSummary = await readJsonObject(fallback);
  return Object.keys(fallbackSummary).length > 0 ? fallbackSummary as PhaseTrajectorySummary : null;
}

async function readValidationSummary(runRoot: string, phaseId: string): Promise<VisualWorkflowValidationSummary | undefined> {
  const validationRoot = path.join(runRoot, 'validation', phaseId);
  const [result, budget, risk] = await Promise.all([
    readJsonObject(path.join(validationRoot, 'result-schema.json')),
    readJsonObject(path.join(validationRoot, 'budget.json')),
    readJsonObject(path.join(validationRoot, 'risk.json')),
  ]);
  const summary: VisualWorkflowValidationSummary = {
    resultStatus: asString(result.status),
    budgetStatus: asString(budget.status),
    riskStatus: asString(risk.status),
  };
  return summary.resultStatus || summary.budgetStatus || summary.riskStatus ? summary : undefined;
}

async function readRunFamilySummary(runRoot: string): Promise<VisualWorkflowRunFamilySummary | undefined> {
  const raw = await readJsonObject(path.join(runRoot, 'run-family.json'));
  const runs = raw.runs;
  const runCount = Array.isArray(runs) ? runs.length : undefined;
  const taskCardHash = asString(raw.task_card_hash);
  if (runCount === undefined && !taskCardHash) return undefined;
  return {
    runCount: runCount ?? 0,
    taskCardHash,
  };
}

function resolveArtifactPath(runRoot: string, phaseId: string | undefined, kind: string): string | null {
  if (kind === 'summary') return path.join(runRoot, 'summary.md');
  if (kind === 'brief') return path.join(runRoot, 'brief.md');
  if (kind === 'task-card') return path.join(runRoot, 'task-card.json');
  if (kind === 'task-card-hash') return path.join(runRoot, 'task-card.sha256');
  if (kind === 'run-family') return path.join(runRoot, 'run-family.json');
  if (!phaseId) return null;
  if (kind === 'trace') return path.join(runRoot, 'trajectory', phaseId, 'events.jsonl');
  if (kind === 'trajectory-summary') return path.join(runRoot, 'trajectory', phaseId, 'summary.json');
  if (kind === 'validation-result') return path.join(runRoot, 'validation', phaseId, 'result-schema.json');
  if (kind === 'validation-budget') return path.join(runRoot, 'validation', phaseId, 'budget.json');
  if (kind === 'validation-risk') return path.join(runRoot, 'validation', phaseId, 'risk.json');
  if (kind === 'rollback') return path.join(runRoot, 'rollback', phaseId, 'rollback.md');
  if (kind === 'rollback-baseline') return path.join(runRoot, 'rollback', phaseId, 'baseline.diff');
  const fileName = ARTIFACT_FILE_NAMES[kind];
  return fileName ? path.join(runRoot, 'phases', phaseId, fileName) : null;
}

function normalizeTraceEvent(raw: Record<string, unknown>): VisualTraceEvent | null {
  const kind = asString(raw.kind);
  if (!kind) return null;

  // Normalized Codex/Claude trajectories can include very large lifecycle blobs
  // such as full system prompts. Hide those by default but keep lifecycle errors.
  if (kind === 'lifecycle' && !asString(raw.error)) {
    return null;
  }

  return {
    event_id: asString(raw.event_id),
    phase_id: asString(raw.phase_id),
    sequence: asNumber(raw.sequence),
    session_id: asString(raw.session_id),
    source: asString(raw.source),
    timestamp: asString(raw.timestamp),
    kind,
    name: asString(raw.name),
    text: truncateText(asString(raw.text)),
    input: truncateUnknown(raw.input),
    output: truncateUnknown(raw.output),
    tokens: asNumber(raw.tokens),
    error: truncateText(asString(raw.error)),
  };
}

async function listRunRoots(projectPath: string): Promise<readonly { readonly runId: string; readonly runRoot: string }[]> {
  const runsDir = path.join(projectPath, '.harness', 'runs');
  if (!(await fileExists(runsDir))) return [];

  const result: { readonly runId: string; readonly runRoot: string }[] = [];
  const topLevelEntries = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of topLevelEntries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(runsDir, entry.name);
    if (await isRunRoot(candidate)) {
      result.push({ runId: entry.name, runRoot: candidate });
      continue;
    }

    const nestedEntries = await fs.readdir(candidate, { withFileTypes: true }).catch(() => []);
    for (const nested of nestedEntries) {
      if (!nested.isDirectory()) continue;
      const nestedRoot = path.join(candidate, nested.name);
      if (await isRunRoot(nestedRoot)) {
        result.push({ runId: `${entry.name}/${nested.name}`, runRoot: nestedRoot });
      }
    }
  }
  return result;
}

async function resolveRunRoot(projectPath: string, runId: string): Promise<string> {
  const runsDir = path.join(projectPath, '.harness', 'runs');
  const runRoot = path.resolve(runsDir, runId);
  if (!isPathWithin(runsDir, runRoot) || !(await isRunRoot(runRoot))) {
    throw new Error(`Run not found: ${runId}`);
  }
  return runRoot;
}

async function isRunRoot(dir: string): Promise<boolean> {
  const markers = ['state.json', 'run.json', 'events.jsonl', 'phases'];
  const exists = await Promise.all(markers.map((marker) => fileExists(path.join(dir, marker))));
  return exists.some(Boolean);
}

async function listPhaseDirs(runRoot: string): Promise<readonly string[]> {
  const phasesDir = path.join(runRoot, 'phases');
  if (!(await fileExists(phasesDir))) return [];
  const entries = await fs.readdir(phasesDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function mapRunStatus(status: string | undefined, nodes: readonly Pick<VisualWorkflowNode, 'status'>[]): VisualNodeStatus {
  const normalized = status?.toLowerCase();
  if (normalized === 'running') return 'running';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'paused' || normalized === 'needs_user_review' || normalized === 'needs-user-review') return 'blocked';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'completed' || normalized === 'success' || normalized === 'succeeded') return 'succeeded';
  if (nodes.some((node) => node.status === 'failed' || node.status === 'blocked')) return 'failed';
  if (nodes.some((node) => node.status === 'running' || node.status === 'queued')) return 'running';
  if (nodes.length > 0 && nodes.every((node) => node.status === 'succeeded' || node.status === 'skipped')) return 'succeeded';
  return 'pending';
}

function mapPhaseStatus(status: string | VisualNodeStatus | undefined, exitCode?: number, auditBlocked?: boolean): VisualNodeStatus {
  if (auditBlocked) return 'blocked';
  const normalized = status?.toLowerCase();
  if (normalized === 'pending') return 'pending';
  if (normalized === 'queued') return 'queued';
  if (normalized === 'running' || normalized === 'in_progress' || normalized === 'in-progress') return 'running';
  if (normalized === 'completed' || normalized === 'done' || normalized === 'success' || normalized === 'succeeded') return 'succeeded';
  if (normalized === 'ok') return 'succeeded';
  if (normalized === 'failed' || normalized === 'failure' || normalized === 'critical') return 'failed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (
    normalized === 'blocked'
    || normalized === 'waiting-checkpoint'
    || normalized === 'waiting_checkpoint'
    || normalized === 'paused'
    || normalized === 'needs_user_review'
    || normalized === 'needs-review'
    || normalized === 'needs_review'
  ) return 'blocked';
  if (normalized === 'skipped') return 'skipped';
  if (typeof exitCode === 'number') return exitCode === 0 ? 'succeeded' : 'failed';
  return 'pending';
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const parsed = await readJsonUnknown(filePath);
  return isRecord(parsed) ? parsed : {};
}

async function readJsonUnknown(filePath: string): Promise<unknown | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

async function readJsonl(filePath: string): Promise<readonly Record<string, unknown>[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
        } catch {
          return null;
        }
      })
      .filter((record): record is Record<string, unknown> => record !== null);
  } catch {
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function existingPath(filePath: string): Promise<string | undefined> {
  return await fileExists(filePath) ? filePath : undefined;
}

async function readErrorPreview(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return truncateText(content.trim()) || undefined;
  } catch {
    return undefined;
  }
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function instructionsToTask(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const lines = value.filter((item): item is string => typeof item === 'string');
    return lines.length > 0 ? lines.join('\n') : undefined;
  }
  return undefined;
}

function truncateText(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.length > TEXT_PREVIEW_LIMIT ? `${value.slice(0, TEXT_PREVIEW_LIMIT)}\n...[truncated]` : value;
}

function truncateUnknown(value: unknown): unknown {
  if (typeof value === 'string') return truncateText(value);
  if (value === undefined || value === null) return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= TEXT_PREVIEW_LIMIT) return value;
    return `${serialized.slice(0, TEXT_PREVIEW_LIMIT)}...[truncated]`;
  } catch {
    return '[unserializable]';
  }
}

function compareDateDesc(a: string | undefined, b: string | undefined): number {
  const aTime = a ? Date.parse(a) : 0;
  const bTime = b ? Date.parse(b) : 0;
  return bTime - aTime;
}

function minDate(values: readonly (string | undefined)[]): string | undefined {
  const dates = values.filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(a) - Date.parse(b));
  return dates[0];
}

function maxDate(values: readonly (string | undefined)[]): string | undefined {
  const dates = values.filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a));
  return dates[0];
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

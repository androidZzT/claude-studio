"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readVisualWorkflowRuns = readVisualWorkflowRuns;
exports.readVisualWorkflowRun = readVisualWorkflowRun;
exports.readStaticSkillVisualWorkflow = readStaticSkillVisualWorkflow;
exports.readStaticWorkflowVisualWorkflow = readStaticWorkflowVisualWorkflow;
exports.readVisualRunArtifact = readVisualRunArtifact;
exports.readVisualRunTrace = readVisualRunTrace;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const workflow_document_1 = require("./workflow-document");
const ARTIFACT_FILE_NAMES = {
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
async function readVisualWorkflowRuns(projectPath) {
    const runRoots = await listRunRoots(projectPath);
    const summaries = await Promise.all(runRoots.map(async ({ runId, runRoot }) => readRunSummary(runId, runRoot).catch(() => null)));
    return summaries
        .filter((summary) => summary !== null)
        .sort((a, b) => compareDateDesc(a.startedAt ?? a.updatedAt, b.startedAt ?? b.updatedAt));
}
async function readVisualWorkflowRun(projectPath, runId) {
    const runRoot = await resolveRunRoot(projectPath, runId);
    const [state, runJson, events, runStat] = await Promise.all([
        readJsonObject(node_path_1.default.join(runRoot, 'state.json')),
        readJsonObject(node_path_1.default.join(runRoot, 'run.json')),
        readJsonl(node_path_1.default.join(runRoot, 'events.jsonl')),
        promises_1.default.stat(runRoot),
    ]);
    const definitionPath = asString(runJson.skill_path) ?? asString(runJson.workflow_path);
    const [phaseGraphSpec, definitionSpec] = await Promise.all([
        readPhaseGraphSpec(runRoot),
        definitionPath ? readStaticSpec(definitionPath).catch(() => null) : Promise.resolve(null),
    ]);
    const staticSpec = phaseGraphSpec ?? definitionSpec;
    const phaseIds = await collectPhaseIds(runRoot, events, staticSpec);
    const runtimeById = buildRuntimeState(events);
    const nodes = await Promise.all(phaseIds.map((phaseId) => buildVisualNode(runRoot, phaseId, runtimeById.get(phaseId), staticSpec)));
    const edges = await readPhaseGraphEdges(runRoot, phaseIds)
        ?? staticSpec?.edges
        ?? deriveEdgesFromEvents(events)
        ?? deriveSequentialEdges(phaseIds.map((id) => [id]));
    const status = mapRunStatus(asString(state.status), nodes);
    const startedAt = asString(state.started_at_iso) ?? minDate(nodes.map((node) => node.startedAt));
    const completedAt = asString(state.completed_at_iso) ?? maxDate(nodes.map((node) => node.completedAt));
    const [summaryPath, taskCardPath, taskCardHashPath, runFamilyPath, runFamily] = await Promise.all([
        existingPath(node_path_1.default.join(runRoot, 'summary.md')),
        existingPath(node_path_1.default.join(runRoot, 'task-card.json')),
        existingPath(node_path_1.default.join(runRoot, 'task-card.sha256')),
        existingPath(node_path_1.default.join(runRoot, 'run-family.json')),
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
async function readStaticSkillVisualWorkflow(skillPath) {
    const spec = await readSkillPhaseSpec(skillPath);
    if (!spec)
        return null;
    const stat = await promises_1.default.stat(skillPath).catch(() => null);
    return {
        runId: node_path_1.default.basename(node_path_1.default.dirname(skillPath)),
        runRoot: node_path_1.default.dirname(skillPath),
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
async function readStaticWorkflowVisualWorkflow(workflowPath) {
    const content = await promises_1.default.readFile(workflowPath, 'utf-8');
    const parsed = (0, workflow_document_1.parseWorkflowDocument)(content);
    if (!parsed)
        return null;
    const nodes = parsed.nodes.map((node) => ({
        id: node.id,
        label: node.id,
        agent: node.agent,
        task: node.task,
        status: 'pending',
        checkpoint: node.checkpoint,
    }));
    const edges = parsed.nodes.flatMap((node) => (node.depends_on ?? []).map((dep) => ({
        id: `dispatch:${dep}->${node.id}`,
        source: dep,
        target: node.id,
        type: 'dispatch',
    })));
    const stat = await promises_1.default.stat(workflowPath).catch(() => null);
    return {
        runId: parsed.name ?? node_path_1.default.basename(workflowPath, node_path_1.default.extname(workflowPath)),
        runRoot: node_path_1.default.dirname(workflowPath),
        source: 'workflow-md',
        status: 'pending',
        nodes,
        edges,
        updatedAt: stat?.mtime.toISOString(),
        definitionPath: workflowPath,
    };
}
async function readVisualRunArtifact(projectPath, runId, phaseId, kind, maxBytes = 96_000) {
    const runRoot = await resolveRunRoot(projectPath, runId);
    const filePath = resolveArtifactPath(runRoot, phaseId, kind);
    if (!filePath || !isPathWithin(runRoot, filePath) || !(await fileExists(filePath))) {
        return { kind, content: '', truncated: false, sizeBytes: 0 };
    }
    const stat = await promises_1.default.stat(filePath);
    const sizeBytes = stat.size;
    const handle = await promises_1.default.open(filePath, 'r');
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
    }
    finally {
        await handle.close();
    }
}
async function readVisualRunTrace(projectPath, runId, phaseId, maxEvents = 500) {
    const runRoot = await resolveRunRoot(projectPath, runId);
    const eventsPath = node_path_1.default.join(runRoot, 'trajectory', phaseId, 'events.jsonl');
    if (!isPathWithin(runRoot, eventsPath) || !(await fileExists(eventsPath))) {
        return { phaseId, events: [], truncated: false, missing: true };
    }
    const rawEvents = await readJsonl(eventsPath);
    const visible = rawEvents
        .map((event) => normalizeTraceEvent(event))
        .filter((event) => event !== null);
    return {
        phaseId,
        path: eventsPath,
        events: visible.slice(0, maxEvents),
        truncated: visible.length > maxEvents,
        missing: false,
    };
}
async function readRunSummary(runId, runRoot) {
    const [state, runJson, events, stat] = await Promise.all([
        readJsonObject(node_path_1.default.join(runRoot, 'state.json')),
        readJsonObject(node_path_1.default.join(runRoot, 'run.json')),
        readJsonl(node_path_1.default.join(runRoot, 'events.jsonl')),
        promises_1.default.stat(runRoot),
    ]);
    const definitionPath = asString(runJson.skill_path) ?? asString(runJson.workflow_path);
    const [phaseGraphSpec, definitionSpec] = await Promise.all([
        readPhaseGraphSpec(runRoot),
        definitionPath ? readStaticSpec(definitionPath).catch(() => null) : Promise.resolve(null),
    ]);
    const staticSpec = phaseGraphSpec ?? definitionSpec;
    const runtimeById = buildRuntimeState(events);
    const phaseDirs = await listPhaseDirs(runRoot);
    const nodeIds = new Set([
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
async function buildVisualNode(runRoot, phaseId, runtime, staticSpec) {
    const staticNode = staticSpec?.nodes.find((node) => node.id === phaseId);
    const phaseRoot = node_path_1.default.join(runRoot, 'phases', phaseId);
    const trajectoryRoot = node_path_1.default.join(runRoot, 'trajectory', phaseId);
    const validationRoot = node_path_1.default.join(runRoot, 'validation', phaseId);
    const rollbackRoot = node_path_1.default.join(runRoot, 'rollback', phaseId);
    const [session, exitCode, trajectorySummary, validation] = await Promise.all([
        readJsonObject(node_path_1.default.join(phaseRoot, 'session.json')),
        readJsonObject(node_path_1.default.join(phaseRoot, 'exit_code.json')),
        readTrajectorySummary(runRoot, phaseId),
        readValidationSummary(runRoot, phaseId),
    ]);
    const auditBlocked = asBoolean(exitCode.audit_blocked) ?? runtime?.auditBlocked;
    const status = mapPhaseStatus(asString(exitCode.status) ?? asString(session.status) ?? runtime?.status, asNumber(exitCode.exit_code) ?? runtime?.exitCode, auditBlocked);
    const stderrPath = await existingPath(node_path_1.default.join(phaseRoot, 'stderr.log'));
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
        promptPath: await existingPath(node_path_1.default.join(phaseRoot, 'prompt.md')),
        stdoutPath: await existingPath(node_path_1.default.join(phaseRoot, 'stdout.log')),
        stderrPath,
        outputPath: await existingPath(node_path_1.default.join(phaseRoot, 'output.md')),
        partialOutputPath: await existingPath(node_path_1.default.join(phaseRoot, 'partial-output.md')),
        resultPath: await existingPath(node_path_1.default.join(phaseRoot, 'result.json')),
        costPath: await existingPath(node_path_1.default.join(phaseRoot, 'cost.json')),
        sessionPath: await existingPath(node_path_1.default.join(phaseRoot, 'session.json')),
        exitCodePath: await existingPath(node_path_1.default.join(phaseRoot, 'exit_code.json')),
        validationResultPath: await existingPath(node_path_1.default.join(validationRoot, 'result-schema.json')),
        validationBudgetPath: await existingPath(node_path_1.default.join(validationRoot, 'budget.json')),
        validationRiskPath: await existingPath(node_path_1.default.join(validationRoot, 'risk.json')),
        rollbackPath: await existingPath(node_path_1.default.join(rollbackRoot, 'rollback.md')),
        rollbackBaselinePath: await existingPath(node_path_1.default.join(rollbackRoot, 'baseline.diff')),
        trajectoryEventsPath: await existingPath(node_path_1.default.join(trajectoryRoot, 'events.jsonl')),
        trajectorySummaryPath: await existingPath(node_path_1.default.join(trajectoryRoot, 'summary.json')),
        trajectorySummary: trajectorySummary ?? undefined,
        validation,
        requiredArtifacts: staticNode?.requiredArtifacts,
        trajectoryCapture: staticNode?.trajectoryCapture,
    };
}
async function collectPhaseIds(runRoot, events, staticSpec) {
    const ids = new Set();
    for (const node of staticSpec?.nodes ?? [])
        ids.add(node.id);
    for (const event of events) {
        const phaseId = asString(event.phase_id);
        if (phaseId && phaseId !== 'run-store')
            ids.add(phaseId);
    }
    for (const phaseId of await listPhaseDirs(runRoot))
        ids.add(phaseId);
    return Array.from(ids);
}
function buildRuntimeState(events) {
    const result = new Map();
    for (const raw of events) {
        const event = raw;
        const phaseId = event.phase_id;
        if (!phaseId || phaseId === 'run-store')
            continue;
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
async function readStaticSpec(definitionPath) {
    if (!(await fileExists(definitionPath)))
        return null;
    if (node_path_1.default.basename(definitionPath) === 'SKILL.md') {
        return readSkillPhaseSpec(definitionPath);
    }
    const workflow = await readStaticWorkflowVisualWorkflow(definitionPath);
    if (!workflow)
        return null;
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
async function readPhaseGraphSpec(runRoot) {
    const graphPath = node_path_1.default.join(runRoot, 'phase_graph.json');
    const raw = await readJsonUnknown(graphPath);
    if (!Array.isArray(raw))
        return null;
    const nodes = phaseGraphEntriesToStaticNodes(raw);
    if (nodes.length === 0)
        return null;
    return {
        source: 'harness-run',
        definitionPath: graphPath,
        nodes,
        edges: deriveEdgesFromStaticNodes(nodes),
    };
}
function phaseGraphEntriesToStaticNodes(entries) {
    return entries
        .map((entry) => {
        if (!isRecord(entry))
            return null;
        const id = asString(entry.phase_id) ?? asString(entry.id);
        if (!id)
            return null;
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
        .filter((node) => node !== null)
        .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER))
        .map((node) => ({
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
async function readSkillPhaseSpec(skillPath) {
    const content = await promises_1.default.readFile(skillPath, 'utf-8');
    const parsed = (0, gray_matter_1.default)(content);
    const phases = parsed.data.phases;
    if (!Array.isArray(phases))
        return null;
    const nodes = phases
        .map((phase) => {
        if (!phase || typeof phase !== 'object' || Array.isArray(phase))
            return null;
        const record = phase;
        const id = asString(record.phase_id) ?? asString(record.id);
        if (!id)
            return null;
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
        .filter((node) => node !== null);
    return {
        source: 'skill-phases',
        definitionPath: skillPath,
        nodes,
        edges: deriveEdgesFromStaticNodes(nodes),
    };
}
function deriveEdgesFromStaticNodes(nodes) {
    const explicitEdges = nodes.flatMap((node) => (node.dependsOn ?? []).map((dep) => ({
        id: `dispatch:${dep}->${node.id}`,
        source: dep,
        target: node.id,
        type: 'dispatch',
    })));
    if (explicitEdges.length > 0)
        return explicitEdges;
    return deriveSequentialEdges(groupStaticNodesByParallelPhase(nodes));
}
function groupStaticNodesByParallelPhase(nodes) {
    const groups = [];
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
function deriveEdgesFromEvents(events) {
    const groups = [];
    const active = new Set();
    let currentGroup = [];
    for (const raw of events) {
        const event = raw;
        const phaseId = event.phase_id;
        if (!phaseId || phaseId === 'run-store')
            continue;
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
    if (currentGroup.length > 0)
        groups.push(dedupe(currentGroup));
    if (groups.length < 2)
        return null;
    return deriveSequentialEdges(groups);
}
function deriveSequentialEdges(groups) {
    const edges = [];
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
async function readPhaseGraphEdges(runRoot, phaseIds) {
    const graph = await readJsonUnknown(node_path_1.default.join(runRoot, 'phase_graph.json'));
    const phaseIdSet = new Set(phaseIds);
    if (Array.isArray(graph)) {
        const edges = deriveEdgesFromStaticNodes(phaseGraphEntriesToStaticNodes(graph))
            .filter((edge) => phaseIdSet.has(edge.source) && phaseIdSet.has(edge.target));
        return edges.length > 0 ? edges : null;
    }
    if (!isRecord(graph))
        return null;
    const rawEdges = graph.edges;
    if (!Array.isArray(rawEdges))
        return null;
    const edges = rawEdges
        .map((edge) => {
        if (!edge || typeof edge !== 'object' || Array.isArray(edge))
            return null;
        const record = edge;
        const source = asString(record.source) ?? asString(record.from);
        const target = asString(record.target) ?? asString(record.to);
        if (!source || !target || !phaseIdSet.has(source) || !phaseIdSet.has(target))
            return null;
        return { id: `dispatch:${source}->${target}`, source, target, type: 'dispatch' };
    })
        .filter((edge) => edge !== null);
    return edges.length > 0 ? edges : null;
}
async function readTrajectorySummary(runRoot, phaseId) {
    const primary = node_path_1.default.join(runRoot, 'trajectory', phaseId, 'summary.json');
    const fallback = node_path_1.default.join(runRoot, 'phases', phaseId, 'trajectory.json');
    const summary = await readJsonObject(primary);
    if (Object.keys(summary).length > 0)
        return summary;
    const fallbackSummary = await readJsonObject(fallback);
    return Object.keys(fallbackSummary).length > 0 ? fallbackSummary : null;
}
async function readValidationSummary(runRoot, phaseId) {
    const validationRoot = node_path_1.default.join(runRoot, 'validation', phaseId);
    const [result, budget, risk] = await Promise.all([
        readJsonObject(node_path_1.default.join(validationRoot, 'result-schema.json')),
        readJsonObject(node_path_1.default.join(validationRoot, 'budget.json')),
        readJsonObject(node_path_1.default.join(validationRoot, 'risk.json')),
    ]);
    const summary = {
        resultStatus: asString(result.status),
        budgetStatus: asString(budget.status),
        riskStatus: asString(risk.status),
    };
    return summary.resultStatus || summary.budgetStatus || summary.riskStatus ? summary : undefined;
}
async function readRunFamilySummary(runRoot) {
    const raw = await readJsonObject(node_path_1.default.join(runRoot, 'run-family.json'));
    const runs = raw.runs;
    const runCount = Array.isArray(runs) ? runs.length : undefined;
    const taskCardHash = asString(raw.task_card_hash);
    if (runCount === undefined && !taskCardHash)
        return undefined;
    return {
        runCount: runCount ?? 0,
        taskCardHash,
    };
}
function resolveArtifactPath(runRoot, phaseId, kind) {
    if (kind === 'summary')
        return node_path_1.default.join(runRoot, 'summary.md');
    if (kind === 'brief')
        return node_path_1.default.join(runRoot, 'brief.md');
    if (kind === 'task-card')
        return node_path_1.default.join(runRoot, 'task-card.json');
    if (kind === 'task-card-hash')
        return node_path_1.default.join(runRoot, 'task-card.sha256');
    if (kind === 'run-family')
        return node_path_1.default.join(runRoot, 'run-family.json');
    if (!phaseId)
        return null;
    if (kind === 'trace')
        return node_path_1.default.join(runRoot, 'trajectory', phaseId, 'events.jsonl');
    if (kind === 'trajectory-summary')
        return node_path_1.default.join(runRoot, 'trajectory', phaseId, 'summary.json');
    if (kind === 'validation-result')
        return node_path_1.default.join(runRoot, 'validation', phaseId, 'result-schema.json');
    if (kind === 'validation-budget')
        return node_path_1.default.join(runRoot, 'validation', phaseId, 'budget.json');
    if (kind === 'validation-risk')
        return node_path_1.default.join(runRoot, 'validation', phaseId, 'risk.json');
    if (kind === 'rollback')
        return node_path_1.default.join(runRoot, 'rollback', phaseId, 'rollback.md');
    if (kind === 'rollback-baseline')
        return node_path_1.default.join(runRoot, 'rollback', phaseId, 'baseline.diff');
    const fileName = ARTIFACT_FILE_NAMES[kind];
    return fileName ? node_path_1.default.join(runRoot, 'phases', phaseId, fileName) : null;
}
function normalizeTraceEvent(raw) {
    const kind = asString(raw.kind);
    if (!kind)
        return null;
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
async function listRunRoots(projectPath) {
    const runsDir = node_path_1.default.join(projectPath, '.harness', 'runs');
    if (!(await fileExists(runsDir)))
        return [];
    const result = [];
    const topLevelEntries = await promises_1.default.readdir(runsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of topLevelEntries) {
        if (!entry.isDirectory())
            continue;
        const candidate = node_path_1.default.join(runsDir, entry.name);
        if (await isRunRoot(candidate)) {
            result.push({ runId: entry.name, runRoot: candidate });
            continue;
        }
        const nestedEntries = await promises_1.default.readdir(candidate, { withFileTypes: true }).catch(() => []);
        for (const nested of nestedEntries) {
            if (!nested.isDirectory())
                continue;
            const nestedRoot = node_path_1.default.join(candidate, nested.name);
            if (await isRunRoot(nestedRoot)) {
                result.push({ runId: `${entry.name}/${nested.name}`, runRoot: nestedRoot });
            }
        }
    }
    return result;
}
async function resolveRunRoot(projectPath, runId) {
    const runsDir = node_path_1.default.join(projectPath, '.harness', 'runs');
    const runRoot = node_path_1.default.resolve(runsDir, runId);
    if (!isPathWithin(runsDir, runRoot) || !(await isRunRoot(runRoot))) {
        throw new Error(`Run not found: ${runId}`);
    }
    return runRoot;
}
async function isRunRoot(dir) {
    const markers = ['state.json', 'run.json', 'events.jsonl', 'phases'];
    const exists = await Promise.all(markers.map((marker) => fileExists(node_path_1.default.join(dir, marker))));
    return exists.some(Boolean);
}
async function listPhaseDirs(runRoot) {
    const phasesDir = node_path_1.default.join(runRoot, 'phases');
    if (!(await fileExists(phasesDir)))
        return [];
    const entries = await promises_1.default.readdir(phasesDir, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
function mapRunStatus(status, nodes) {
    const normalized = status?.toLowerCase();
    if (normalized === 'running')
        return 'running';
    if (normalized === 'cancelled' || normalized === 'canceled')
        return 'cancelled';
    if (normalized === 'paused' || normalized === 'needs_user_review' || normalized === 'needs-user-review')
        return 'blocked';
    if (normalized === 'failed')
        return 'failed';
    if (normalized === 'completed' || normalized === 'success' || normalized === 'succeeded')
        return 'succeeded';
    if (nodes.some((node) => node.status === 'failed' || node.status === 'blocked'))
        return 'failed';
    if (nodes.some((node) => node.status === 'running' || node.status === 'queued'))
        return 'running';
    if (nodes.length > 0 && nodes.every((node) => node.status === 'succeeded' || node.status === 'skipped'))
        return 'succeeded';
    return 'pending';
}
function mapPhaseStatus(status, exitCode, auditBlocked) {
    if (auditBlocked)
        return 'blocked';
    const normalized = status?.toLowerCase();
    if (normalized === 'pending')
        return 'pending';
    if (normalized === 'queued')
        return 'queued';
    if (normalized === 'running' || normalized === 'in_progress' || normalized === 'in-progress')
        return 'running';
    if (normalized === 'completed' || normalized === 'done' || normalized === 'success' || normalized === 'succeeded')
        return 'succeeded';
    if (normalized === 'ok')
        return 'succeeded';
    if (normalized === 'failed' || normalized === 'failure' || normalized === 'critical')
        return 'failed';
    if (normalized === 'cancelled' || normalized === 'canceled')
        return 'cancelled';
    if (normalized === 'blocked'
        || normalized === 'waiting-checkpoint'
        || normalized === 'waiting_checkpoint'
        || normalized === 'paused'
        || normalized === 'needs_user_review'
        || normalized === 'needs-review'
        || normalized === 'needs_review')
        return 'blocked';
    if (normalized === 'skipped')
        return 'skipped';
    if (typeof exitCode === 'number')
        return exitCode === 0 ? 'succeeded' : 'failed';
    return 'pending';
}
async function readJsonObject(filePath) {
    const parsed = await readJsonUnknown(filePath);
    return isRecord(parsed) ? parsed : {};
}
async function readJsonUnknown(filePath) {
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return undefined;
    }
}
async function readJsonl(filePath) {
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        return content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
            try {
                const parsed = JSON.parse(line);
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? parsed
                    : null;
            }
            catch {
                return null;
            }
        })
            .filter((record) => record !== null);
    }
    catch {
        return [];
    }
}
async function fileExists(filePath) {
    try {
        await promises_1.default.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function existingPath(filePath) {
    return await fileExists(filePath) ? filePath : undefined;
}
async function readErrorPreview(filePath) {
    if (!filePath)
        return undefined;
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        return truncateText(content.trim()) || undefined;
    }
    catch {
        return undefined;
    }
}
function isPathWithin(basePath, targetPath) {
    const relative = node_path_1.default.relative(node_path_1.default.resolve(basePath), node_path_1.default.resolve(targetPath));
    return relative === '' || (!relative.startsWith('..') && !node_path_1.default.isAbsolute(relative));
}
function asString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function asBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function asStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function instructionsToTask(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value)) {
        const lines = value.filter((item) => typeof item === 'string');
        return lines.length > 0 ? lines.join('\n') : undefined;
    }
    return undefined;
}
function truncateText(value) {
    if (!value)
        return value;
    return value.length > TEXT_PREVIEW_LIMIT ? `${value.slice(0, TEXT_PREVIEW_LIMIT)}\n...[truncated]` : value;
}
function truncateUnknown(value) {
    if (typeof value === 'string')
        return truncateText(value);
    if (value === undefined || value === null)
        return value;
    try {
        const serialized = JSON.stringify(value);
        if (serialized.length <= TEXT_PREVIEW_LIMIT)
            return value;
        return `${serialized.slice(0, TEXT_PREVIEW_LIMIT)}...[truncated]`;
    }
    catch {
        return '[unserializable]';
    }
}
function compareDateDesc(a, b) {
    const aTime = a ? Date.parse(a) : 0;
    const bTime = b ? Date.parse(b) : 0;
    return bTime - aTime;
}
function minDate(values) {
    const dates = values.filter((value) => Boolean(value)).sort((a, b) => Date.parse(a) - Date.parse(b));
    return dates[0];
}
function maxDate(values) {
    const dates = values.filter((value) => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a));
    return dates[0];
}
function dedupe(values) {
    return Array.from(new Set(values));
}
//# sourceMappingURL=visual-workflow.js.map
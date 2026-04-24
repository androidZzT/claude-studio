"use strict";
/**
 * Workflow Execution Engine
 *
 * Computes topological execution order from DAG, executes nodes level by level,
 * same-level nodes run in parallel. Checkpoint nodes pause for user approval.
 *
 * Two modes:
 * - simulate=true (default): fake 2-3s delays, safe for testing
 * - simulate=false: real execution via `claude -p` per node
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionRunner = void 0;
exports.startExecution = startExecution;
exports.getExecution = getExecution;
exports.removeExecution = removeExecution;
const events_1 = require("events");
const child_process_1 = require("child_process");
const topology_1 = require("./topology");
// ─── Constants ────────────────────────────────────────────────────────────
const NODE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per node
// ─── Topology computation ──────────────────────────────────────────────────
function computeLevelsFromWorkflow(nodes) {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const depsMap = new Map();
    for (const node of nodes) {
        const deps = [
            ...(node.depends_on ?? []),
            ...(node.roundtrip ?? []),
        ].filter((d) => nodeIds.has(d));
        depsMap.set(node.id, deps);
    }
    return (0, topology_1.computeLevelsFromDepsMap)(nodeIds, depsMap);
}
// ─── Execution runner ──────────────────────────────────────────────────────
class ExecutionRunner extends events_1.EventEmitter {
    executionId;
    workflow;
    levels;
    nodeMap;
    simulate;
    projectPath;
    nodeStatuses;
    currentLevel;
    overallStatus;
    checkpointResolvers;
    cancelRequested;
    activeProcesses;
    constructor(executionId, workflow, options = {}) {
        super();
        this.executionId = executionId;
        this.workflow = workflow;
        this.simulate = options.simulate ?? true;
        this.projectPath = options.projectPath;
        this.currentLevel = 0;
        this.overallStatus = 'running';
        this.checkpointResolvers = new Map();
        this.cancelRequested = false;
        this.activeProcesses = new Map();
        this.nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
        this.levels = computeLevelsFromWorkflow(workflow.nodes);
        // Initialize all node statuses as pending
        this.nodeStatuses = new Map(workflow.nodes.map((n) => [
            n.id,
            { nodeId: n.id, status: 'pending' },
        ]));
    }
    getState() {
        return {
            id: this.executionId,
            workflowName: this.workflow.name,
            status: this.overallStatus,
            nodes: Array.from(this.nodeStatuses.values()),
            currentLevel: this.currentLevel,
            totalLevels: this.levels.length,
            simulate: this.simulate,
        };
    }
    async run() {
        this.emitEvent({
            type: 'execution-status',
            overallStatus: 'running',
            message: `Starting execution of "${this.workflow.name}" (${this.levels.length} levels)`,
        });
        try {
            for (let levelIdx = 0; levelIdx < this.levels.length; levelIdx++) {
                if (this.cancelRequested) {
                    this.setOverallStatus('cancelled');
                    return;
                }
                this.currentLevel = levelIdx;
                const levelNodeIds = this.levels[levelIdx];
                this.emitEvent({
                    type: 'level-start',
                    level: levelIdx,
                    message: `Level ${levelIdx + 1}/${this.levels.length}: ${levelNodeIds.join(', ')}`,
                });
                // Mark all nodes at this level as queued
                for (const nodeId of levelNodeIds) {
                    this.updateNodeStatus(nodeId, { status: 'queued' });
                }
                // Execute all nodes at this level in parallel
                const results = await Promise.allSettled(levelNodeIds.map((nodeId) => this.executeNode(nodeId)));
                // Check for failures
                const hasFailed = results.some((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value));
                if (this.cancelRequested) {
                    this.setOverallStatus('cancelled');
                    return;
                }
                if (hasFailed) {
                    this.setOverallStatus('failed');
                    return;
                }
            }
            this.setOverallStatus('completed');
        }
        catch {
            this.setOverallStatus('failed');
        }
    }
    approveCheckpoint(nodeId) {
        const resolver = this.checkpointResolvers.get(nodeId);
        if (!resolver)
            return false;
        resolver();
        this.checkpointResolvers.delete(nodeId);
        return true;
    }
    cancel() {
        this.cancelRequested = true;
        // Kill any active child processes
        for (const [nodeId, proc] of this.activeProcesses) {
            proc.kill('SIGTERM');
            this.activeProcesses.delete(nodeId);
        }
        // Resolve any pending checkpoints to unblock
        for (const [nodeId, resolver] of this.checkpointResolvers) {
            resolver();
            this.checkpointResolvers.delete(nodeId);
        }
        // Mark running/queued/pending nodes as cancelled
        for (const [nodeId, status] of this.nodeStatuses) {
            if (['pending', 'queued', 'running', 'waiting-checkpoint'].includes(status.status)) {
                this.updateNodeStatus(nodeId, { status: 'cancelled' });
            }
        }
        this.setOverallStatus('cancelled');
    }
    // ─── Private helpers ───────────────────────────────────────────────────
    async executeNode(nodeId) {
        if (this.cancelRequested)
            return false;
        const node = this.nodeMap.get(nodeId);
        if (!node)
            return false;
        // If checkpoint, wait for approval first
        if (node.checkpoint) {
            this.updateNodeStatus(nodeId, { status: 'waiting-checkpoint' });
            this.setOverallStatus('paused');
            this.emitEvent({
                type: 'log',
                nodeId,
                message: `Checkpoint: waiting for approval on "${nodeId}"`,
            });
            await new Promise((resolve) => {
                this.checkpointResolvers.set(nodeId, resolve);
            });
            if (this.cancelRequested)
                return false;
            // Resume overall status
            this.setOverallStatus('running');
        }
        // Mark running
        const startedAt = new Date().toISOString();
        this.updateNodeStatus(nodeId, { status: 'running', startedAt });
        this.emitEvent({
            type: 'log',
            nodeId,
            message: `Running: ${node.agent} — ${node.task}`,
        });
        try {
            const output = await this.runNodeTask(node);
            if (this.cancelRequested)
                return false;
            const completedAt = new Date().toISOString();
            this.updateNodeStatus(nodeId, {
                status: 'done',
                startedAt,
                completedAt,
                output,
            });
            return true;
        }
        catch (err) {
            const completedAt = new Date().toISOString();
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            this.updateNodeStatus(nodeId, {
                status: 'failed',
                startedAt,
                completedAt,
                error: errorMessage,
            });
            this.emitEvent({
                type: 'log',
                nodeId,
                message: `Failed: ${errorMessage}`,
            });
            return false;
        }
    }
    async runNodeTask(node) {
        if (this.simulate) {
            return this.simulateNodeTask(node);
        }
        return this.liveExecuteNode(node);
    }
    async simulateNodeTask(node) {
        const delayMs = 2000 + Math.floor(Math.random() * 1000);
        await new Promise((resolve) => {
            setTimeout(resolve, delayMs);
        });
        return `[Simulated] Agent "${node.agent}" completed task: ${node.task}`;
    }
    /**
     * Execute a node via `claude -p` with the node's task as the prompt.
     * Streams stdout chunks as 'node-output' events for live UI updates.
     */
    liveExecuteNode(node) {
        return new Promise((resolve, reject) => {
            // Build the prompt: prepend skill hints if present
            const skillHints = (node.skills ?? []).length > 0
                ? `Use skills: ${node.skills.join(', ')}.\n\n`
                : '';
            const prompt = `${skillHints}${node.task}`;
            const cwd = this.projectPath ?? process.cwd();
            this.emitEvent({
                type: 'log',
                nodeId: node.id,
                message: `[Live] Spawning: claude -p "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}" (cwd: ${cwd})`,
            });
            const proc = (0, child_process_1.spawn)('claude', ['-p', prompt], {
                cwd,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: NODE_TIMEOUT_MS,
            });
            this.activeProcesses.set(node.id, proc);
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => {
                const text = chunk.toString();
                stdout += text;
                // Stream partial output to UI
                this.emitEvent({
                    type: 'node-output',
                    nodeId: node.id,
                    output: text,
                    message: `[${node.id}] ${text.slice(0, 200)}`,
                });
            });
            proc.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            proc.on('close', (code) => {
                this.activeProcesses.delete(node.id);
                if (this.cancelRequested) {
                    reject(new Error('Cancelled'));
                    return;
                }
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    const errorMsg = stderr.trim() || `claude exited with code ${code}`;
                    reject(new Error(errorMsg));
                }
            });
            proc.on('error', (err) => {
                this.activeProcesses.delete(node.id);
                reject(new Error(`Failed to spawn claude: ${err.message}`));
            });
        });
    }
    updateNodeStatus(nodeId, update) {
        const current = this.nodeStatuses.get(nodeId);
        if (!current)
            return;
        const updated = {
            ...current,
            ...update,
        };
        this.nodeStatuses = new Map(this.nodeStatuses);
        this.nodeStatuses.set(nodeId, updated);
        this.emitEvent({
            type: 'node-status',
            nodeId,
            nodeStatus: updated.status,
            message: `${nodeId}: ${updated.status}`,
        });
    }
    setOverallStatus(status) {
        this.overallStatus = status;
        this.emitEvent({
            type: 'execution-status',
            overallStatus: status,
            message: `Execution ${status}`,
        });
    }
    emitEvent(partial) {
        const event = {
            ...partial,
            executionId: this.executionId,
            timestamp: new Date().toISOString(),
        };
        this.emit('event', event);
    }
}
exports.ExecutionRunner = ExecutionRunner;
// ─── Execution store (in-memory for MVP) ───────────────────────────────────
// NOTE: Module-level mutable state works in single-process dev server but will
// NOT persist across serverless function invocations. For production deployments
// on serverless platforms (Vercel, AWS Lambda), replace with Redis or a database.
const executions = new Map();
let executionCounter = 0;
function generateExecutionId() {
    executionCounter += 1;
    return `exec-${Date.now()}-${executionCounter}`;
}
function startExecution(workflow, options = {}) {
    const id = generateExecutionId();
    const runner = new ExecutionRunner(id, workflow, options);
    executions.set(id, runner);
    // Start execution asynchronously
    runner.run().catch(() => {
        // Error is captured in the runner state
    });
    return runner;
}
function getExecution(id) {
    return executions.get(id);
}
function removeExecution(id) {
    return executions.delete(id);
}
//# sourceMappingURL=execution-engine.js.map
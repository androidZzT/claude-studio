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

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { computeLevelsFromDepsMap } from './topology';

// ─── Constants ────────────────────────────────────────────────────────────

const NODE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per node

// ─── Types ─────────────────────────────────────────────────────────────────

export type NodeExecutionStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'waiting-checkpoint'
  | 'cancelled';

export type ExecutionOverallStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface NodeStatus {
  readonly nodeId: string;
  readonly status: NodeExecutionStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly output?: string;
  readonly error?: string;
}

export interface ExecutionState {
  readonly id: string;
  readonly workflowName: string;
  readonly status: ExecutionOverallStatus;
  readonly nodes: readonly NodeStatus[];
  readonly currentLevel: number;
  readonly totalLevels: number;
  readonly simulate: boolean;
}

export interface ExecutionEvent {
  readonly type: 'node-status' | 'level-start' | 'execution-status' | 'log' | 'node-output';
  readonly executionId: string;
  readonly timestamp: string;
  readonly nodeId?: string;
  readonly nodeStatus?: NodeExecutionStatus;
  readonly level?: number;
  readonly overallStatus?: ExecutionOverallStatus;
  readonly message?: string;
  readonly output?: string;
}

export interface WorkflowNodeInput {
  readonly id: string;
  readonly agent: string;
  readonly task: string;
  readonly checkpoint?: boolean;
  readonly depends_on?: readonly string[];
  readonly roundtrip?: readonly string[];
  readonly skills?: readonly string[];
}

export interface WorkflowInput {
  readonly name: string;
  readonly nodes: readonly WorkflowNodeInput[];
}

export interface ExecutionOptions {
  readonly simulate?: boolean;
  readonly projectPath?: string;
}

// ─── Topology computation ──────────────────────────────────────────────────

function computeLevelsFromWorkflow(
  nodes: readonly WorkflowNodeInput[]
): readonly (readonly string[])[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const depsMap = new Map<string, readonly string[]>();

  for (const node of nodes) {
    const deps = [
      ...(node.depends_on ?? []),
      ...(node.roundtrip ?? []),
    ].filter((d) => nodeIds.has(d));
    depsMap.set(node.id, deps);
  }

  return computeLevelsFromDepsMap(nodeIds, depsMap);
}

// ─── Execution runner ──────────────────────────────────────────────────────

export class ExecutionRunner extends EventEmitter {
  private readonly executionId: string;
  private readonly workflow: WorkflowInput;
  private readonly levels: readonly (readonly string[])[];
  private readonly nodeMap: Map<string, WorkflowNodeInput>;
  private readonly simulate: boolean;
  private readonly projectPath: string | undefined;
  private nodeStatuses: Map<string, NodeStatus>;
  private currentLevel: number;
  private overallStatus: ExecutionOverallStatus;
  private checkpointResolvers: Map<string, () => void>;
  private cancelRequested: boolean;
  private activeProcesses: Map<string, ChildProcess>;

  constructor(
    executionId: string,
    workflow: WorkflowInput,
    options: ExecutionOptions = {}
  ) {
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
    this.nodeStatuses = new Map(
      workflow.nodes.map((n) => [
        n.id,
        { nodeId: n.id, status: 'pending' as const },
      ])
    );
  }

  getState(): ExecutionState {
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

  async run(): Promise<void> {
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
        const results = await Promise.allSettled(
          levelNodeIds.map((nodeId) => this.executeNode(nodeId))
        );

        // Check for failures
        const hasFailed = results.some(
          (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)
        );

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
    } catch {
      this.setOverallStatus('failed');
    }
  }

  approveCheckpoint(nodeId: string): boolean {
    const resolver = this.checkpointResolvers.get(nodeId);
    if (!resolver) return false;
    resolver();
    this.checkpointResolvers.delete(nodeId);
    return true;
  }

  cancel(): void {
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

  private async executeNode(nodeId: string): Promise<boolean> {
    if (this.cancelRequested) return false;

    const node = this.nodeMap.get(nodeId);
    if (!node) return false;

    // If checkpoint, wait for approval first
    if (node.checkpoint) {
      this.updateNodeStatus(nodeId, { status: 'waiting-checkpoint' });
      this.setOverallStatus('paused');

      this.emitEvent({
        type: 'log',
        nodeId,
        message: `Checkpoint: waiting for approval on "${nodeId}"`,
      });

      await new Promise<void>((resolve) => {
        this.checkpointResolvers.set(nodeId, resolve);
      });

      if (this.cancelRequested) return false;

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

      if (this.cancelRequested) return false;

      const completedAt = new Date().toISOString();
      this.updateNodeStatus(nodeId, {
        status: 'done',
        startedAt,
        completedAt,
        output,
      });

      return true;
    } catch (err) {
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

  private async runNodeTask(node: WorkflowNodeInput): Promise<string> {
    if (this.simulate) {
      return this.simulateNodeTask(node);
    }
    return this.liveExecuteNode(node);
  }

  private async simulateNodeTask(node: WorkflowNodeInput): Promise<string> {
    const delayMs = 2000 + Math.floor(Math.random() * 1000);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
    return `[Simulated] Agent "${node.agent}" completed task: ${node.task}`;
  }

  /**
   * Execute a node via `claude -p` with the node's task as the prompt.
   * Streams stdout chunks as 'node-output' events for live UI updates.
   */
  private liveExecuteNode(node: WorkflowNodeInput): Promise<string> {
    return new Promise((resolve, reject) => {
      // Build the prompt: prepend skill hints if present
      const skillHints = (node.skills ?? []).length > 0
        ? `Use skills: ${node.skills!.join(', ')}.\n\n`
        : '';
      const prompt = `${skillHints}${node.task}`;

      const cwd = this.projectPath ?? process.cwd();

      this.emitEvent({
        type: 'log',
        nodeId: node.id,
        message: `[Live] Spawning: claude -p "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}" (cwd: ${cwd})`,
      });

      const proc = spawn('claude', ['-p', prompt], {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: NODE_TIMEOUT_MS,
      });

      this.activeProcesses.set(node.id, proc);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
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

      proc.stderr.on('data', (chunk: Buffer) => {
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
        } else {
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

  private updateNodeStatus(
    nodeId: string,
    update: Partial<Omit<NodeStatus, 'nodeId'>>
  ): void {
    const current = this.nodeStatuses.get(nodeId);
    if (!current) return;

    const updated: NodeStatus = {
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

  private setOverallStatus(status: ExecutionOverallStatus): void {
    this.overallStatus = status;
    this.emitEvent({
      type: 'execution-status',
      overallStatus: status,
      message: `Execution ${status}`,
    });
  }

  private emitEvent(
    partial: Omit<ExecutionEvent, 'executionId' | 'timestamp'>
  ): void {
    const event: ExecutionEvent = {
      ...partial,
      executionId: this.executionId,
      timestamp: new Date().toISOString(),
    };
    this.emit('event', event);
  }
}

// ─── Execution store (in-memory for MVP) ───────────────────────────────────
// NOTE: Module-level mutable state works in single-process dev server but will
// NOT persist across serverless function invocations. For production deployments
// on serverless platforms (Vercel, AWS Lambda), replace with Redis or a database.

const executions = new Map<string, ExecutionRunner>();

let executionCounter = 0;

function generateExecutionId(): string {
  executionCounter += 1;
  return `exec-${Date.now()}-${executionCounter}`;
}

export function startExecution(
  workflow: WorkflowInput,
  options: ExecutionOptions = {}
): ExecutionRunner {
  const id = generateExecutionId();
  const runner = new ExecutionRunner(id, workflow, options);
  executions.set(id, runner);

  // Start execution asynchronously
  runner.run().catch(() => {
    // Error is captured in the runner state
  });

  return runner;
}

export function getExecution(id: string): ExecutionRunner | undefined {
  return executions.get(id);
}

export function removeExecution(id: string): boolean {
  return executions.delete(id);
}

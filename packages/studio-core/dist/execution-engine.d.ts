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
export type NodeExecutionStatus = 'pending' | 'queued' | 'running' | 'done' | 'failed' | 'waiting-checkpoint' | 'cancelled';
export type ExecutionOverallStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
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
export declare class ExecutionRunner extends EventEmitter {
    private readonly executionId;
    private readonly workflow;
    private readonly levels;
    private readonly nodeMap;
    private readonly simulate;
    private readonly projectPath;
    private nodeStatuses;
    private currentLevel;
    private overallStatus;
    private checkpointResolvers;
    private cancelRequested;
    private activeProcesses;
    constructor(executionId: string, workflow: WorkflowInput, options?: ExecutionOptions);
    getState(): ExecutionState;
    run(): Promise<void>;
    approveCheckpoint(nodeId: string): boolean;
    cancel(): void;
    private executeNode;
    private runNodeTask;
    private simulateNodeTask;
    /**
     * Execute a node via `claude -p` with the node's task as the prompt.
     * Streams stdout chunks as 'node-output' events for live UI updates.
     */
    private liveExecuteNode;
    private updateNodeStatus;
    private setOverallStatus;
    private emitEvent;
}
export declare function startExecution(workflow: WorkflowInput, options?: ExecutionOptions): ExecutionRunner;
export declare function getExecution(id: string): ExecutionRunner | undefined;
export declare function removeExecution(id: string): boolean;

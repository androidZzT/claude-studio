export type VisualNodeStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'blocked' | 'skipped';
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
export type VisualTraceEventKind = 'user_prompt' | 'assistant_message' | 'skill_use' | 'tool_call' | 'tool_result' | 'tokens' | 'final_output' | 'lifecycle' | 'error';
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
export declare function readVisualWorkflowRuns(projectPath: string): Promise<readonly VisualWorkflowRunSummary[]>;
export declare function readVisualWorkflowRun(projectPath: string, runId: string): Promise<VisualWorkflowRun>;
export declare function readStaticSkillVisualWorkflow(skillPath: string): Promise<VisualWorkflowRun | null>;
export declare function readStaticWorkflowVisualWorkflow(workflowPath: string): Promise<VisualWorkflowRun | null>;
export declare function readVisualRunArtifact(projectPath: string, runId: string, phaseId: string | undefined, kind: string, maxBytes?: number): Promise<VisualRunArtifact>;
export declare function readVisualRunTrace(projectPath: string, runId: string, phaseId: string, maxEvents?: number): Promise<VisualTraceResult>;

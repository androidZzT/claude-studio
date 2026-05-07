export interface HarnessCliRunOptions {
    readonly command?: string;
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
}
export interface HarnessCliResult<T = unknown> {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly json?: T;
}
export interface HarnessCliAvailability {
    readonly available: boolean;
    readonly command: string;
    readonly cwd: string;
    readonly error?: string;
    readonly stdoutPreview?: string;
    readonly stderrPreview?: string;
}
export interface HarnessCliRunRequest {
    readonly compoundName?: string;
    readonly skillPath?: string;
    readonly threadId?: string;
    readonly runId?: string;
    readonly runRoot?: string;
    readonly briefPath?: string;
    readonly prompt?: string;
    readonly taskCardPath?: string;
    readonly judgeTool?: 'claude-code' | 'codex';
    readonly judgeProfile?: string;
    readonly judgeTimeoutSeconds?: number;
    readonly configPath?: string;
    readonly noLocal?: boolean;
}
export interface HarnessCliInspectRequest {
    readonly threadId: string;
    readonly runRoot?: string;
}
export type HarnessCliDryRunRequest = Pick<HarnessCliRunRequest, 'compoundName' | 'skillPath' | 'threadId' | 'runRoot' | 'taskCardPath' | 'configPath' | 'noLocal'>;
export declare function buildHarnessCliDryRunArgs(harnessRepoPath: string, request: HarnessCliDryRunRequest): readonly string[];
export declare function buildHarnessCliRunArgs(harnessRepoPath: string, request: HarnessCliRunRequest): readonly string[];
export declare function buildHarnessCliResumeArgs(harnessRepoPath: string, request: HarnessCliInspectRequest & Pick<HarnessCliRunRequest, 'compoundName' | 'skillPath' | 'configPath' | 'noLocal'>): readonly string[];
export declare function buildHarnessCliInspectArgs(harnessRepoPath: string, request: HarnessCliInspectRequest): readonly string[];
export declare function buildHarnessCliViewArgs(harnessRepoPath: string, request: HarnessCliInspectRequest): readonly string[];
export declare function runHarnessCli<T = unknown>(args: readonly string[], options?: HarnessCliRunOptions): Promise<HarnessCliResult<T>>;
export declare function runHarnessCliJson<T = unknown>(args: readonly string[], options?: HarnessCliRunOptions): Promise<HarnessCliResult<T>>;
export declare function checkHarnessCliAvailability(harnessRepoPath: string, options?: HarnessCliRunOptions): Promise<HarnessCliAvailability>;
export declare function dryRunHarnessWorkflow<T = unknown>(harnessRepoPath: string, request: HarnessCliDryRunRequest, options?: HarnessCliRunOptions): Promise<HarnessCliResult<T>>;
export declare function inspectHarnessRun<T = unknown>(harnessRepoPath: string, request: HarnessCliInspectRequest, options?: HarnessCliRunOptions): Promise<HarnessCliResult<T>>;
export declare function viewHarnessRun<T = unknown>(harnessRepoPath: string, request: HarnessCliInspectRequest, options?: HarnessCliRunOptions): Promise<HarnessCliResult<T>>;

import type {
  AutonomousDryRunReport,
  AutonomousRunReport,
  ProviderJudgeTool,
  RunInspectionReport,
  RunVisualizationResult,
} from "@harness/core";

export interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export type Scope = "global" | "project";
export type HelpTopic = "adapters" | "eval" | "init" | "run";
export type RunAction = "dry-run" | "inspect" | "view";
export type CliProviderJudgeTool = ProviderJudgeTool;

export type ReconcileResponse = {
  readonly added: readonly { readonly path: string; readonly reason: string }[];
  readonly modified: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
  readonly removed: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
  readonly unchanged: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
};

export type InitResponse = {
  readonly targetDir: string;
  readonly createdFiles: readonly string[];
  readonly skippedFiles: readonly string[];
};

export type AdoptResponse = {
  readonly targetDir: string;
  readonly createdFiles: readonly string[];
  readonly detectedCapabilities: readonly string[];
  readonly skippedCapabilities: readonly string[];
  readonly warnings: readonly string[];
  readonly dryRun: boolean;
};

export interface ParsedArgs {
  readonly adoptSettings: boolean;
  readonly command:
    | "adopt"
    | "diff"
    | "doctor"
    | "help"
    | "init"
    | "run"
    | "sync"
    | "version";
  readonly adoptOutput?: string;
  readonly adoptSource?: string;
  readonly briefPath?: string;
  readonly check: boolean;
  readonly compoundName?: string;
  readonly configPath?: string;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly helpTopic?: HelpTopic;
  readonly harnessRepoPath?: string;
  readonly initName?: string;
  readonly interactive: boolean;
  readonly judgeProfile?: string;
  readonly judgeTimeoutSeconds?: number;
  readonly judgeTool?: CliProviderJudgeTool;
  readonly json: boolean;
  readonly name?: string;
  readonly noLocal: boolean;
  readonly prompt?: string;
  readonly resume: boolean;
  readonly runId?: string;
  readonly runRoot?: string;
  readonly runAction?: RunAction;
  readonly skipCapabilities: readonly string[];
  readonly scope: Scope;
  readonly skillPath?: string;
  readonly taskCardPath?: string;
  readonly threadId?: string;
  readonly tools?: readonly string[];
}

export interface CliDependencies {
  loadVersion?(): Promise<string>;
  promptAdoptCapabilities?(
    detectedCapabilities: readonly string[],
    io: CliIo,
  ): Promise<readonly string[]>;
  runAdopt?(
    source: string,
    options: {
      readonly dryRun?: boolean;
      readonly force?: boolean;
      readonly interactive?: boolean;
      readonly name?: string;
      readonly outputDir?: string;
      readonly skipCapabilities?: readonly string[];
      readonly tools?: readonly string[];
    },
  ): Promise<AdoptResponse>;
  runDiff?(
    configPath?: string,
    options?: {
      readonly harnessRepoPath?: string;
      readonly noLocal?: boolean;
      readonly onWarning?: (message: string) => void;
    },
  ): Promise<ReconcileResponse>;
  runDoctor?(configPath?: string): Promise<{
    readonly configPath: string;
    readonly projectName: string;
    readonly tools: readonly string[];
    readonly checks: readonly {
      readonly id: string;
      readonly kind: "command" | "script";
      readonly status: "pass" | "fail";
      readonly message: string;
      readonly installHint?: string;
    }[];
    readonly summary: {
      readonly pass: number;
      readonly fail: number;
    };
  }>;
  runInit?(options: {
    readonly force: boolean;
    readonly scope: Scope;
    readonly targetDir: string;
  }): Promise<InitResponse>;
  runAutonomousDryRun?(options: {
    readonly compoundName?: string;
    readonly configPath?: string;
    readonly harnessRepoPath?: string;
    readonly noLocal?: boolean;
    readonly onWarning?: (message: string) => void;
    readonly runRoot?: string;
    readonly skillPath?: string;
    readonly taskCardPath?: string;
    readonly threadId?: string;
  }): Promise<AutonomousDryRunReport>;
  runAutonomousExecution?(options: {
    readonly briefPath?: string;
    readonly compoundName?: string;
    readonly configPath?: string;
    readonly harnessRepoPath?: string;
    readonly noLocal?: boolean;
    readonly onWarning?: (message: string) => void;
    readonly prompt?: string;
    readonly resume?: boolean;
    readonly judgeProfile?: string;
    readonly judgeTimeoutSeconds?: number;
    readonly judgeTool?: CliProviderJudgeTool;
    readonly runId?: string;
    readonly runRoot?: string;
    readonly skillPath?: string;
    readonly taskCardPath?: string;
    readonly threadId?: string;
  }): Promise<AutonomousRunReport>;
  inspectRun?(options: {
    readonly harnessRepoPath?: string;
    readonly runRoot?: string;
    readonly threadId: string;
  }): Promise<RunInspectionReport>;
  viewRun?(options: {
    readonly harnessRepoPath?: string;
    readonly runRoot?: string;
    readonly threadId: string;
  }): Promise<RunVisualizationResult>;
  runSync?(
    configPath?: string,
    dryRun?: boolean,
    options?: {
      readonly adoptPartialJsonOwnership?: boolean;
      readonly harnessRepoPath?: string;
      readonly noLocal?: boolean;
      readonly onWarning?: (message: string) => void;
    },
  ): Promise<ReconcileResponse>;
}

export interface CommandIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export type KmPageAnalysisCommand =
  | "clean"
  | "help"
  | "prepare"
  | "run"
  | "status"
  | "validate";

export interface KmPageAnalysisArgs {
  readonly agentCommandTemplate?: string;
  readonly androidRepo?: string;
  readonly business?: string;
  readonly command: KmPageAnalysisCommand;
  readonly force: boolean;
  readonly harnessRepo: string;
  readonly includeOutput: boolean;
  readonly iosRepo?: string;
  readonly json: boolean;
  readonly knownModules: readonly string[];
  readonly machproPath?: string;
  readonly machproRepo?: string;
  readonly page?: string;
  readonly runId?: string;
}

export interface PageAnalysisPaths {
  readonly dependencyPath: string;
  readonly harnessRepo: string;
  readonly logsDir: string;
  readonly outputDir: string;
  readonly pageAnalysisPath: string;
  readonly promptDir: string;
  readonly runDir: string;
  readonly statusDir: string;
}

export interface AgentResult {
  readonly agent: string;
  readonly exitCode: number;
  readonly logPath: string;
}

export const PAGE_ANALYSIS_AGENT = "architect";

import type { NamedResource } from "../named-resources.js";

export interface CommandIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export type KmModuleDesignCommand =
  | "clean"
  | "contributors"
  | "help"
  | "integrate"
  | "prepare"
  | "run"
  | "status"
  | "validate";

export interface KmModuleDesignArgs {
  readonly agentCommandTemplate?: string;
  readonly androidRepo?: string;
  readonly business?: string;
  readonly command: KmModuleDesignCommand;
  readonly force: boolean;
  readonly harnessRepo: string;
  readonly includeSpecPack: boolean;
  readonly iosRepo?: string;
  readonly json: boolean;
  readonly machproPath?: string;
  readonly machproRepo?: string;
  readonly module?: string;
  readonly runId?: string;
  readonly runIntegrator: boolean;
  readonly sources: readonly NamedResource[];
  readonly targets: readonly NamedResource[];
}

export interface WorkflowPaths {
  readonly harnessRepo: string;
  readonly logsDir: string;
  readonly promptDir: string;
  readonly runDir: string;
  readonly specPackDir: string;
  readonly statusDir: string;
}

export interface AgentResult {
  readonly agent: string;
  readonly exitCode: number;
  readonly logPath: string;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const PARALLEL_AGENTS = [
  "architect",
  "machpro-parity",
  "tester",
] as const;
export const INTEGRATOR_AGENT = "architect-integrator";
export const ALL_PROMPT_AGENTS = [
  ...PARALLEL_AGENTS,
  INTEGRATOR_AGENT,
] as const;

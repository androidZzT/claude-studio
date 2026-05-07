import path from "node:path";

import {
  adoptFromSource,
  createProviderCheckpointJudge,
  createProviderPhaseAuditJudge,
  generateRunVisualization,
  inspectRunStore,
  resolveRunStorePathsForThread,
  runAutonomousDryRunPreflight,
  runAutonomousExecution,
  runDiff,
  runDoctor,
  runInit,
  runSync,
} from "@harness/core";

import type { CliDependencies } from "./types.js";
import { promptAdoptCapabilities } from "./prompts.js";
import { loadCliVersion } from "./version.js";

export const defaultDependencies: Required<CliDependencies> = {
  async loadVersion(): Promise<string> {
    return loadCliVersion();
  },
  promptAdoptCapabilities,
  async runAdopt(source: string, options) {
    return adoptFromSource(source, options);
  },
  async runDiff(configPath, options) {
    return runDiff(process.cwd(), {
      ...(configPath ? { configPath } : {}),
      ...(options?.harnessRepoPath
        ? { harnessRepoPath: options.harnessRepoPath }
        : {}),
      ...(options?.noLocal !== undefined ? { noLocal: options.noLocal } : {}),
      ...(options?.onWarning ? { onWarning: options.onWarning } : {}),
    });
  },
  async runDoctor(configPath) {
    return runDoctor(process.cwd(), configPath ? { configPath } : {});
  },
  async runInit(options) {
    return runInit(options);
  },
  async runAutonomousDryRun(options) {
    return runAutonomousDryRunPreflight(process.cwd(), options);
  },
  async runAutonomousExecution(options) {
    const resolvedHarnessRepoPath = path.resolve(
      process.cwd(),
      options.harnessRepoPath ?? ".",
    );
    const judgeOptions = options.judgeTool
      ? {
          cwd: resolvedHarnessRepoPath,
          ...(options.judgeProfile ? { profile: options.judgeProfile } : {}),
          ...(options.judgeTimeoutSeconds !== undefined
            ? { timeoutMs: options.judgeTimeoutSeconds * 1000 }
            : {}),
          tool: options.judgeTool,
        }
      : undefined;
    return runAutonomousExecution(process.cwd(), {
      ...(options.briefPath ? { briefPath: options.briefPath } : {}),
      ...(options.compoundName ? { compoundName: options.compoundName } : {}),
      ...(options.configPath ? { configPath: options.configPath } : {}),
      ...(options.harnessRepoPath
        ? { harnessRepoPath: options.harnessRepoPath }
        : {}),
      ...(judgeOptions
        ? { auditJudge: createProviderPhaseAuditJudge(judgeOptions) }
        : {}),
      ...(judgeOptions
        ? { checkpointJudge: createProviderCheckpointJudge(judgeOptions) }
        : {}),
      ...(options.noLocal !== undefined ? { noLocal: options.noLocal } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.resume !== undefined ? { resume: options.resume } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
      ...(options.runRoot ? { runRoot: options.runRoot } : {}),
      ...(options.skillPath ? { skillPath: options.skillPath } : {}),
      ...(options.taskCardPath ? { taskCardPath: options.taskCardPath } : {}),
      ...(options.threadId ? { threadId: options.threadId } : {}),
    });
  },
  async inspectRun(options) {
    const harnessRepoPath = path.resolve(
      process.cwd(),
      options.harnessRepoPath ?? ".",
    );
    return inspectRunStore(
      resolveRunStorePathsForThread(
        harnessRepoPath,
        options.threadId,
        options.runRoot,
      ),
    );
  },
  async viewRun(options) {
    const harnessRepoPath = path.resolve(
      process.cwd(),
      options.harnessRepoPath ?? ".",
    );
    return generateRunVisualization(
      resolveRunStorePathsForThread(
        harnessRepoPath,
        options.threadId,
        options.runRoot,
      ),
    );
  },
  async runSync(configPath, dryRun, options) {
    return runSync(process.cwd(), {
      ...(configPath ? { configPath } : {}),
      ...(options?.adoptPartialJsonOwnership
        ? { adoptPartialJsonOwnership: options.adoptPartialJsonOwnership }
        : {}),
      ...(options?.harnessRepoPath
        ? { harnessRepoPath: options.harnessRepoPath }
        : {}),
      ...(options?.noLocal !== undefined ? { noLocal: options.noLocal } : {}),
      ...(dryRun !== undefined ? { dryRun } : {}),
      ...(options?.onWarning ? { onWarning: options.onWarning } : {}),
    });
  },
};

export function resolveDependencies(
  overrides: CliDependencies,
): Required<CliDependencies> {
  return {
    ...defaultDependencies,
    ...overrides,
  };
}

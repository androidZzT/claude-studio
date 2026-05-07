import { HarnessError } from "@harness/core";

import { CLI_COMMANDS } from "../constants.js";
import type { CliProviderJudgeTool, ParsedArgs } from "../types.js";
import {
  createDefaultParsedArgs,
  helpArgs,
  parsePositiveInteger,
  parseProviderJudgeTool,
  readFlagValue,
  unknownArgument,
} from "./common.js";

export function parseRunArgs(argv: readonly string[]): ParsedArgs {
  if (argv[0] === "inspect" || argv[0] === "view") {
    return parseRunArtifactArgs(argv[0], argv.slice(1));
  }

  let compoundName: string | undefined;
  let briefPath: string | undefined;
  let configPath: string | undefined;
  let dryRun = false;
  let harnessRepoPath: string | undefined;
  let judgeProfile: string | undefined;
  let judgeTimeoutSeconds: number | undefined;
  let judgeTool: CliProviderJudgeTool | undefined;
  let json = false;
  let noLocal = false;
  let prompt: string | undefined;
  let resume = false;
  let runId: string | undefined;
  let runRoot: string | undefined;
  let skillPath: string | undefined;
  let taskCardPath: string | undefined;
  let threadId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return helpArgs("run");
    }

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--no-local") {
      noLocal = true;
      continue;
    }

    if (token === "--config") {
      configPath = readFlagValue(
        argv,
        index,
        "--config",
        "CLI_MISSING_CONFIG_PATH",
      );
      index += 1;
      continue;
    }

    if (token === "--brief") {
      briefPath = readFlagValue(argv, index, "--brief", "CLI_MISSING_BRIEF");
      index += 1;
      continue;
    }

    if (token === "--prompt") {
      prompt = readFlagValue(argv, index, "--prompt", "CLI_MISSING_PROMPT");
      index += 1;
      continue;
    }

    if (token === "--task-card") {
      taskCardPath = readFlagValue(
        argv,
        index,
        "--task-card",
        "CLI_MISSING_TASK_CARD",
      );
      index += 1;
      continue;
    }

    if (token === "--harness-repo") {
      harnessRepoPath = readFlagValue(
        argv,
        index,
        "--harness-repo",
        "CLI_MISSING_HARNESS_REPO",
      );
      index += 1;
      continue;
    }

    if (token === "--judge-tool") {
      judgeTool = parseProviderJudgeTool(
        readFlagValue(argv, index, "--judge-tool", "CLI_MISSING_JUDGE_TOOL"),
      );
      index += 1;
      continue;
    }

    if (token === "--judge-profile") {
      judgeProfile = readFlagValue(
        argv,
        index,
        "--judge-profile",
        "CLI_MISSING_JUDGE_PROFILE",
      );
      index += 1;
      continue;
    }

    if (token === "--judge-timeout-seconds") {
      judgeTimeoutSeconds = parsePositiveInteger(
        readFlagValue(
          argv,
          index,
          "--judge-timeout-seconds",
          "CLI_MISSING_JUDGE_TIMEOUT",
        ),
        "--judge-timeout-seconds",
      );
      index += 1;
      continue;
    }

    if (token === "--compound") {
      compoundName = readFlagValue(
        argv,
        index,
        "--compound",
        "CLI_MISSING_COMPOUND",
      );
      index += 1;
      continue;
    }

    if (token === "--skill") {
      skillPath = readFlagValue(argv, index, "--skill", "CLI_MISSING_SKILL");
      index += 1;
      continue;
    }

    if (token === "--thread-id") {
      threadId = readFlagValue(
        argv,
        index,
        "--thread-id",
        "CLI_MISSING_THREAD_ID",
      );
      index += 1;
      continue;
    }

    if (token === "--resume") {
      resume = true;
      threadId = readFlagValue(
        argv,
        index,
        "--resume",
        "CLI_MISSING_THREAD_ID",
      );
      index += 1;
      continue;
    }

    if (token === "--run-id") {
      runId = readFlagValue(argv, index, "--run-id", "CLI_MISSING_RUN_ID");
      index += 1;
      continue;
    }

    if (token === "--run-root") {
      runRoot = readFlagValue(
        argv,
        index,
        "--run-root",
        "CLI_MISSING_RUN_ROOT",
      );
      index += 1;
      continue;
    }

    unknownArgument(token);
  }

  validateRunArgs({
    briefPath,
    judgeProfile,
    judgeTimeoutSeconds,
    judgeTool,
    prompt,
    resume,
    taskCardPath,
  });

  return {
    ...createDefaultParsedArgs(CLI_COMMANDS.RUN),
    ...(briefPath ? { briefPath } : {}),
    ...(compoundName ? { compoundName } : {}),
    ...(configPath ? { configPath } : {}),
    dryRun,
    ...(harnessRepoPath ? { harnessRepoPath } : {}),
    ...(judgeProfile ? { judgeProfile } : {}),
    ...(judgeTimeoutSeconds !== undefined ? { judgeTimeoutSeconds } : {}),
    ...(judgeTool ? { judgeTool } : {}),
    json,
    noLocal,
    ...(prompt ? { prompt } : {}),
    resume,
    ...(runId ? { runId } : {}),
    ...(runRoot ? { runRoot } : {}),
    runAction: "dry-run",
    ...(skillPath ? { skillPath } : {}),
    ...(taskCardPath ? { taskCardPath } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

function validateRunArgs(options: {
  readonly briefPath: string | undefined;
  readonly judgeProfile: string | undefined;
  readonly judgeTimeoutSeconds: number | undefined;
  readonly judgeTool: CliProviderJudgeTool | undefined;
  readonly prompt: string | undefined;
  readonly resume: boolean;
  readonly taskCardPath: string | undefined;
}): void {
  if (options.briefPath && options.prompt) {
    throw new HarnessError(
      "Use either --brief or --prompt, not both.",
      "CLI_RUN_BRIEF_AMBIGUOUS",
    );
  }

  if (options.resume && (options.briefPath || options.prompt)) {
    throw new HarnessError(
      "Resume reads the original brief from the run store; omit --brief and --prompt.",
      "CLI_RUN_RESUME_BRIEF_UNSUPPORTED",
    );
  }

  if (
    options.resume &&
    (options.taskCardPath || options.briefPath || options.prompt)
  ) {
    throw new HarnessError(
      "Resume reads the original TaskCard and brief from the run store; omit --task-card, --brief, and --prompt.",
      "CLI_RUN_RESUME_INPUT_UNSUPPORTED",
    );
  }

  if (options.taskCardPath && (options.briefPath || options.prompt)) {
    throw new HarnessError(
      "Use --task-card as the execution input, or use --brief/--prompt without --task-card.",
      "CLI_RUN_TASK_CARD_INPUT_AMBIGUOUS",
    );
  }

  if (
    (options.judgeProfile || options.judgeTimeoutSeconds !== undefined) &&
    !options.judgeTool
  ) {
    throw new HarnessError(
      "--judge-profile and --judge-timeout-seconds require --judge-tool.",
      "CLI_RUN_JUDGE_TOOL_REQUIRED",
    );
  }
}

function parseRunArtifactArgs(
  runAction: "inspect" | "view",
  argv: readonly string[],
): ParsedArgs {
  let harnessRepoPath: string | undefined;
  let json = false;
  let runRoot: string | undefined;
  let threadId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return helpArgs("run");
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--harness-repo") {
      harnessRepoPath = readFlagValue(
        argv,
        index,
        "--harness-repo",
        "CLI_MISSING_HARNESS_REPO",
      );
      index += 1;
      continue;
    }

    if (token === "--run-root") {
      runRoot = readFlagValue(
        argv,
        index,
        "--run-root",
        "CLI_MISSING_RUN_ROOT",
      );
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      unknownArgument(token);
    }

    if (threadId) {
      unknownArgument(token);
    }

    threadId = token;
  }

  if (!threadId) {
    throw new HarnessError(
      `Missing required <thread-id> for run ${runAction}.`,
      "CLI_MISSING_THREAD_ID",
    );
  }

  return {
    ...createDefaultParsedArgs(CLI_COMMANDS.RUN),
    ...(harnessRepoPath ? { harnessRepoPath } : {}),
    json,
    ...(runRoot ? { runRoot } : {}),
    runAction,
    threadId,
  };
}

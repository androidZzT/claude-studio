import { HarnessError } from "@harness/core";

import { CLI_COMMANDS } from "../constants.js";
import type {
  CliProviderJudgeTool,
  ParsedArgs,
  Scope,
} from "../types.js";

export function createDefaultParsedArgs(
  command: ParsedArgs["command"],
): ParsedArgs {
  return {
    adoptSettings: false,
    command,
    check: false,
    dryRun: false,
    force: false,
    interactive: false,
    json: false,
    noLocal: false,
    resume: false,
    skipCapabilities: [],
    scope: "project",
  };
}

export function parseScope(value: string): Scope {
  if (value === "global" || value === "project") {
    return value;
  }

  throw new HarnessError(
    "Invalid value for --scope. Expected `project` or `global`.",
    "CLI_INVALID_SCOPE",
  );
}

export function parseProviderJudgeTool(value: string): CliProviderJudgeTool {
  if (value === "claude-code" || value === "codex") {
    return value;
  }

  throw new HarnessError(
    "Invalid value for --judge-tool. Expected `claude-code` or `codex`.",
    "CLI_INVALID_JUDGE_TOOL",
  );
}

export function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HarnessError(
      `Invalid value for ${flag}. Expected a positive integer.`,
      "CLI_INVALID_NUMBER",
    );
  }

  return parsed;
}

export function readFlagValue(
  argv: readonly string[],
  index: number,
  flag: string,
  errorCode: string,
): string {
  const nextToken = argv[index + 1];
  if (!nextToken) {
    throw new HarnessError(`Missing value for ${flag}.`, errorCode);
  }

  return nextToken;
}

export function unknownArgument(token: string): never {
  throw new HarnessError(
    `Unknown argument: ${token}`,
    "CLI_UNKNOWN_ARGUMENT",
  );
}

export function helpArgs(topic?: ParsedArgs["helpTopic"]): ParsedArgs {
  return {
    ...createDefaultParsedArgs(CLI_COMMANDS.HELP),
    ...(topic ? { helpTopic: topic } : {}),
  };
}

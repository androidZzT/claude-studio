import { CLI_COMMANDS } from "../constants.js";
import type { ParsedArgs } from "../types.js";
import {
  createDefaultParsedArgs,
  readFlagValue,
  unknownArgument,
} from "./common.js";

export function parseReadCommandArgs(
  command: "diff" | "doctor" | "sync",
  argv: readonly string[],
): ParsedArgs {
  let check = false;
  let json = false;
  let configPath: string | undefined;
  let dryRun = false;
  let adoptSettings = false;
  let harnessRepoPath: string | undefined;
  let noLocal = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return createDefaultParsedArgs(CLI_COMMANDS.HELP);
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--check") {
      if (command !== CLI_COMMANDS.DIFF) {
        unknownArgument(token);
      }

      check = true;
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

    if (token === "--harness-repo") {
      if (command === CLI_COMMANDS.DOCTOR) {
        unknownArgument(token);
      }

      harnessRepoPath = readFlagValue(
        argv,
        index,
        "--harness-repo",
        "CLI_MISSING_HARNESS_REPO",
      );
      index += 1;
      continue;
    }

    if (token === "--no-local") {
      if (command === CLI_COMMANDS.DOCTOR) {
        unknownArgument(token);
      }

      noLocal = true;
      continue;
    }

    if (token === "--dry-run") {
      if (command !== CLI_COMMANDS.SYNC) {
        unknownArgument(token);
      }

      dryRun = true;
      continue;
    }

    if (token === "--adopt-settings") {
      if (command !== CLI_COMMANDS.SYNC) {
        unknownArgument(token);
      }

      adoptSettings = true;
      continue;
    }

    unknownArgument(token);
  }

  return {
    ...createDefaultParsedArgs(command),
    check,
    ...(configPath ? { configPath } : {}),
    adoptSettings,
    dryRun,
    ...(harnessRepoPath ? { harnessRepoPath } : {}),
    noLocal,
    json,
  };
}

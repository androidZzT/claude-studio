import { HarnessError } from "@harness/core";

import { CLI_COMMANDS } from "../constants.js";
import type { ParsedArgs } from "../types.js";
import { parseAdoptArgs } from "./adopt.js";
import { createDefaultParsedArgs } from "./common.js";
import { parseHelpArgs } from "./help.js";
import { parseInitArgs } from "./init.js";
import { parseReadCommandArgs } from "./read.js";
import { parseRunArgs } from "./run.js";

export function parseArgv(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) {
    return createDefaultParsedArgs(CLI_COMMANDS.HELP);
  }

  const [command, ...rest] = argv;

  if (command === "--version" || command === CLI_COMMANDS.VERSION) {
    return createDefaultParsedArgs(CLI_COMMANDS.VERSION);
  }

  if (command === "--help") {
    return createDefaultParsedArgs(CLI_COMMANDS.HELP);
  }

  if (command === CLI_COMMANDS.HELP) {
    return parseHelpArgs(rest);
  }

  if (
    command === CLI_COMMANDS.DIFF ||
    command === CLI_COMMANDS.DOCTOR ||
    command === CLI_COMMANDS.SYNC
  ) {
    return parseReadCommandArgs(command, rest);
  }

  if (command === CLI_COMMANDS.ADOPT) {
    return parseAdoptArgs(rest);
  }

  if (command === CLI_COMMANDS.INIT) {
    return parseInitArgs(rest);
  }

  if (command === CLI_COMMANDS.RUN) {
    return parseRunArgs(rest);
  }

  throw new HarnessError(
    "Unsupported command. Use `harness help`.",
    "CLI_INVALID_COMMAND",
  );
}

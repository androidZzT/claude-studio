import { HarnessError } from "@harness/core";

import { CLI_COMMANDS } from "../constants.js";
import type { ParsedArgs } from "../types.js";
import { createDefaultParsedArgs, helpArgs } from "./common.js";

export function parseHelpArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) {
    return createDefaultParsedArgs(CLI_COMMANDS.HELP);
  }

  if (
    argv.length === 1 &&
    (argv[0] === CLI_COMMANDS.INIT ||
      argv[0] === CLI_COMMANDS.ADAPTERS ||
      argv[0] === CLI_COMMANDS.EVAL ||
      argv[0] === CLI_COMMANDS.KM_PAGE_ANALYSIS ||
      argv[0] === CLI_COMMANDS.RUN)
  ) {
    return helpArgs(argv[0]);
  }

  throw new HarnessError(
    "Unsupported help topic. Use `harness help`, `harness init --help`, `harness adapters --help`, `harness eval --help`, `harness km-page-analysis --help`, or `harness run --help`.",
    "CLI_INVALID_HELP_TOPIC",
  );
}

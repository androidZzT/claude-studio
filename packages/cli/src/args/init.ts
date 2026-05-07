import { HarnessError } from "@harness/core";

import { CLI_COMMANDS } from "../constants.js";
import type { ParsedArgs, Scope } from "../types.js";
import {
  createDefaultParsedArgs,
  helpArgs,
  parseScope,
  readFlagValue,
  unknownArgument,
} from "./common.js";

export function parseInitArgs(argv: readonly string[]): ParsedArgs {
  let force = false;
  let initName: string | undefined;
  let json = false;
  let scope: Scope = "project";
  let inPlace = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return helpArgs("init");
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--force") {
      force = true;
      continue;
    }

    if (token === "--in-place") {
      inPlace = true;
      continue;
    }

    if (token === "--scope") {
      scope = parseScope(
        readFlagValue(argv, index, "--scope", "CLI_MISSING_SCOPE"),
      );
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      unknownArgument(token);
    }

    if (initName) {
      unknownArgument(token);
    }

    initName = token;
  }

  if (initName && inPlace) {
    throw new HarnessError(
      "Cannot use [name] together with --in-place.",
      "CLI_INIT_TARGET_AMBIGUOUS",
    );
  }

  return {
    ...createDefaultParsedArgs(CLI_COMMANDS.INIT),
    force,
    ...(initName ? { initName } : {}),
    json,
    scope,
  };
}

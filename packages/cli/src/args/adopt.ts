import { HarnessError } from "@harness/core";

import { CLI_COMMANDS } from "../constants.js";
import type { ParsedArgs } from "../types.js";
import {
  createDefaultParsedArgs,
  readFlagValue,
  unknownArgument,
} from "./common.js";

export function parseAdoptArgs(argv: readonly string[]): ParsedArgs {
  let adoptSource: string | undefined;
  let adoptOutput: string | undefined;
  let dryRun = false;
  let force = false;
  let interactive = false;
  let json = false;
  let name: string | undefined;
  const skipCapabilities: string[] = [];
  let tools: string[] | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return createDefaultParsedArgs(CLI_COMMANDS.HELP);
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--interactive") {
      interactive = true;
      continue;
    }

    if (token === "--force") {
      force = true;
      continue;
    }

    if (token === "--output") {
      adoptOutput = readFlagValue(
        argv,
        index,
        "--output",
        "CLI_MISSING_OUTPUT_PATH",
      );
      index += 1;
      continue;
    }

    if (token === "--name") {
      name = readFlagValue(argv, index, "--name", "CLI_MISSING_NAME");
      index += 1;
      continue;
    }

    if (token === "--skip") {
      skipCapabilities.push(
        readFlagValue(argv, index, "--skip", "CLI_MISSING_SKIP_CAPABILITY"),
      );
      index += 1;
      continue;
    }

    if (token === "--tools") {
      tools = readFlagValue(argv, index, "--tools", "CLI_MISSING_TOOLS")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      unknownArgument(token);
    }

    if (adoptSource) {
      unknownArgument(token);
    }

    adoptSource = token;
  }

  if (!adoptSource) {
    throw new HarnessError(
      "Missing required <source> argument for adopt.",
      "CLI_MISSING_ADOPT_SOURCE",
    );
  }

  return {
    ...createDefaultParsedArgs(CLI_COMMANDS.ADOPT),
    adoptSource,
    ...(adoptOutput ? { adoptOutput } : {}),
    dryRun,
    force,
    interactive,
    json,
    ...(name ? { name } : {}),
    skipCapabilities,
    ...(tools ? { tools } : {}),
  };
}

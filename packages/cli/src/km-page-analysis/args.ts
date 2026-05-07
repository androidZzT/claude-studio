import { HarnessError } from "@harness/core";
import { z } from "zod";

import type { KmPageAnalysisArgs, KmPageAnalysisCommand } from "./types.js";

const kmPageAnalysisArgsSchema = z.object({
  agentCommandTemplate: z.string().min(1).optional(),
  androidRepo: z.string().min(1).optional(),
  business: z.string().min(1).optional(),
  command: z.enum(["clean", "help", "prepare", "run", "status", "validate"]),
  force: z.boolean(),
  harnessRepo: z.string().min(1),
  includeOutput: z.boolean(),
  iosRepo: z.string().min(1).optional(),
  json: z.boolean(),
  knownModules: z.array(z.string().min(1)),
  machproPath: z.string().min(1).optional(),
  machproRepo: z.string().min(1).optional(),
  page: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
});

export function parseKmPageAnalysisArgs(
  argv: readonly string[],
): KmPageAnalysisArgs {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
    return createDefaultArgs("help");
  }

  const [subcommand, ...rest] = argv;
  if (!isKmPageAnalysisCommand(subcommand)) {
    throw new HarnessError(
      "Unsupported km-page-analysis command. Use `harness km-page-analysis --help`.",
      "CLI_INVALID_COMMAND",
    );
  }

  let mutable = createDefaultArgs(subcommand);

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;

    if (token === "--help") {
      return createDefaultArgs("help");
    }

    const booleanFlag = parseBooleanFlag(mutable, token);
    if (booleanFlag) {
      mutable = booleanFlag;
      continue;
    }

    const valueFlag = parseValueFlag(mutable, rest, index, token);
    if (valueFlag) {
      mutable = valueFlag.args;
      index = valueFlag.nextIndex;
      continue;
    }

    throw new HarnessError(`Unknown argument: ${token}`, "CLI_UNKNOWN_ARGUMENT");
  }

  return validateKmPageAnalysisArgs(mutable);
}

export function requireBusinessPage(
  args: KmPageAnalysisArgs,
): Required<Pick<KmPageAnalysisArgs, "business" | "page">> {
  if (!args.business) {
    throw new HarnessError("Missing --business.", "CLI_MISSING_BUSINESS");
  }

  if (!args.page) {
    throw new HarnessError("Missing --page.", "CLI_MISSING_PAGE");
  }

  return {
    business: args.business,
    page: args.page,
  };
}

function parseBooleanFlag(
  args: KmPageAnalysisArgs,
  token: string,
): KmPageAnalysisArgs | undefined {
  if (token === "--force") {
    return { ...args, force: true };
  }

  if (token === "--include-output") {
    return { ...args, includeOutput: true };
  }

  if (token === "--json") {
    return { ...args, json: true };
  }

  return undefined;
}

function parseValueFlag(
  args: KmPageAnalysisArgs,
  argv: readonly string[],
  index: number,
  token: string,
): { args: KmPageAnalysisArgs; nextIndex: number } | undefined {
  const value = (): string => readFlagValue(argv, index, token);

  if (token === "--agent-command-template") {
    return {
      args: { ...args, agentCommandTemplate: value() },
      nextIndex: index + 1,
    };
  }

  if (token === "--android-repo") {
    return { args: { ...args, androidRepo: value() }, nextIndex: index + 1 };
  }

  if (token === "--business") {
    return { args: { ...args, business: value() }, nextIndex: index + 1 };
  }

  if (token === "--harness-repo") {
    return { args: { ...args, harnessRepo: value() }, nextIndex: index + 1 };
  }

  if (token === "--ios-repo") {
    return { args: { ...args, iosRepo: value() }, nextIndex: index + 1 };
  }

  if (token === "--known-module") {
    return {
      args: { ...args, knownModules: [...args.knownModules, value()] },
      nextIndex: index + 1,
    };
  }

  if (token === "--known-modules") {
    return {
      args: {
        ...args,
        knownModules: [
          ...args.knownModules,
          ...value()
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ],
      },
      nextIndex: index + 1,
    };
  }

  if (token === "--machpro-path") {
    return { args: { ...args, machproPath: value() }, nextIndex: index + 1 };
  }

  if (token === "--machpro-repo") {
    return { args: { ...args, machproRepo: value() }, nextIndex: index + 1 };
  }

  if (token === "--page") {
    return { args: { ...args, page: value() }, nextIndex: index + 1 };
  }

  if (token === "--run-id") {
    return { args: { ...args, runId: value() }, nextIndex: index + 1 };
  }

  return undefined;
}

function readFlagValue(
  argv: readonly string[],
  index: number,
  flag: string,
): string {
  const value = argv[index + 1];
  if (!value) {
    throw new HarnessError(
      `Missing value for ${flag}.`,
      "CLI_MISSING_FLAG_VALUE",
    );
  }
  return value;
}

function createDefaultArgs(command: KmPageAnalysisCommand): KmPageAnalysisArgs {
  return {
    command,
    force: false,
    harnessRepo: ".",
    includeOutput: false,
    json: false,
    knownModules: [],
  };
}

function validateKmPageAnalysisArgs(
  args: KmPageAnalysisArgs,
): KmPageAnalysisArgs {
  const result = kmPageAnalysisArgsSchema.safeParse(args);
  if (!result.success) {
    throw new HarnessError(
      `Invalid km-page-analysis arguments: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      "CLI_INVALID_ARGUMENT",
    );
  }
  return args;
}

function isKmPageAnalysisCommand(
  value: string | undefined,
): value is KmPageAnalysisCommand {
  return (
    value === "prepare" ||
    value === "run" ||
    value === "validate" ||
    value === "status" ||
    value === "clean"
  );
}

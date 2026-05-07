import { HarnessError } from "@harness/core";
import { z } from "zod";

import {
  parseNamedAssignment,
  upsertNamedResource,
} from "../named-resources.js";
import type { KmModuleDesignArgs, KmModuleDesignCommand } from "./types.js";

const namedResourceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  subpath: z.string().min(1).optional(),
});

const kmModuleDesignArgsSchema = z.object({
  agentCommandTemplate: z.string().min(1).optional(),
  androidRepo: z.string().min(1).optional(),
  business: z.string().min(1).optional(),
  command: z.enum([
    "clean",
    "contributors",
    "help",
    "integrate",
    "prepare",
    "run",
    "status",
    "validate",
  ]),
  force: z.boolean(),
  harnessRepo: z.string().min(1),
  includeSpecPack: z.boolean(),
  iosRepo: z.string().min(1).optional(),
  json: z.boolean(),
  machproPath: z.string().min(1).optional(),
  machproRepo: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  runIntegrator: z.boolean(),
  sources: z.array(namedResourceSchema),
  targets: z.array(namedResourceSchema),
});

export function parseKmModuleDesignArgs(argv: readonly string[]): KmModuleDesignArgs {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
    return createDefaultArgs("help");
  }

  const [subcommand, ...rest] = argv;
  if (!isKmModuleDesignCommand(subcommand)) {
    throw new HarnessError(
      "Unsupported km-module-design command. Use `harness km-module-design --help`.",
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

    throw new HarnessError(
      `Unknown argument: ${token}`,
      "CLI_UNKNOWN_ARGUMENT",
    );
  }

  return validateKmModuleDesignArgs(mutable);
}

export function requireBusinessModule(
  args: KmModuleDesignArgs,
): Required<Pick<KmModuleDesignArgs, "business" | "module">> {
  if (!args.business) {
    throw new HarnessError("Missing --business.", "CLI_MISSING_BUSINESS");
  }

  if (!args.module) {
    throw new HarnessError("Missing --module.", "CLI_MISSING_MODULE");
  }

  return {
    business: args.business,
    module: args.module,
  };
}

function parseBooleanFlag(
  args: KmModuleDesignArgs,
  token: string,
): KmModuleDesignArgs | undefined {
  if (token === "--force") {
    return { ...args, force: true };
  }

  if (token === "--include-spec-pack") {
    return { ...args, includeSpecPack: true };
  }

  if (token === "--json") {
    return { ...args, json: true };
  }

  if (token === "--run-integrator") {
    return { ...args, runIntegrator: true };
  }

  return undefined;
}

function parseValueFlag(
  args: KmModuleDesignArgs,
  argv: readonly string[],
  index: number,
  token: string,
): { args: KmModuleDesignArgs; nextIndex: number } | undefined {
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

  if (token === "--machpro-path") {
    return { args: { ...args, machproPath: value() }, nextIndex: index + 1 };
  }

  if (token === "--machpro-repo") {
    return { args: { ...args, machproRepo: value() }, nextIndex: index + 1 };
  }

  if (token === "--module") {
    return { args: { ...args, module: value() }, nextIndex: index + 1 };
  }

  if (token === "--run-id") {
    return { args: { ...args, runId: value() }, nextIndex: index + 1 };
  }

  if (token === "--source") {
    const assignment = parseNamedAssignment(value(), token);
    return {
      args: {
        ...args,
        sources: upsertNamedResource(args.sources, assignment.id, {
          path: assignment.value,
        }),
      },
      nextIndex: index + 1,
    };
  }

  if (token === "--source-path") {
    const assignment = parseNamedAssignment(value(), token);
    return {
      args: {
        ...args,
        sources: upsertNamedResource(args.sources, assignment.id, {
          subpath: assignment.value,
        }),
      },
      nextIndex: index + 1,
    };
  }

  if (token === "--source-platform") {
    const assignment = parseNamedAssignment(value(), token);
    return {
      args: {
        ...args,
        sources: upsertNamedResource(args.sources, assignment.id, {
          platform: assignment.value,
        }),
      },
      nextIndex: index + 1,
    };
  }

  if (token === "--target") {
    const assignment = parseNamedAssignment(value(), token);
    return {
      args: {
        ...args,
        targets: upsertNamedResource(args.targets, assignment.id, {
          path: assignment.value,
        }),
      },
      nextIndex: index + 1,
    };
  }

  if (token === "--target-platform") {
    const assignment = parseNamedAssignment(value(), token);
    return {
      args: {
        ...args,
        targets: upsertNamedResource(args.targets, assignment.id, {
          platform: assignment.value,
        }),
      },
      nextIndex: index + 1,
    };
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

function createDefaultArgs(command: KmModuleDesignCommand): KmModuleDesignArgs {
  return {
    command,
    force: false,
    harnessRepo: ".",
    includeSpecPack: false,
    json: false,
    runIntegrator: false,
    sources: [],
    targets: [],
  };
}

function validateKmModuleDesignArgs(args: KmModuleDesignArgs): KmModuleDesignArgs {
  const result = kmModuleDesignArgsSchema.safeParse(args);
  if (!result.success) {
    throw new HarnessError(
      `Invalid km-module-design arguments: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      "CLI_INVALID_ARGUMENT",
    );
  }
  return args;
}

function isKmModuleDesignCommand(
  value: string | undefined,
): value is KmModuleDesignCommand {
  return (
    value === "prepare" ||
    value === "contributors" ||
    value === "integrate" ||
    value === "run" ||
    value === "validate" ||
    value === "status" ||
    value === "clean"
  );
}

import {
  HarnessError,
  describeAdapterCapabilities,
  describeConfiguredAdapters,
  findRegisteredAdapter,
  listRegisteredAdapters,
  loadHarnessConfig
} from "@harness/core";

import { ADAPTERS_HELP_TEXT } from "../constants.js";

interface CommandIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

interface AdaptersCommandDependencies {
  describeCapabilities: typeof describeAdapterCapabilities;
  describeList: typeof describeConfiguredAdapters;
  findAdapter: typeof findRegisteredAdapter;
  listAdapters: typeof listRegisteredAdapters;
  loadConfig: typeof loadHarnessConfig;
}

interface AdaptersCommandArgs {
  readonly adapterId?: string;
  readonly command: "capabilities" | "help" | "list";
  readonly configPath?: string;
  readonly json: boolean;
}

const defaultDependencies: AdaptersCommandDependencies = {
  describeCapabilities: describeAdapterCapabilities,
  describeList: describeConfiguredAdapters,
  findAdapter: findRegisteredAdapter,
  listAdapters: listRegisteredAdapters,
  loadConfig: loadHarnessConfig
};

function renderListLine(id: string, enabledInConfig: boolean, target: string | null, width: number): string {
  const enabledLabel = enabledInConfig ? "enabled" : "disabled";
  const targetLabel = target ?? "null";

  return `  ${id.padEnd(width)}registered  ${enabledLabel}  target=${targetLabel}`;
}

function renderListReport(report: ReturnType<typeof describeConfiguredAdapters>): string[] {
  const lines = ["Adapters"];

  if (report.adapters.length === 0) {
    lines.push("  (none)");
    return lines;
  }

  const width = Math.max(...report.adapters.map((adapter) => adapter.id.length)) + 2;

  for (const adapter of report.adapters) {
    lines.push(renderListLine(adapter.id, adapter.enabled_in_config, adapter.target, width));
  }

  return lines;
}

function renderCapabilitiesReport(report: ReturnType<typeof describeAdapterCapabilities>): string[] {
  const lines = [`Capabilities (schema_version=${report.schema_version})`];

  if (report.adapters.length === 0) {
    lines.push("  (none)");
    return lines;
  }

  for (const adapter of report.adapters) {
    lines.push(`  ${adapter.id}`);

    if (adapter.features.length === 0) {
      lines.push("    (none)");
      continue;
    }

    for (const feature of adapter.features) {
      lines.push(`    - ${feature}`);
    }
  }

  return lines;
}

function parseCommonOptions(argv: readonly string[]): { adapterId?: string; configPath?: string; json: boolean } {
  let adapterId: string | undefined;
  let configPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--format") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError("Missing value for --format.", "CLI_MISSING_FORMAT");
      }

      if (nextToken !== "json") {
        throw new HarnessError("Unsupported value for --format. Expected `json`.", "CLI_INVALID_FORMAT");
      }

      json = true;
      index += 1;
      continue;
    }

    if (token === "--config") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError("Missing value for --config.", "CLI_MISSING_CONFIG_PATH");
      }

      configPath = nextToken;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new HarnessError(`Unknown argument: ${token}`, "CLI_UNKNOWN_ARGUMENT");
    }

    if (adapterId) {
      throw new HarnessError(`Unknown argument: ${token}`, "CLI_UNKNOWN_ARGUMENT");
    }

    adapterId = token;
  }

  return {
    ...(adapterId ? { adapterId } : {}),
    ...(configPath ? { configPath } : {}),
    json
  };
}

function parseAdaptersCommand(argv: readonly string[]): AdaptersCommandArgs {
  if (argv.length === 0) {
    return {
      command: "help",
      json: false
    };
  }

  const [subcommand, ...rest] = argv;

  if (subcommand === "--help" || subcommand === "help") {
    return {
      command: "help",
      json: false
    };
  }

  if (subcommand === "list") {
    if (rest.includes("--help")) {
      return {
        command: "help",
        json: false
      };
    }

    const options = parseCommonOptions(rest);
    if (options.adapterId) {
      throw new HarnessError(`Unknown argument: ${options.adapterId}`, "CLI_UNKNOWN_ARGUMENT");
    }

    return {
      command: "list",
      ...(options.configPath ? { configPath: options.configPath } : {}),
      json: options.json
    };
  }

  if (subcommand === "capabilities") {
    if (rest.includes("--help")) {
      return {
        command: "help",
        json: false
      };
    }

    const options = parseCommonOptions(rest);
    if (options.configPath) {
      throw new HarnessError("`--config` is only supported for `harness adapters list`.", "CLI_UNKNOWN_ARGUMENT");
    }

    return {
      command: "capabilities",
      ...(options.adapterId ? { adapterId: options.adapterId } : {}),
      json: options.json
    };
  }

  throw new HarnessError("Unsupported adapters command. Use `harness adapters --help`.", "CLI_INVALID_COMMAND");
}

export async function runAdaptersCommand(
  argv: readonly string[],
  io: CommandIo,
  dependencies: AdaptersCommandDependencies = defaultDependencies
): Promise<number> {
  const parsed = parseAdaptersCommand(argv);

  if (parsed.command === "help") {
    io.stdout(ADAPTERS_HELP_TEXT);
    return 0;
  }

  if (parsed.command === "list") {
    const loaded = await dependencies.loadConfig(process.cwd(), parsed.configPath);
    const report = dependencies.describeList(loaded.config, dependencies.listAdapters());

    if (parsed.json) {
      io.stdout(JSON.stringify(report, null, 2));
    } else {
      for (const line of renderListReport(report)) {
        io.stdout(line);
      }
    }

    return 0;
  }

  const adapters = parsed.adapterId ? [dependencies.findAdapter(parsed.adapterId)] : dependencies.listAdapters();
  const filteredAdapters = adapters.flatMap((adapter) => (adapter ? [adapter] : []));

  if (parsed.adapterId && filteredAdapters.length === 0) {
    throw new HarnessError(`Adapter \`${parsed.adapterId}\` is not registered.`, "ADAPTER_UNKNOWN");
  }

  const report = dependencies.describeCapabilities(filteredAdapters);

  if (parsed.json) {
    io.stdout(JSON.stringify(report, null, 2));
  } else {
    for (const line of renderCapabilitiesReport(report)) {
      io.stdout(line);
    }
  }

  return 0;
}

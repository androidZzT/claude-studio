import path from "node:path";

import {
  HarnessError,
  createClaudeCodeParser,
  createCodexParser,
  createPassThroughAdapter,
  compareEvalRuns,
  ingestTrajectory,
  inferClaudeCodeSessionId,
  inferCodexSessionId,
  ingestRunTrajectory,
  listEvalLogs,
  runEvalScenario,
} from "@harness/core";
import type {
  CommonEventSource,
  EvalCompareResult,
  EvalLogListEntry,
  EvalScenarioRunResult,
  IngestRunTrajectoryResult,
  TrajectoryAdapter,
} from "@harness/core";

import { EVAL_HELP_TEXT } from "../constants.js";
import { runEvalFunnelCommand } from "./eval-funnel.js";
import { runEvalScoreCommand } from "./eval-score.js";
import { resolveQualityInputs } from "./eval-support.js";

interface CommandIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

interface EvalCommandDependencies {
  createClaudeCodeParser: typeof createClaudeCodeParser;
  createCodexParser: typeof createCodexParser;
  createStubAdapter: typeof createPassThroughAdapter;
  ingestTrajectory: typeof ingestTrajectory;
  inferClaudeCodeSessionId: typeof inferClaudeCodeSessionId;
  inferCodexSessionId: typeof inferCodexSessionId;
  ingestRunTrajectory: typeof ingestRunTrajectory;
  listEvalLogs: typeof listEvalLogs;
  runEvalScenario: typeof runEvalScenario;
  compareEvalRuns: typeof compareEvalRuns;
}

interface EvalCommandArgs {
  readonly command: "compare" | "help" | "ingest" | "list" | "run";
  readonly baseRunRoot?: string;
  readonly bugsPath?: string;
  readonly eventsPath?: string;
  readonly json: boolean;
  readonly jsonlPath?: string;
  readonly lintPath?: string;
  readonly repoPath?: string;
  readonly runRoot?: string;
  readonly runThreadId?: string;
  readonly harnessRepoPath?: string;
  readonly headRunRoot?: string;
  readonly scenarioId?: string;
  readonly sessionId?: string;
  readonly smokePath?: string;
  readonly source: CommonEventSource;
}

const defaultDependencies: EvalCommandDependencies = {
  createClaudeCodeParser,
  createCodexParser,
  createStubAdapter: createPassThroughAdapter,
  ingestTrajectory,
  inferClaudeCodeSessionId,
  inferCodexSessionId,
  ingestRunTrajectory,
  listEvalLogs,
  runEvalScenario,
  compareEvalRuns,
};

function createDefaultArgs(
  command: EvalCommandArgs["command"],
): EvalCommandArgs {
  return {
    command,
    json: false,
    source: "stub",
  };
}

function parseSource(value: string): CommonEventSource {
  if (value === "claude-code" || value === "codex" || value === "stub") {
    return value;
  }

  throw new HarnessError(
    "Invalid value for --source. Expected `stub`, `claude-code`, or `codex`.",
    "CLI_INVALID_EVAL_SOURCE",
  );
}

function parseIngestArgs(argv: readonly string[]): EvalCommandArgs {
  let json = false;
  let jsonlPath: string | undefined;
  let scenarioId: string | undefined;
  let sessionId: string | undefined;
  let source: CommonEventSource = "stub";
  let eventsPath: string | undefined;
  let bugsPath: string | undefined;
  let repoPath: string | undefined;
  let lintPath: string | undefined;
  let smokePath: string | undefined;
  let runThreadId: string | undefined;
  let runRoot: string | undefined;
  let harnessRepoPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return createDefaultArgs("help");
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--scenario" || token === "--scenario-id") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          `Missing value for ${token}.`,
          "CLI_MISSING_EVAL_SCENARIO",
        );
      }

      scenarioId = nextToken;
      index += 1;
      continue;
    }

    if (token === "--source") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --source.",
          "CLI_MISSING_EVAL_SOURCE",
        );
      }

      source = parseSource(nextToken);
      index += 1;
      continue;
    }

    if (token === "--run") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --run.",
          "CLI_MISSING_THREAD_ID",
        );
      }

      runThreadId = nextToken;
      index += 1;
      continue;
    }

    if (token === "--run-root") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --run-root.",
          "CLI_MISSING_RUN_ROOT",
        );
      }

      runRoot = nextToken;
      index += 1;
      continue;
    }

    if (token === "--harness-repo") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --harness-repo.",
          "CLI_MISSING_HARNESS_REPO",
        );
      }

      harnessRepoPath = nextToken;
      index += 1;
      continue;
    }

    if (token === "--session-id") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --session-id.",
          "CLI_MISSING_EVAL_SESSION_ID",
        );
      }

      sessionId = nextToken;
      index += 1;
      continue;
    }

    if (token === "--events") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --events.",
          "CLI_UNKNOWN_ARGUMENT",
        );
      }

      eventsPath = nextToken;
      index += 1;
      continue;
    }

    if (token === "--bugs") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --bugs.",
          "CLI_UNKNOWN_ARGUMENT",
        );
      }

      bugsPath = nextToken;
      index += 1;
      continue;
    }

    if (token === "--repo") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --repo.",
          "CLI_UNKNOWN_ARGUMENT",
        );
      }

      repoPath = nextToken;
      index += 1;
      continue;
    }

    if (token === "--lint") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --lint.",
          "CLI_UNKNOWN_ARGUMENT",
        );
      }

      lintPath = nextToken;
      index += 1;
      continue;
    }

    if (token === "--smoke") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --smoke.",
          "CLI_UNKNOWN_ARGUMENT",
        );
      }

      smokePath = nextToken;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new HarnessError(
        `Unknown argument: ${token}`,
        "CLI_UNKNOWN_ARGUMENT",
      );
    }

    if (jsonlPath) {
      throw new HarnessError(
        `Unknown argument: ${token}`,
        "CLI_UNKNOWN_ARGUMENT",
      );
    }

    jsonlPath = token;
  }

  if (runThreadId && jsonlPath) {
    throw new HarnessError(
      "Use either ingest <jsonl-path> or ingest --run <thread-id>, not both.",
      "CLI_EVAL_INGEST_AMBIGUOUS",
    );
  }

  if (!jsonlPath && !runThreadId) {
    throw new HarnessError(
      "Missing required <jsonl-path>.",
      "CLI_MISSING_EVAL_PATH",
    );
  }

  if (!scenarioId && !runThreadId) {
    throw new HarnessError(
      "Missing required --scenario <id>.",
      "CLI_MISSING_EVAL_SCENARIO",
    );
  }

  return {
    command: "ingest",
    json,
    ...(jsonlPath ? { jsonlPath } : {}),
    ...(scenarioId ? { scenarioId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(eventsPath ? { eventsPath } : {}),
    ...(bugsPath ? { bugsPath } : {}),
    ...(repoPath ? { repoPath } : {}),
    ...(runRoot ? { runRoot } : {}),
    ...(runThreadId ? { runThreadId } : {}),
    ...(harnessRepoPath ? { harnessRepoPath } : {}),
    ...(lintPath ? { lintPath } : {}),
    ...(smokePath ? { smokePath } : {}),
    source,
  };
}

function parseListArgs(argv: readonly string[]): EvalCommandArgs {
  let json = false;
  let scenarioId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return createDefaultArgs("help");
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--scenario" || token === "--scenario-id") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          `Missing value for ${token}.`,
          "CLI_MISSING_EVAL_SCENARIO",
        );
      }

      scenarioId = nextToken;
      index += 1;
      continue;
    }

    throw new HarnessError(
      `Unknown argument: ${token}`,
      "CLI_UNKNOWN_ARGUMENT",
    );
  }

  return {
    command: "list",
    ...(scenarioId ? { scenarioId } : {}),
    json,
    source: "stub",
  };
}

function parseScenarioRunArgs(argv: readonly string[]): EvalCommandArgs {
  let harnessRepoPath: string | undefined;
  let json = false;
  let scenarioId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return createDefaultArgs("help");
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--scenario" || token === "--scenario-id") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          `Missing value for ${token}.`,
          "CLI_MISSING_EVAL_SCENARIO",
        );
      }

      scenarioId = nextToken;
      index += 1;
      continue;
    }

    if (token === "--harness-repo") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --harness-repo.",
          "CLI_MISSING_HARNESS_REPO",
        );
      }

      harnessRepoPath = nextToken;
      index += 1;
      continue;
    }

    throw new HarnessError(
      `Unknown argument: ${token}`,
      "CLI_UNKNOWN_ARGUMENT",
    );
  }

  if (!scenarioId) {
    throw new HarnessError(
      "Missing required --scenario <id>.",
      "CLI_MISSING_EVAL_SCENARIO",
    );
  }

  return {
    command: "run",
    ...(harnessRepoPath ? { harnessRepoPath } : {}),
    json,
    scenarioId,
    source: "stub",
  };
}

function parseCompareArgs(argv: readonly string[]): EvalCommandArgs {
  let baseRunRoot: string | undefined;
  let headRunRoot: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--help") {
      return createDefaultArgs("help");
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--base") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --base.",
          "CLI_MISSING_EVAL_BASE",
        );
      }

      baseRunRoot = nextToken;
      index += 1;
      continue;
    }

    if (token === "--head") {
      const nextToken = argv[index + 1];
      if (!nextToken) {
        throw new HarnessError(
          "Missing value for --head.",
          "CLI_MISSING_EVAL_HEAD",
        );
      }

      headRunRoot = nextToken;
      index += 1;
      continue;
    }

    throw new HarnessError(
      `Unknown argument: ${token}`,
      "CLI_UNKNOWN_ARGUMENT",
    );
  }

  if (!baseRunRoot || !headRunRoot) {
    throw new HarnessError(
      "eval compare requires --base <run-root> and --head <run-root>.",
      "CLI_EVAL_COMPARE_MISSING_RUNS",
    );
  }

  return {
    baseRunRoot,
    command: "compare",
    headRunRoot,
    json,
    source: "stub",
  };
}

function parseEvalCommand(argv: readonly string[]): EvalCommandArgs {
  if (argv.length === 0) {
    return createDefaultArgs("help");
  }

  const [subcommand, ...rest] = argv;

  if (subcommand === "--help" || subcommand === "help") {
    return createDefaultArgs("help");
  }

  if (subcommand === "ingest") {
    return parseIngestArgs(rest);
  }

  if (subcommand === "run") {
    return parseScenarioRunArgs(rest);
  }

  if (subcommand === "compare") {
    return parseCompareArgs(rest);
  }

  if (subcommand === "list") {
    return parseListArgs(rest);
  }

  throw new HarnessError(
    "Unsupported eval command. Use `harness eval --help`.",
    "CLI_INVALID_COMMAND",
  );
}

function renderListReport(entries: readonly EvalLogListEntry[]): string[] {
  if (entries.length === 0) {
    return ["No eval logs found."];
  }

  const headers = {
    scenario_id: "scenario_id",
    run_id: "run_id",
    created: "created",
    event_count: "event_count",
    source: "source",
  };
  const scenarioWidth = Math.max(
    headers.scenario_id.length,
    ...entries.map((entry) => entry.scenario_id.length),
  );
  const runIdWidth = Math.max(
    headers.run_id.length,
    ...entries.map((entry) => entry.run_id.length),
  );
  const createdWidth = Math.max(
    headers.created.length,
    ...entries.map((entry) => entry.created.length),
  );
  const eventCountWidth = Math.max(
    headers.event_count.length,
    ...entries.map((entry) => String(entry.event_count).length),
  );
  const sourceWidth = Math.max(
    headers.source.length,
    ...entries.map((entry) => entry.source.length),
  );

  return [
    `${headers.scenario_id.padEnd(scenarioWidth)}  ${headers.run_id.padEnd(runIdWidth)}  ${headers.created.padEnd(createdWidth)}  ${headers.event_count.padStart(eventCountWidth)}  ${headers.source.padEnd(sourceWidth)}`,
    ...entries.map(
      (entry) =>
        `${entry.scenario_id.padEnd(scenarioWidth)}  ${entry.run_id.padEnd(runIdWidth)}  ${entry.created.padEnd(createdWidth)}  ${String(entry.event_count).padStart(eventCountWidth)}  ${entry.source.padEnd(sourceWidth)}`,
    ),
  ];
}

function renderIngestResult(result: {
  readonly outPath: string;
  readonly eventCount: number;
}): string[] {
  return [`Wrote EvalLog to ${result.outPath}`, `Events: ${result.eventCount}`];
}

function renderRunIngestResult(result: IngestRunTrajectoryResult): string[] {
  return [
    `Wrote EvalLog to ${result.outPath}`,
    `Run root: ${result.runRoot}`,
    `Phases: ${result.phaseCount}`,
    `Events: ${result.eventCount}`,
  ];
}

function renderScenarioRunResult(result: EvalScenarioRunResult): string[] {
  return [
    `Eval scenario ${result.scenario_id}: ${result.status}`,
    `Thread: ${result.thread_id}`,
    `Run root: ${result.run_root}`,
  ];
}

function renderCompareResult(result: EvalCompareResult): string[] {
  return [
    `Eval compare verdict: ${result.verdict}`,
    `Regression: ${result.regression}`,
    `Base task_success_rate: ${result.base.task_success_rate}`,
    `Head task_success_rate: ${result.head.task_success_rate}`,
    `Base tests_green_rate: ${result.base.tests_green_rate}`,
    `Head tests_green_rate: ${result.head.tests_green_rate}`,
    `Base trace_completeness: ${result.base.trace_completeness}`,
    `Head trace_completeness: ${result.head.trace_completeness}`,
    `Base cost: ${result.base.estimated_cost_usd}`,
    `Head cost: ${result.head.estimated_cost_usd}`,
  ];
}

function createAdapterForSource(
  source: CommonEventSource,
  dependencies: EvalCommandDependencies,
): {
  readonly adapter: TrajectoryAdapter;
  readonly requiresSessionInference: boolean;
} {
  if (source === "stub") {
    return {
      adapter: dependencies.createStubAdapter(),
      requiresSessionInference: false,
    };
  }

  if (source === "claude-code") {
    return {
      adapter: dependencies.createClaudeCodeParser(),
      requiresSessionInference: true,
    };
  }

  if (source === "codex") {
    return {
      adapter: dependencies.createCodexParser(),
      requiresSessionInference: true,
    };
  }

  throw new HarnessError(
    `Unsupported eval source: ${source}`,
    "CLI_INVALID_EVAL_SOURCE",
  );
}

async function inferSessionIdForSource(
  parsed: EvalCommandArgs,
  dependencies: EvalCommandDependencies,
  requiresSessionInference: boolean,
): Promise<string | undefined> {
  if (parsed.sessionId) {
    return parsed.sessionId;
  }

  if (!requiresSessionInference) {
    return undefined;
  }

  if (parsed.source === "claude-code") {
    return dependencies.inferClaudeCodeSessionId(parsed.jsonlPath!);
  }

  if (parsed.source === "codex") {
    return dependencies.inferCodexSessionId(parsed.jsonlPath!);
  }

  return undefined;
}

export async function runEvalCommand(
  argv: readonly string[],
  io: CommandIo,
  dependencies: EvalCommandDependencies = defaultDependencies,
): Promise<number> {
  if (argv[0] === "score") {
    return runEvalScoreCommand(argv.slice(1), io);
  }

  if (argv[0] === "funnel") {
    return runEvalFunnelCommand(argv.slice(1), io);
  }

  const parsed = parseEvalCommand(argv);

  if (parsed.command === "help") {
    io.stdout(EVAL_HELP_TEXT);
    return 0;
  }

  if (parsed.command === "run") {
    const result = await dependencies.runEvalScenario(process.cwd(), {
      ...(parsed.harnessRepoPath
        ? {
            harnessRepoPath: path.resolve(process.cwd(), parsed.harnessRepoPath),
          }
        : {}),
      scenarioId: parsed.scenarioId!,
    });

    if (parsed.json) {
      io.stdout(JSON.stringify(result, null, 2));
    } else {
      for (const line of renderScenarioRunResult(result)) {
        io.stdout(line);
      }
    }

    return result.status === "completed" ? 0 : 1;
  }

  if (parsed.command === "compare") {
    const result = await dependencies.compareEvalRuns({
      baseRunRoot: path.resolve(process.cwd(), parsed.baseRunRoot!),
      headRunRoot: path.resolve(process.cwd(), parsed.headRunRoot!),
    });

    if (parsed.json) {
      io.stdout(JSON.stringify(result, null, 2));
    } else {
      for (const line of renderCompareResult(result)) {
        io.stdout(line);
      }
    }

    return result.regression ? 1 : 0;
  }

  if (parsed.command === "ingest") {
    if (parsed.runThreadId) {
      const result = await dependencies.ingestRunTrajectory({
        ...(parsed.harnessRepoPath
          ? {
              harnessRepoPath: path.resolve(
                process.cwd(),
                parsed.harnessRepoPath,
              ),
            }
          : {}),
        ...(parsed.runRoot
          ? { runRoot: path.resolve(process.cwd(), parsed.runRoot) }
          : {}),
        ...(parsed.scenarioId ? { scenarioId: parsed.scenarioId } : {}),
        threadId: parsed.runThreadId,
      });

      if (parsed.json) {
        io.stdout(JSON.stringify(result, null, 2));
      } else {
        for (const line of renderRunIngestResult(result)) {
          io.stdout(line);
        }
      }

      return 0;
    }

    const { adapter, requiresSessionInference } = createAdapterForSource(
      parsed.source,
      dependencies,
    );
    const sessionId = await inferSessionIdForSource(
      parsed,
      dependencies,
      requiresSessionInference,
    );
    const qualityInputs = await resolveQualityInputs(
      {
        ...(parsed.eventsPath ? { eventsPath: parsed.eventsPath } : {}),
        ...(parsed.bugsPath ? { bugsPath: parsed.bugsPath } : {}),
        ...(parsed.repoPath ? { repoPath: parsed.repoPath } : {}),
        ...(parsed.lintPath ? { lintPath: parsed.lintPath } : {}),
        ...(parsed.smokePath ? { smokePath: parsed.smokePath } : {}),
      },
      (message) => io.stderr(message),
    );
    const result = await dependencies.ingestTrajectory({
      adapter,
      jsonlPath: path.resolve(process.cwd(), parsed.jsonlPath!),
      scenarioId: parsed.scenarioId!,
      ...(Object.keys(qualityInputs).length > 0 ? { qualityInputs } : {}),
      ...(sessionId ? { sessionId } : {}),
    });

    if (parsed.json) {
      io.stdout(JSON.stringify(result, null, 2));
    } else {
      for (const line of renderIngestResult(result)) {
        io.stdout(line);
      }
    }

    return 0;
  }

  const entries = await dependencies.listEvalLogs(
    parsed.scenarioId ? { scenarioId: parsed.scenarioId } : {},
  );

  if (parsed.json) {
    io.stdout(JSON.stringify(entries, null, 2));
  } else {
    for (const line of renderListReport(entries)) {
      io.stdout(line);
    }
  }

  return 0;
}

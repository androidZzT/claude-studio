import path from "node:path";

import {
  HarnessError,
  createClaudeCodeParser,
  createCodexParser,
  createPassThroughAdapter,
  inferClaudeCodeSessionId,
  inferCodexSessionId,
  parseTrajectoryEvents,
  scoreFunnel
} from "@harness/core";
import type { CommonEventSource, FunnelScore, TrajectoryAdapter } from "@harness/core";

import { renderFunnelScoreTable, resolveQualityInputs } from "./eval-support.js";

interface CommandIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

interface EvalFunnelArgs {
  readonly bugsPath?: string;
  readonly eventsPath?: string;
  readonly format: "json" | "table";
  readonly lintPath?: string;
  readonly repoPath?: string;
  readonly sessionId?: string;
  readonly smokePath?: string;
  readonly source?: CommonEventSource;
  readonly trajectoryPath: string;
}

const CLAUDE_CODE_SESSION_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const CODEX_SESSION_FILENAME_PATTERN =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function parseSource(value: string): CommonEventSource {
  if (value === "claude-code" || value === "codex" || value === "stub") {
    return value;
  }

  throw new HarnessError("Invalid value for --source. Expected `stub`, `claude-code`, or `codex`.", "CLI_INVALID_EVAL_SOURCE");
}

function readOptionValue(argv: readonly string[], index: number, token: string): { readonly nextIndex: number; readonly value: string } {
  const nextToken = argv[index + 1];

  if (!nextToken) {
    throw new HarnessError(`Missing value for ${token}.`, "CLI_UNKNOWN_ARGUMENT");
  }

  return {
    value: nextToken,
    nextIndex: index + 1
  };
}

function parseEvalFunnelArgs(argv: readonly string[]): EvalFunnelArgs {
  let trajectoryPath: string | undefined;
  let format: "json" | "table" = "table";
  let source: CommonEventSource | undefined;
  let sessionId: string | undefined;
  let eventsPath: string | undefined;
  let bugsPath: string | undefined;
  let repoPath: string | undefined;
  let lintPath: string | undefined;
  let smokePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--trajectory") {
      const parsed = readOptionValue(argv, index, token);
      trajectoryPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--format") {
      const parsed = readOptionValue(argv, index, token);
      if (parsed.value !== "json" && parsed.value !== "table") {
        throw new HarnessError("Invalid value for --format. Expected `table` or `json`.", "CLI_UNKNOWN_ARGUMENT");
      }

      format = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--json") {
      format = "json";
      continue;
    }

    if (token === "--source") {
      const parsed = readOptionValue(argv, index, token);
      source = parseSource(parsed.value);
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--session-id") {
      const parsed = readOptionValue(argv, index, token);
      sessionId = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--events") {
      const parsed = readOptionValue(argv, index, token);
      eventsPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--bugs") {
      const parsed = readOptionValue(argv, index, token);
      bugsPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--repo") {
      const parsed = readOptionValue(argv, index, token);
      repoPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--lint") {
      const parsed = readOptionValue(argv, index, token);
      lintPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (token === "--smoke") {
      const parsed = readOptionValue(argv, index, token);
      smokePath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    throw new HarnessError(`Unknown argument: ${token}`, "CLI_UNKNOWN_ARGUMENT");
  }

  if (!trajectoryPath) {
    throw new HarnessError("Missing required --trajectory <jsonl>.", "CLI_MISSING_EVAL_PATH");
  }

  return {
    trajectoryPath,
    format,
    ...(source ? { source } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(eventsPath ? { eventsPath } : {}),
    ...(bugsPath ? { bugsPath } : {}),
    ...(repoPath ? { repoPath } : {}),
    ...(lintPath ? { lintPath } : {}),
    ...(smokePath ? { smokePath } : {})
  };
}

async function inferSource(trajectoryPath: string): Promise<CommonEventSource> {
  const filename = path.basename(trajectoryPath);

  if (CLAUDE_CODE_SESSION_FILENAME_PATTERN.test(filename)) {
    return "claude-code";
  }

  if (CODEX_SESSION_FILENAME_PATTERN.test(filename)) {
    return "codex";
  }

  throw new HarnessError(
    `Unable to infer trajectory source from \`${filename}\`. Pass --source <stub|claude-code|codex>.`,
    "CLI_INVALID_EVAL_SOURCE"
  );
}

async function resolveAdapter(source: CommonEventSource): Promise<TrajectoryAdapter> {
  if (source === "claude-code") {
    return createClaudeCodeParser();
  }

  if (source === "codex") {
    return createCodexParser();
  }

  return createPassThroughAdapter();
}

async function resolveSessionId(source: CommonEventSource, trajectoryPath: string, sessionId?: string): Promise<string | undefined> {
  if (sessionId) {
    return sessionId;
  }

  if (source === "claude-code") {
    return inferClaudeCodeSessionId(trajectoryPath);
  }

  if (source === "codex") {
    return inferCodexSessionId(trajectoryPath);
  }

  return undefined;
}

function writeScore(io: CommandIo, format: "json" | "table", score: FunnelScore): void {
  if (format === "json") {
    io.stdout(JSON.stringify(score, null, 2));
    return;
  }

  for (const line of renderFunnelScoreTable(score)) {
    io.stdout(line);
  }
}

export async function runEvalFunnelCommand(argv: readonly string[], io: CommandIo): Promise<number> {
  const parsed = parseEvalFunnelArgs(argv);
  const source = parsed.source ?? (await inferSource(parsed.trajectoryPath));
  const adapter = await resolveAdapter(source);
  const sessionId = await resolveSessionId(source, parsed.trajectoryPath, parsed.sessionId);
  const events = await parseTrajectoryEvents({
    adapter,
    jsonlPath: path.resolve(process.cwd(), parsed.trajectoryPath),
    ...(sessionId ? { sessionId } : {})
  });
  const qualityInputs = await resolveQualityInputs(
    {
      ...(parsed.eventsPath ? { eventsPath: parsed.eventsPath } : {}),
      ...(parsed.bugsPath ? { bugsPath: parsed.bugsPath } : {}),
      ...(parsed.repoPath ? { repoPath: parsed.repoPath } : {}),
      ...(parsed.lintPath ? { lintPath: parsed.lintPath } : {}),
      ...(parsed.smokePath ? { smokePath: parsed.smokePath } : {})
    },
    (message) => io.stderr(message)
  );
  const score = scoreFunnel({
    events,
    ...(Object.keys(qualityInputs).length > 0 ? { quality: qualityInputs } : {})
  });

  writeScore(io, parsed.format, score);
  return 0;
}

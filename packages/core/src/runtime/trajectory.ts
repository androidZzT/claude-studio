import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { commonEventSchema } from "../eval/common-event.js";
import type { CommonEvent, CommonEventSource } from "../eval/common-event.js";
import { parseTrajectoryEvents } from "../eval/ingest.js";
import {
  createClaudeCodeParser,
  inferClaudeCodeSessionId,
} from "../eval/parsers/claude-code.js";
import {
  createCodexParser,
  inferCodexSessionId,
} from "../eval/parsers/codex.js";
import { HarnessError } from "../errors.js";
import type { ToolName } from "../harness-config.js";

import type { PhaseSpec } from "./phase-executor.js";
import type { RunStorePaths } from "./run-store.js";

const MAX_TRAJECTORY_SEARCH_FILES = 4000;
const MAX_TRAJECTORY_SEARCH_DEPTH = 8;
const MAX_REASONABLE_EVENT_TOKENS = 5_000_000;

export const normalizedTrajectoryEventKindSchema = z.enum([
  "user_prompt",
  "assistant_message",
  "skill_use",
  "tool_call",
  "tool_result",
  "tokens",
  "final_output",
  "lifecycle",
  "error",
]);

export const phaseTrajectorySummarySchema = z
  .object({
    assistant_message_count: z.number().int().nonnegative(),
    common_events_path: z.string().optional(),
    cwd: z.string().optional(),
    event_count: z.number().int().nonnegative(),
    final_output_preview: z.string().optional(),
    normalized_events_path: z.string().optional(),
    phase_id: z.string().min(1),
    prompt_sha256: z.string().optional(),
    raw_path: z.string().optional(),
    reason: z.string().optional(),
    session_id: z.string().optional(),
    skill_use_count: z.number().int().nonnegative(),
    source: z.enum(["claude-code", "codex", "stub"]).optional(),
    status: z.enum(["captured", "failed", "missing", "skipped"]),
    started_at_iso: z.string().optional(),
    tool_call_count: z.number().int().nonnegative(),
    tool_result_count: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    usage_reliable: z.boolean().default(true),
    usage_warnings: z.array(z.string()).default([]),
    user_prompt_count: z.number().int().nonnegative(),
  })
  .strict();

export type NormalizedTrajectoryEventKind = z.infer<
  typeof normalizedTrajectoryEventKindSchema
>;
export type PhaseTrajectorySummary = z.infer<
  typeof phaseTrajectorySummarySchema
>;

export interface NormalizedTrajectoryEvent {
  readonly event_id: string;
  readonly kind: NormalizedTrajectoryEventKind;
  readonly phase_id: string;
  readonly sequence: number;
  readonly session_id: string;
  readonly source: CommonEventSource;
  readonly timestamp: string;
  readonly error?: string;
  readonly input?: unknown;
  readonly name?: string;
  readonly output?: unknown;
  readonly text?: string;
  readonly tokens?: number;
}

export interface CapturePhaseTrajectoryOptions {
  readonly completedAtMs?: number;
  readonly cwd: string;
  readonly homeDir?: string;
  readonly paths: RunStorePaths;
  readonly phase: PhaseSpec;
  readonly rawTrajectoryPath?: string;
  readonly sessionId?: string;
  readonly promptSha256?: string;
  readonly startedAtIso?: string;
  readonly startedAtMs?: number;
}

interface CandidateFile {
  readonly mtimeMs: number;
  readonly path: string;
}

interface TrajectoryTimeWindow {
  readonly completedAtMs: number;
  readonly startedAtMs: number;
}

function assertSafeArtifactSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new HarnessError(
      `${label} must be a single safe path segment: ${value}`,
      "TRAJECTORY_ARTIFACT_SEGMENT_INVALID",
    );
  }
}

function adapterForTool(tool: ToolName) {
  if (tool === "claude-code") {
    return createClaudeCodeParser();
  }

  if (tool === "codex") {
    return createCodexParser();
  }

  return undefined;
}

function sourceForTool(tool: ToolName): CommonEventSource | undefined {
  if (tool === "claude-code" || tool === "codex") {
    return tool;
  }

  return undefined;
}

function getTokenTotal(event: CommonEvent): number {
  const usage = event.model?.usage;
  if (!usage) {
    return 0;
  }

  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function safeTokenTotal(
  event: NormalizedTrajectoryEvent,
  usageWarnings: string[],
): number {
  const tokens = event.tokens ?? 0;
  if (tokens <= MAX_REASONABLE_EVENT_TOKENS) {
    return tokens;
  }

  usageWarnings.push(
    `ignored outlier token usage ${tokens} for event ${event.event_id}`,
  );
  return 0;
}

function previewText(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 240
    ? `${normalized.slice(0, 240)}...`
    : normalized;
}

function normalizeCommonEvent(
  event: CommonEvent,
  phaseId: string,
  sequence: number,
): NormalizedTrajectoryEvent[] {
  const base = {
    event_id: event.event_id,
    phase_id: phaseId,
    sequence,
    session_id: event.session_id,
    source: event.source,
    timestamp: event.timestamp,
  };

  if (event.kind === "user_input") {
    return [
      {
        ...base,
        kind: "user_prompt",
        ...(event.text !== undefined ? { text: event.text } : {}),
      },
    ];
  }

  if (event.kind === "model") {
    const events: NormalizedTrajectoryEvent[] = [];
    const tokens = getTokenTotal(event);

    if (event.text !== undefined || event.thinking !== undefined) {
      events.push({
        ...base,
        kind: "assistant_message",
        text: event.text ?? event.thinking?.content ?? "",
      });
    }

    if (tokens > 0) {
      events.push({
        ...base,
        kind: "tokens",
        ...(event.model?.id ? { name: event.model.id } : {}),
        tokens,
      });
    }

    return events.length > 0 ? events : [{ ...base, kind: "lifecycle" }];
  }

  if (event.kind === "tool_call") {
    const normalized: NormalizedTrajectoryEvent = {
      ...base,
      kind: "tool_call",
      name: event.tool?.name ?? "unknown",
      ...(event.tool && "input" in event.tool
        ? { input: event.tool.input }
        : {}),
    };

    if ((event.tool?.name ?? "").toLowerCase().includes("skill")) {
      return [
        {
          ...normalized,
          kind: "skill_use",
        },
        normalized,
      ];
    }

    return [normalized];
  }

  if (event.kind === "tool_result") {
    return [
      {
        ...base,
        kind: "tool_result",
        name: event.tool?.name ?? "unknown",
        ...(event.tool && "output" in event.tool
          ? { output: event.tool.output }
          : {}),
        ...(event.tool?.error ? { error: event.tool.error } : {}),
      },
    ];
  }

  if (event.kind === "error") {
    return [
      {
        ...base,
        kind: "error",
        ...(event.text !== undefined ? { error: event.text } : {}),
      },
    ];
  }

  return [
    {
      ...base,
      kind: "lifecycle",
      ...(event.text !== undefined ? { text: event.text } : {}),
    },
  ];
}

export function normalizeTrajectoryEvents(
  events: readonly CommonEvent[],
  phaseId: string,
): readonly NormalizedTrajectoryEvent[] {
  const normalized = events.flatMap((event, index) =>
    normalizeCommonEvent(event, phaseId, index + 1),
  );
  const lastAssistantMessage = [...normalized]
    .reverse()
    .find((event) => event.kind === "assistant_message" && event.text);

  if (!lastAssistantMessage) {
    return normalized;
  }

  return [
    ...normalized,
    {
      ...lastAssistantMessage,
      event_id: `${lastAssistantMessage.event_id}:final`,
      kind: "final_output",
      sequence: normalized.length + 1,
    },
  ];
}

function buildTrajectorySummary(
  options: Pick<
    CapturePhaseTrajectoryOptions,
    "cwd" | "promptSha256" | "startedAtIso"
  >,
  phaseId: string,
  events: readonly CommonEvent[],
  normalizedEvents: readonly NormalizedTrajectoryEvent[],
  rawPath: string,
  commonEventsPath: string,
  normalizedEventsPath: string,
): PhaseTrajectorySummary {
  const usageWarnings: string[] = [];
  const finalOutputPreview = previewText(
    [...normalizedEvents]
      .reverse()
      .find((event) => event.kind === "final_output")?.text,
  );

  return phaseTrajectorySummarySchema.parse({
    assistant_message_count: normalizedEvents.filter(
      (event) => event.kind === "assistant_message",
    ).length,
    common_events_path: commonEventsPath,
    cwd: options.cwd,
    event_count: normalizedEvents.length,
    ...(finalOutputPreview ? { final_output_preview: finalOutputPreview } : {}),
    normalized_events_path: normalizedEventsPath,
    phase_id: phaseId,
    ...(options.promptSha256 ? { prompt_sha256: options.promptSha256 } : {}),
    raw_path: rawPath,
    session_id: events[0]?.session_id,
    skill_use_count: normalizedEvents.filter(
      (event) => event.kind === "skill_use",
    ).length,
    source: events[0]?.source,
    status: "captured",
    ...(options.startedAtIso ? { started_at_iso: options.startedAtIso } : {}),
    tool_call_count: normalizedEvents.filter(
      (event) => event.kind === "tool_call",
    ).length,
    tool_result_count: normalizedEvents.filter(
      (event) => event.kind === "tool_result",
    ).length,
    total_tokens: normalizedEvents.reduce(
      (total, event) => total + safeTokenTotal(event, usageWarnings),
      0,
    ),
    usage_reliable: usageWarnings.length === 0,
    usage_warnings: usageWarnings,
    user_prompt_count: normalizedEvents.filter(
      (event) => event.kind === "user_prompt",
    ).length,
  });
}

async function collectJsonlCandidates(
  rootDir: string,
  depth = 0,
): Promise<CandidateFile[]> {
  if (depth > MAX_TRAJECTORY_SEARCH_DEPTH) {
    return [];
  }

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const candidates: CandidateFile[] = [];
  for (const entry of entries) {
    if (candidates.length >= MAX_TRAJECTORY_SEARCH_FILES) {
      break;
    }

    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...(await collectJsonlCandidates(entryPath, depth + 1)));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const fileStat = await stat(entryPath);
    candidates.push({
      path: entryPath,
      mtimeMs: fileStat.mtimeMs,
    });
  }

  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_TRAJECTORY_SEARCH_FILES);
}

async function inferSessionIdForCandidate(
  tool: ToolName,
  candidatePath: string,
): Promise<string | undefined> {
  try {
    if (tool === "claude-code") {
      return inferClaudeCodeSessionId(candidatePath);
    }

    if (tool === "codex") {
      return await inferCodexSessionId(candidatePath);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function candidateContainsFingerprint(
  candidatePath: string,
  promptSha256: string | undefined,
): Promise<boolean> {
  if (!promptSha256) {
    return false;
  }

  try {
    const source = await readFile(candidatePath, "utf8");
    return source.includes(`Harness-Phase-Fingerprint: ${promptSha256}`);
  } catch {
    return false;
  }
}

function candidateMatchesTimeWindow(
  candidate: CandidateFile,
  timeWindow: TrajectoryTimeWindow | undefined,
): boolean {
  return !timeWindow || isCandidateInPhaseWindow(candidate, timeWindow);
}

async function findRawTrajectoryPath(
  tool: ToolName,
  sessionId: string | undefined,
  homeDir: string,
  promptSha256?: string,
  timeWindow?: TrajectoryTimeWindow,
): Promise<string | undefined> {
  const searchRoot =
    tool === "codex"
      ? path.join(homeDir, ".codex", "sessions")
      : tool === "claude-code"
        ? path.join(homeDir, ".claude", "projects")
        : undefined;
  if (!searchRoot) {
    return undefined;
  }

  const candidates = await collectJsonlCandidates(searchRoot);
  for (const candidate of candidates) {
    if (!candidateMatchesTimeWindow(candidate, timeWindow)) {
      continue;
    }

    if (!sessionId && !promptSha256) {
      continue;
    }

    const candidateSessionId = await inferSessionIdForCandidate(
      tool,
      candidate.path,
    );
    const sessionMatches =
      !sessionId ||
      candidateSessionId === sessionId ||
      path.basename(candidate.path).includes(sessionId);
    const fingerprintMatches = promptSha256
      ? await candidateContainsFingerprint(candidate.path, promptSha256)
      : true;

    if (!sessionId && fingerprintMatches && candidateSessionId) {
      return candidate.path;
    }

    if (sessionId && sessionMatches && fingerprintMatches) {
      return candidate.path;
    }
  }

  return undefined;
}

function isCandidateInPhaseWindow(
  candidate: CandidateFile,
  timeWindow: TrajectoryTimeWindow,
): boolean {
  const lowerBound = timeWindow.startedAtMs - 60_000;
  const upperBound = timeWindow.completedAtMs + 60_000;
  return candidate.mtimeMs >= lowerBound && candidate.mtimeMs <= upperBound;
}

async function writeJsonl(
  filePath: string,
  values: readonly unknown[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${values.map((value) => JSON.stringify(value)).join("\n")}${values.length > 0 ? "\n" : ""}`,
    "utf8",
  );
}

async function writeSummary(
  paths: RunStorePaths,
  phaseId: string,
  summary: PhaseTrajectorySummary,
): Promise<void> {
  assertSafeArtifactSegment(phaseId, "phase_id");
  const trajectoryPhaseDir = path.join(paths.trajectoryDir, phaseId);
  const phaseDir = path.join(paths.phasesDir, phaseId);
  await Promise.all([
    mkdir(trajectoryPhaseDir, { recursive: true }),
    mkdir(phaseDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(trajectoryPhaseDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(phaseDir, "trajectory.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    ),
  ]);
}

export async function capturePhaseTrajectory(
  options: CapturePhaseTrajectoryOptions,
): Promise<PhaseTrajectorySummary> {
  assertSafeArtifactSegment(options.phase.phase_id, "phase_id");

  if (options.phase.trajectory_capture === false) {
    const summary = phaseTrajectorySummarySchema.parse({
      assistant_message_count: 0,
      cwd: options.cwd,
      event_count: 0,
      phase_id: options.phase.phase_id,
      ...(options.promptSha256 ? { prompt_sha256: options.promptSha256 } : {}),
      reason: "trajectory_capture disabled for phase",
      skill_use_count: 0,
      status: "skipped",
      ...(options.startedAtIso ? { started_at_iso: options.startedAtIso } : {}),
      tool_call_count: 0,
      tool_result_count: 0,
      total_tokens: 0,
      usage_reliable: true,
      usage_warnings: [],
      user_prompt_count: 0,
    });
    await writeSummary(options.paths, options.phase.phase_id, summary);
    return summary;
  }

  const adapter = adapterForTool(options.phase.tool);
  const source = sourceForTool(options.phase.tool);
  if (!adapter || !source) {
    const summary = phaseTrajectorySummarySchema.parse({
      assistant_message_count: 0,
      cwd: options.cwd,
      event_count: 0,
      phase_id: options.phase.phase_id,
      ...(options.promptSha256 ? { prompt_sha256: options.promptSha256 } : {}),
      reason: `unsupported trajectory source for tool ${options.phase.tool}`,
      skill_use_count: 0,
      status: "missing",
      ...(options.startedAtIso ? { started_at_iso: options.startedAtIso } : {}),
      tool_call_count: 0,
      tool_result_count: 0,
      total_tokens: 0,
      usage_reliable: true,
      usage_warnings: [],
      user_prompt_count: 0,
    });
    await writeSummary(options.paths, options.phase.phase_id, summary);
    return summary;
  }

  const rawPath =
    options.rawTrajectoryPath ??
    (await findRawTrajectoryPath(
      options.phase.tool,
      options.sessionId,
      options.homeDir ?? os.homedir(),
      options.promptSha256,
      options.startedAtMs !== undefined && options.completedAtMs !== undefined
        ? {
            completedAtMs: options.completedAtMs,
            startedAtMs: options.startedAtMs,
          }
        : undefined,
    ));
  if (!rawPath) {
    const summary = phaseTrajectorySummarySchema.parse({
      assistant_message_count: 0,
      cwd: options.cwd,
      event_count: 0,
      phase_id: options.phase.phase_id,
      reason: options.sessionId
        ? `no ${source} trajectory found for session ${options.sessionId}`
        : options.promptSha256
          ? `no ${source} trajectory found for phase fingerprint ${options.promptSha256}`
          : options.startedAtMs !== undefined &&
              options.completedAtMs !== undefined
            ? `no ${source} trajectory found in phase time window`
            : "session_id missing",
      ...(options.sessionId ? { session_id: options.sessionId } : {}),
      ...(options.promptSha256 ? { prompt_sha256: options.promptSha256 } : {}),
      skill_use_count: 0,
      source,
      status: "missing",
      ...(options.startedAtIso ? { started_at_iso: options.startedAtIso } : {}),
      tool_call_count: 0,
      tool_result_count: 0,
      total_tokens: 0,
      usage_reliable: true,
      usage_warnings: [],
      user_prompt_count: 0,
    });
    await writeSummary(options.paths, options.phase.phase_id, summary);
    return summary;
  }

  try {
    if (
      options.promptSha256 &&
      !(await candidateContainsFingerprint(rawPath, options.promptSha256))
    ) {
      const summary = phaseTrajectorySummarySchema.parse({
        assistant_message_count: 0,
        cwd: options.cwd,
        event_count: 0,
        phase_id: options.phase.phase_id,
        prompt_sha256: options.promptSha256,
        raw_path: rawPath,
        reason: `${source} trajectory candidate did not contain Harness-Phase-Fingerprint`,
        ...(options.sessionId ? { session_id: options.sessionId } : {}),
        skill_use_count: 0,
        source,
        status: "missing",
        ...(options.startedAtIso
          ? { started_at_iso: options.startedAtIso }
          : {}),
        tool_call_count: 0,
        tool_result_count: 0,
        total_tokens: 0,
        usage_reliable: true,
        usage_warnings: [],
        user_prompt_count: 0,
      });
      await writeSummary(options.paths, options.phase.phase_id, summary);
      return summary;
    }

    const sessionId =
      options.sessionId ??
      (await inferSessionIdForCandidate(options.phase.tool, rawPath));
    const commonEvents = await parseTrajectoryEvents({
      adapter,
      jsonlPath: rawPath,
      ...(sessionId ? { sessionId } : {}),
    });
    const normalizedEvents = normalizeTrajectoryEvents(
      commonEvents,
      options.phase.phase_id,
    );
    const trajectoryPhaseDir = path.join(
      options.paths.trajectoryDir,
      options.phase.phase_id,
    );
    const commonEventsPath = path.join(
      trajectoryPhaseDir,
      "common-events.jsonl",
    );
    const normalizedEventsPath = path.join(trajectoryPhaseDir, "events.jsonl");
    await Promise.all([
      writeJsonl(
        commonEventsPath,
        commonEvents.map((event) => commonEventSchema.parse(event)),
      ),
      writeJsonl(normalizedEventsPath, normalizedEvents),
    ]);

    const summary = buildTrajectorySummary(
      {
        cwd: options.cwd,
        ...(options.promptSha256 ? { promptSha256: options.promptSha256 } : {}),
        ...(options.startedAtIso ? { startedAtIso: options.startedAtIso } : {}),
      },
      options.phase.phase_id,
      commonEvents,
      normalizedEvents,
      rawPath,
      commonEventsPath,
      normalizedEventsPath,
    );
    await writeSummary(options.paths, options.phase.phase_id, summary);
    return summary;
  } catch (error) {
    const summary = phaseTrajectorySummarySchema.parse({
      assistant_message_count: 0,
      cwd: options.cwd,
      event_count: 0,
      phase_id: options.phase.phase_id,
      ...(options.promptSha256 ? { prompt_sha256: options.promptSha256 } : {}),
      raw_path: rawPath,
      reason:
        error instanceof Error
          ? error.message
          : "unknown trajectory parse failure",
      ...(options.sessionId ? { session_id: options.sessionId } : {}),
      skill_use_count: 0,
      source,
      status: "failed",
      ...(options.startedAtIso ? { started_at_iso: options.startedAtIso } : {}),
      tool_call_count: 0,
      tool_result_count: 0,
      total_tokens: 0,
      usage_reliable: true,
      usage_warnings: [],
      user_prompt_count: 0,
    });
    await writeSummary(options.paths, options.phase.phase_id, summary);
    return summary;
  }
}

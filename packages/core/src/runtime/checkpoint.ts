import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  applyDeterministicGateOverride,
  evaluateDeterministicSignals,
} from "./deterministic-gates.js";
import type {
  DeterministicCheckpointDecision,
  DeterministicGateOptions,
  DeterministicSignals,
} from "./deterministic-gates.js";
import type { RunStorePaths } from "./run-store.js";

export const checkpointDecisionSchema = z
  .object({
    decision: z.enum(["go", "revise", "escalate"]),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1),
    semantic_findings: z.array(
      z
        .object({
          category: z.enum([
            "contract_consistency",
            "scope_drift",
            "spec_completeness",
            "impl_quality",
          ]),
          severity: z.enum(["critical", "warn", "info"]),
          where: z.string().min(1),
          what: z.string().min(1),
        })
        .strict(),
    ),
    revise_target_phase: z.string().min(1).optional(),
    revise_feedback_md: z.string().min(1).optional(),
    escalate_question_md: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.decision === "revise") {
      if (!decision.revise_target_phase) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revise_target_phase"],
          message: "revise decisions require revise_target_phase.",
        });
      }

      if (!decision.revise_feedback_md) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revise_feedback_md"],
          message: "revise decisions require revise_feedback_md.",
        });
      }
    }

    if (decision.decision === "escalate" && !decision.escalate_question_md) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["escalate_question_md"],
        message: "escalate decisions require escalate_question_md.",
      });
    }
  });

export type CheckpointDecision = z.infer<typeof checkpointDecisionSchema>;

export interface CheckpointCost {
  readonly dollars: number;
  readonly model?: string;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
}

export interface CheckpointJudgeInput {
  readonly checkpoint_id: string;
  readonly model: string;
  readonly prompt: string;
}

export interface CheckpointJudgeOutput {
  readonly cost?: CheckpointCost;
  readonly text: string;
}

export type CheckpointJudge = (
  input: CheckpointJudgeInput,
) => Promise<CheckpointJudgeOutput>;

export type PreviousPhaseModelClass = "opus" | "sonnet" | "codex" | "drift";

export interface RunCheckpointOptions {
  readonly checkpointId: string;
  readonly deterministicGateOptions?: DeterministicGateOptions;
  readonly deterministicSignals: DeterministicSignals;
  readonly judge?: CheckpointJudge;
  readonly model?: string;
  readonly paths: RunStorePaths;
  readonly previousPhaseModelClass: PreviousPhaseModelClass;
  readonly prompt: string;
  readonly timeoutMs?: number;
}

export interface RunCheckpointResult {
  readonly attempts: number;
  readonly decision: DeterministicCheckpointDecision;
  readonly judge_used: boolean;
  readonly model: string;
}

const DEFAULT_CHECKPOINT_TIMEOUT_MS = 60_000;

function assertSafeCheckpointId(checkpointId: string): void {
  if (
    checkpointId.length === 0 ||
    checkpointId === "." ||
    checkpointId === ".." ||
    checkpointId.includes("/") ||
    checkpointId.includes("\\")
  ) {
    throw new Error(
      `checkpointId must be a single safe path segment: ${checkpointId}`,
    );
  }
}

function escalationDecision(
  reasoning: string,
  question: string,
): CheckpointDecision {
  return {
    decision: "escalate",
    confidence: 0,
    reasoning,
    semantic_findings: [],
    escalate_question_md: question,
  };
}

function parseCheckpointDecision(source: string): CheckpointDecision {
  return checkpointDecisionSchema.parse(JSON.parse(source));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
}

function checkpointDirectory(
  paths: RunStorePaths,
  checkpointId: string,
): string {
  assertSafeCheckpointId(checkpointId);
  return path.join(paths.checkpointsDir, checkpointId);
}

function normalizeLowConfidence(
  decision: CheckpointDecision,
): CheckpointDecision {
  if (decision.confidence >= 0.6 || decision.decision === "escalate") {
    return decision;
  }

  return escalationDecision(
    `Checkpoint confidence ${decision.confidence} is below threshold.`,
    "Checkpoint confidence was below 0.6. Please review the previous phase and decide whether to go, revise, or stop.",
  );
}

export function defaultCheckpointModel(
  previousPhaseModelClass: PreviousPhaseModelClass,
): string {
  if (
    previousPhaseModelClass === "opus" ||
    previousPhaseModelClass === "drift"
  ) {
    return "sonnet-4.6";
  }

  return "haiku-4.5";
}

export async function runCheckpoint(
  options: RunCheckpointOptions,
): Promise<RunCheckpointResult> {
  const checkpointDir = checkpointDirectory(
    options.paths,
    options.checkpointId,
  );
  const model =
    options.model ?? defaultCheckpointModel(options.previousPhaseModelClass);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECKPOINT_TIMEOUT_MS;
  let attempts = 0;
  let lastCost: CheckpointCost | undefined;
  let parsedDecision: CheckpointDecision | undefined;

  await mkdir(checkpointDir, { recursive: true });

  if (!options.judge) {
    parsedDecision = {
      confidence: 1,
      decision: "go",
      reasoning:
        "No provider checkpoint judge was configured; deterministic signals decide whether this checkpoint can continue.",
      semantic_findings: [],
    };
  }

  while (options.judge && attempts < 2 && parsedDecision === undefined) {
    attempts += 1;
    const judgeResult = await withTimeout(
      options.judge({
        checkpoint_id: options.checkpointId,
        model,
        prompt: options.prompt,
      }),
      timeoutMs,
    );

    if (judgeResult === "timeout") {
      parsedDecision = escalationDecision(
        "Checkpoint judge timed out.",
        "Checkpoint judge exceeded the timeout. Please review the run state and decide whether to retry, revise, or stop.",
      );
      break;
    }

    lastCost = judgeResult.cost;

    try {
      parsedDecision = parseCheckpointDecision(judgeResult.text);
    } catch {
      if (attempts >= 2) {
        parsedDecision = escalationDecision(
          "Checkpoint judge returned invalid JSON twice.",
          "Checkpoint judge returned invalid JSON twice. Please inspect the previous phase output and provide a decision.",
        );
      }
    }
  }

  const gateResult = evaluateDeterministicSignals(
    options.deterministicSignals,
    options.deterministicGateOptions,
  );
  const decision = applyDeterministicGateOverride(
    normalizeLowConfidence(parsedDecision!),
    gateResult,
  );

  if (lastCost !== undefined) {
    await writeFile(
      path.join(checkpointDir, "cost.json"),
      `${JSON.stringify(lastCost, null, 2)}\n`,
      "utf8",
    );
  }

  await writeFile(
    path.join(checkpointDir, "decision.json"),
    `${JSON.stringify(
      {
        attempts,
        decision,
        judge_used: Boolean(options.judge),
        model,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    attempts,
    decision,
    judge_used: Boolean(options.judge),
    model,
  };
}

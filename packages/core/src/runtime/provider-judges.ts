import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { HarnessError } from "../errors.js";

import type {
  PhaseAuditJudge,
  PhaseAuditJudgeInput,
  PhaseAuditJudgeOutput,
} from "./audit.js";
import { phaseAuditJudgeOutputSchema } from "./audit.js";
import type {
  CheckpointDecision,
  CheckpointJudge,
  CheckpointJudgeInput,
  CheckpointJudgeOutput,
} from "./checkpoint.js";

export type ProviderJudgeTool = "claude-code" | "codex";

export type ProviderJudgeSpawn = (
  file: string,
  args: string[],
  options: {
    readonly cwd: string;
    readonly shell: false;
    readonly stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildProcess;

export interface ProviderJudgeOptions {
  readonly cwd: string;
  readonly profile?: string;
  readonly spawnImpl?: ProviderJudgeSpawn;
  readonly timeoutMs?: number;
  readonly tool: ProviderJudgeTool;
}

const DEFAULT_PROVIDER_JUDGE_TIMEOUT_MS = 60_000;

function spawnArgsForTool(
  tool: ProviderJudgeTool,
  prompt: string,
  profile: string | undefined,
): { readonly args: string[]; readonly file: string } {
  if (tool === "claude-code") {
    return {
      file: "claude",
      args: ["-p", prompt],
    };
  }

  return {
    file: "codex",
    args: ["exec", ...(profile ? ["--profile", profile] : []), prompt],
  };
}

function appendOutput(current: string, chunk: unknown): string {
  return `${current}${String(chunk)}`;
}

export function extractJsonObject(source: string): string {
  const start = source.indexOf("{");
  if (start < 0) {
    throw new HarnessError(
      "Provider judge output did not contain a JSON object.",
      "PROVIDER_JUDGE_JSON_MISSING",
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(start, index + 1);
        JSON.parse(candidate);
        return candidate;
      }
    }
  }

  throw new HarnessError(
    "Provider judge output contained an incomplete JSON object.",
    "PROVIDER_JUDGE_JSON_INCOMPLETE",
  );
}

async function runProviderJudgePrompt(
  options: ProviderJudgeOptions,
  prompt: string,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_JUDGE_TIMEOUT_MS;
  const spawnImpl = options.spawnImpl ?? spawn;
  const plan = spawnArgsForTool(options.tool, prompt, options.profile);
  const child = spawnImpl(plan.file, plan.args, {
    cwd: options.cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new HarnessError(
            `Provider judge timed out after ${timeoutMs}ms.`,
            "PROVIDER_JUDGE_TIMEOUT",
          ),
        );
        return;
      }

      if (exitCode !== 0) {
        reject(
          new HarnessError(
            `Provider judge exited with ${exitCode}: ${stderr.trim()}`,
            "PROVIDER_JUDGE_FAILED",
          ),
        );
        return;
      }

      resolve(stdout);
    });
  });
}

function renderCheckpointJudgePrompt(input: CheckpointJudgeInput): string {
  return [
    "# Provider Checkpoint Judge",
    "",
    `Requested model: ${input.model}`,
    `Checkpoint id: ${input.checkpoint_id}`,
    "",
    "Return JSON only. Do not include Markdown fences or explanatory text.",
    "",
    input.prompt,
  ].join("\n");
}

function escalationDecisionJson(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unknown judge error.";
  const decision: CheckpointDecision = {
    decision: "escalate",
    confidence: 0,
    reasoning: `Provider checkpoint judge failed: ${message}`,
    semantic_findings: [],
    escalate_question_md:
      "Provider checkpoint judge failed. Please inspect the run artifacts and decide whether to continue, revise, or stop.",
  };
  return JSON.stringify(decision);
}

export function createProviderCheckpointJudge(
  options: ProviderJudgeOptions,
): CheckpointJudge {
  return async (
    input: CheckpointJudgeInput,
  ): Promise<CheckpointJudgeOutput> => {
    try {
      const stdout = await runProviderJudgePrompt(
        options,
        renderCheckpointJudgePrompt(input),
      );
      return {
        text: extractJsonObject(stdout),
      };
    } catch (error) {
      return {
        text: escalationDecisionJson(error),
      };
    }
  };
}

function renderAuditJudgePrompt(input: PhaseAuditJudgeInput): string {
  return [
    "# Provider Phase Audit Judge",
    "",
    `Audit id: ${input.audit_id}`,
    `Phase id: ${input.phase.phase_id}`,
    `Agent: ${input.phase.agent}`,
    `Tool: ${input.phase.tool}`,
    `Requested model: ${input.model}`,
    "",
    "Return JSON only with this schema:",
    '{"score":0.0,"findings":[{"severity":"info|warning|critical","message":"..."}],"recommendation":"go|revise|escalate","next_phase_risk":"..."}',
    "",
    "## Deterministic Findings",
    "",
    input.deterministic_findings.length === 0
      ? "- None"
      : input.deterministic_findings
          .map((finding) => `- [${finding.severity}] ${finding.message}`)
          .join("\n"),
    "",
    "## Phase Prompt",
    "",
    input.prompt.slice(0, 12_000),
    "",
    "## Phase Output",
    "",
    input.output_md.slice(0, 12_000),
    "",
  ].join("\n");
}

export function createProviderPhaseAuditJudge(
  options: ProviderJudgeOptions,
): PhaseAuditJudge {
  return async (
    input: PhaseAuditJudgeInput,
  ): Promise<PhaseAuditJudgeOutput> => {
    const stdout = await runProviderJudgePrompt(
      options,
      renderAuditJudgePrompt(input),
    );
    return phaseAuditJudgeOutputSchema.parse(
      JSON.parse(extractJsonObject(stdout)),
    );
  };
}

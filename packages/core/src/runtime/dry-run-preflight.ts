import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";
import { z } from "zod";

import { HarnessError } from "../errors.js";
import {
  hasResolvedModelProfileFields,
  resolveToolModelProfile,
} from "../agent-routing.js";
import { loadHarnessConfig, toolNameSchema } from "../harness-config.js";
import type { HarnessConfig } from "../harness-config.js";
import { GATE_COMMAND_KINDS } from "./safe-command-runner.js";
import type { GateCommand } from "./safe-command-runner.js";
import {
  getDefaultRunRoot,
  isPathIgnoredByGitignore,
  preflightRunRoot,
} from "./run-store.js";
import { resolveCwdRef } from "./phase-executor.js";
import type { PhaseSpec } from "./phase-executor.js";
import { auditBlockingPolicySchema, phaseAuditSpecSchema } from "./audit.js";
import { loadTaskCard } from "./task-card.js";

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const gateCommandSchema = z
  .object({
    allowed_write_roots: z.array(z.string().trim().min(1)).optional(),
    argv: z.array(z.string().trim().min(1)).min(1),
    cwd_ref: z.string().trim().min(1),
    id: z.string().trim().min(1),
    kind: z.enum(GATE_COMMAND_KINDS),
    timeout_seconds: z.number().int().positive(),
  })
  .strict();

const phaseSpecSchema = z
  .object({
    agent: z.string().trim().min(1),
    audit_blocking_policy: auditBlockingPolicySchema.optional(),
    audit_model: z.string().trim().min(1).optional(),
    allowed_write_roots: z.array(z.string().trim().min(1)).optional(),
    checkpoint_model: z.string().trim().min(1).optional(),
    cwd_ref: z.string().trim().min(1),
    gate_commands: z.array(gateCommandSchema).optional(),
    instructions: z
      .union([
        z.string().trim().min(1),
        z.array(z.string().trim().min(1)).min(1),
      ])
      .optional(),
    mode: z.string().trim().min(1).optional(),
    output_schema: z.unknown().optional(),
    parallel_group: z.string().trim().min(1).optional(),
    phase_id: z.string().trim().min(1),
    post_phase_audits: z.array(phaseAuditSpecSchema).optional(),
    pre_phase_gate_commands: z.array(gateCommandSchema).optional(),
    profile: z.string().trim().min(1).optional(),
    provider_stall_timeout_seconds: z.number().int().positive().optional(),
    required_artifacts: z.array(z.string().trim().min(1)).optional(),
    tool: toolNameSchema,
    trajectory_raw_capture: z.enum(["redacted", "off"]).optional(),
    trajectory_capture: z.boolean().optional(),
  })
  .strict();

const skillFrontmatterSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    phases: z.array(phaseSpecSchema).min(1),
  })
  .passthrough();

type ParsedGateCommand = z.infer<typeof gateCommandSchema>;
type ParsedPhaseSpec = z.infer<typeof phaseSpecSchema>;

export interface AutonomousDryRunPhaseReport {
  readonly agent: string;
  readonly audit_blocking_policy: string;
  readonly audit_count: number;
  readonly cwd: string;
  readonly cwd_ref: string;
  readonly gate_command_count: number;
  readonly mode?: string;
  readonly parallel_group?: string;
  readonly phase_id: string;
  readonly pre_phase_gate_command_count: number;
  readonly profile?: string;
  readonly profile_resolved: boolean;
  readonly provider_stall_timeout_seconds?: number;
  readonly tool: string;
  readonly trajectory_capture: boolean;
}

export interface AutonomousDryRunIgnoredPathReport {
  readonly ignored: boolean;
  readonly path: string;
}

export interface AutonomousDryRunReport {
  readonly config_path: string;
  readonly dry_run_only: true;
  readonly harness_repo_path: string;
  readonly note: string;
  readonly phase_graph: readonly AutonomousDryRunPhaseReport[];
  readonly required_ignored_paths: readonly AutonomousDryRunIgnoredPathReport[];
  readonly run_root: string;
  readonly skill_name?: string;
  readonly skill_path: string;
  readonly task_card_hash?: string;
}

export interface AutonomousDryRunOptions {
  readonly compoundName?: string;
  readonly configPath?: string;
  readonly harnessRepoPath?: string;
  readonly noLocal?: boolean;
  readonly runRoot?: string;
  readonly skillPath?: string;
  readonly taskCardPath?: string;
  readonly threadId?: string;
  readonly onWarning?: (message: string) => void;
}

function resolveHarnessRepoPath(cwd: string, harnessRepoPath?: string): string {
  return path.resolve(cwd, harnessRepoPath ?? ".");
}

function assertSafeCompoundName(compoundName: string): void {
  if (
    compoundName.length === 0 ||
    compoundName === "." ||
    compoundName === ".." ||
    compoundName.includes("/") ||
    compoundName.includes("\\")
  ) {
    throw new HarnessError(
      `Compound name must be a single safe path segment: ${compoundName}`,
      "RUN_DRY_RUN_COMPOUND_INVALID",
    );
  }
}

function resolveSkillPath(
  harnessRepoPath: string,
  options: AutonomousDryRunOptions,
): string {
  if (options.skillPath && options.compoundName) {
    throw new HarnessError(
      "Use either --skill or --compound, not both.",
      "RUN_DRY_RUN_SKILL_AMBIGUOUS",
    );
  }

  if (options.skillPath) {
    return path.resolve(harnessRepoPath, options.skillPath);
  }

  if (options.compoundName) {
    assertSafeCompoundName(options.compoundName);
    return path.join(
      harnessRepoPath,
      "skills",
      "compound",
      options.compoundName,
      "SKILL.md",
    );
  }

  throw new HarnessError(
    "Missing --skill or --compound for run --dry-run.",
    "RUN_DRY_RUN_SKILL_MISSING",
  );
}

function parseSkillFrontmatter(
  source: string,
  skillPath: string,
): { readonly name?: string; readonly phases: readonly PhaseSpec[] } {
  const match = source.match(frontmatterPattern);
  if (!match) {
    throw new HarnessError(
      `Skill must have YAML frontmatter with phases: ${skillPath}`,
      "RUN_DRY_RUN_SKILL_FRONTMATTER_MISSING",
    );
  }

  const parsed = skillFrontmatterSchema.parse(YAML.parse(match[1] ?? ""));
  return {
    ...(parsed.name ? { name: parsed.name } : {}),
    phases: parsed.phases.map(normalizePhaseSpec),
  };
}

function normalizeGateCommand(command: ParsedGateCommand): GateCommand {
  return {
    argv: command.argv,
    cwd_ref: command.cwd_ref,
    id: command.id,
    kind: command.kind,
    timeout_seconds: command.timeout_seconds,
    ...(command.allowed_write_roots
      ? { allowed_write_roots: command.allowed_write_roots }
      : {}),
  };
}

function normalizePhaseSpec(phase: ParsedPhaseSpec): PhaseSpec {
  return {
    agent: phase.agent,
    cwd_ref: phase.cwd_ref,
    phase_id: phase.phase_id,
    tool: phase.tool,
    ...(phase.audit_blocking_policy
      ? { audit_blocking_policy: phase.audit_blocking_policy }
      : {}),
    ...(phase.audit_model ? { audit_model: phase.audit_model } : {}),
    ...(phase.allowed_write_roots
      ? { allowed_write_roots: phase.allowed_write_roots }
      : {}),
    ...(phase.checkpoint_model
      ? { checkpoint_model: phase.checkpoint_model }
      : {}),
    ...(phase.gate_commands
      ? { gate_commands: phase.gate_commands.map(normalizeGateCommand) }
      : {}),
    ...(phase.instructions ? { instructions: phase.instructions } : {}),
    ...(phase.mode ? { mode: phase.mode } : {}),
    ...(phase.output_schema !== undefined
      ? { output_schema: phase.output_schema }
      : {}),
    ...(phase.parallel_group ? { parallel_group: phase.parallel_group } : {}),
    ...(phase.post_phase_audits
      ? { post_phase_audits: phase.post_phase_audits }
      : {}),
    ...(phase.pre_phase_gate_commands
      ? {
          pre_phase_gate_commands:
            phase.pre_phase_gate_commands.map(normalizeGateCommand),
        }
      : {}),
    ...(phase.profile ? { profile: phase.profile } : {}),
    ...(phase.provider_stall_timeout_seconds !== undefined
      ? {
          provider_stall_timeout_seconds: phase.provider_stall_timeout_seconds,
        }
      : {}),
    ...(phase.required_artifacts
      ? { required_artifacts: phase.required_artifacts }
      : {}),
    ...(phase.trajectory_raw_capture
      ? { trajectory_raw_capture: phase.trajectory_raw_capture }
      : {}),
    ...(phase.trajectory_capture !== undefined
      ? { trajectory_capture: phase.trajectory_capture }
      : {}),
  };
}

function buildPhaseGraph(
  config: HarnessConfig,
  harnessRepoPath: string,
  phases: readonly PhaseSpec[],
): AutonomousDryRunPhaseReport[] {
  return phases.map((phase) => {
    const profile = resolveToolModelProfile(
      config,
      phase.tool,
      phase.profile ?? phase.agent,
    );
    const profileResolved =
      phase.tool !== "codex" || hasResolvedModelProfileFields(profile);
    if (!profileResolved) {
      throw new HarnessError(
        `Codex phase "${phase.phase_id}" must resolve model config from harness.yaml models.codex for agent/profile "${phase.profile ?? phase.agent}".`,
        "RUN_DRY_RUN_CODEX_PROFILE_MISSING",
      );
    }

    return {
      agent: phase.agent,
      audit_blocking_policy: phase.audit_blocking_policy ?? "critical_only",
      audit_count: phase.post_phase_audits?.length ?? 1,
      cwd: resolveCwdRef(config, harnessRepoPath, phase.cwd_ref),
      cwd_ref: phase.cwd_ref,
      gate_command_count: phase.gate_commands?.length ?? 0,
      ...(phase.mode ? { mode: phase.mode } : {}),
      ...(phase.parallel_group ? { parallel_group: phase.parallel_group } : {}),
      phase_id: phase.phase_id,
      pre_phase_gate_command_count: phase.pre_phase_gate_commands?.length ?? 0,
      ...(phase.profile ? { profile: phase.profile } : {}),
      profile_resolved: profileResolved,
      ...(phase.provider_stall_timeout_seconds !== undefined
        ? {
            provider_stall_timeout_seconds:
              phase.provider_stall_timeout_seconds,
          }
        : {}),
      tool: phase.tool,
      trajectory_capture: phase.trajectory_capture ?? true,
    };
  });
}

async function buildRequiredIgnoredPathReport(
  harnessRepoPath: string,
  runRoot: string,
): Promise<AutonomousDryRunIgnoredPathReport[]> {
  const harnessRuntimePath = path.join(harnessRepoPath, ".harness");
  return [
    {
      path: harnessRuntimePath,
      ignored: await isPathIgnoredByGitignore(
        harnessRepoPath,
        harnessRuntimePath,
      ),
    },
    {
      path: runRoot,
      ignored: await isPathIgnoredByGitignore(harnessRepoPath, runRoot),
    },
  ];
}

export async function runAutonomousDryRunPreflight(
  cwd: string,
  options: AutonomousDryRunOptions,
): Promise<AutonomousDryRunReport> {
  const harnessRepoPath = resolveHarnessRepoPath(cwd, options.harnessRepoPath);
  const loadedConfig = await loadHarnessConfig(
    harnessRepoPath,
    options.configPath,
    {
      ...(options.noLocal !== undefined ? { noLocal: options.noLocal } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    },
  );
  const skillPath = resolveSkillPath(harnessRepoPath, options);
  const skillSource = await readFile(skillPath, "utf8");
  const skillFrontmatter = parseSkillFrontmatter(skillSource, skillPath);
  const taskCard = options.taskCardPath
    ? await loadTaskCard(cwd, options.taskCardPath)
    : undefined;
  const threadId = options.threadId ?? "dry-run";
  const runRoot = path.resolve(
    options.runRoot ?? getDefaultRunRoot(harnessRepoPath, threadId),
  );
  const requiredIgnoredPaths = await buildRequiredIgnoredPathReport(
    harnessRepoPath,
    runRoot,
  );

  await preflightRunRoot(harnessRepoPath, runRoot);

  return {
    config_path: loadedConfig.path,
    dry_run_only: true,
    harness_repo_path: harnessRepoPath,
    note: "Dry-run only. Real execution remains a manual follow-up after review.",
    phase_graph: buildPhaseGraph(
      loadedConfig.config,
      harnessRepoPath,
      skillFrontmatter.phases,
    ),
    required_ignored_paths: requiredIgnoredPaths,
    run_root: runRoot,
    ...(skillFrontmatter.name ? { skill_name: skillFrontmatter.name } : {}),
    skill_path: skillPath,
    ...(taskCard ? { task_card_hash: taskCard.hash } : {}),
  };
}

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";

import { HarnessError } from "@harness/core";

import { requireBusinessModule } from "./args.js";
import { relativeTo, resolveHarnessRepo, shellQuote } from "./paths.js";
import { runProcess } from "./process.js";
import {
  INTEGRATOR_AGENT,
  PARALLEL_AGENTS,
  type AgentResult,
  type KmModuleDesignArgs,
  type WorkflowPaths,
} from "./types.js";

export async function launchParallelContributors(
  paths: WorkflowPaths,
  args: KmModuleDesignArgs,
): Promise<AgentResult[]> {
  return Promise.all(
    PARALLEL_AGENTS.map((agent) => launchAgent(agent, paths, args)),
  );
}

export async function launchIntegrator(
  paths: WorkflowPaths,
  args: KmModuleDesignArgs,
): Promise<AgentResult> {
  return launchAgent(INTEGRATOR_AGENT, paths, args);
}

export function assertAllSucceeded(results: readonly AgentResult[]): void {
  const failed = results.filter((result) => result.exitCode !== 0);
  if (failed.length > 0) {
    throw new HarnessError(
      `Agent phase failed: ${failed.map((result) => `${result.agent}=${result.exitCode}`).join(", ")}`,
      "KM_MODULE_DESIGN_AGENT_FAILED",
    );
  }
}

export async function validateSpecPack(
  args: KmModuleDesignArgs,
): Promise<{ exitCode: number; lines: string[] }> {
  const required = requireBusinessModule(args);
  const harnessRepo = resolveHarnessRepo(args.harnessRepo);
  const specPackDir = path.join(
    "spec-package",
    required.business,
    required.module,
    "spec-pack",
  );
  const result = await runProcess(
    "python3",
    ["scripts/validate-machpro-spec-pack.py", specPackDir],
    harnessRepo,
  );
  const lines = [
    ...result.stdout.trim().split(/\r?\n/),
    ...result.stderr.trim().split(/\r?\n/),
  ]
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    exitCode: result.exitCode,
    lines,
  };
}

async function launchAgent(
  agent: string,
  paths: WorkflowPaths,
  args: KmModuleDesignArgs,
): Promise<AgentResult> {
  if (!args.agentCommandTemplate) {
    throw new HarnessError(
      "Missing --agent-command-template.",
      "KM_MODULE_DESIGN_MISSING_AGENT_COMMAND",
    );
  }

  const command = substituteCommandTemplate(
    args.agentCommandTemplate,
    agent,
    paths,
    args,
  );
  const logPath = path.join(paths.logsDir, `${agent}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`$ ${command}${os.EOL}`);

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(command, {
      cwd: paths.harnessRepo,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.on("close", (code) => {
      logStream.end();
      resolve(code ?? 1);
    });
  });

  return { agent, exitCode, logPath };
}

function substituteCommandTemplate(
  template: string,
  agent: string,
  paths: WorkflowPaths,
  args: KmModuleDesignArgs,
): string {
  const required = requireBusinessModule(args);
  const promptFile = path.join(paths.promptDir, `${agent}.md`);
  const replacements: Record<string, string> = {
    agent,
    business: required.business,
    harness_repo: paths.harnessRepo,
    module: required.module,
    output_dir: paths.specPackDir,
    prompt_file: promptFile,
    run_dir: paths.runDir,
  };

  return template.replaceAll(
    /\{(agent|prompt_file|run_dir|harness_repo|business|module|output_dir)\}/g,
    (_match, key: string) => shellQuote(replacements[key] ?? ""),
  );
}

export function renderAgentResult(
  paths: WorkflowPaths,
  result: AgentResult,
): string {
  return `${result.agent} completed: ${relativeTo(paths.harnessRepo, result.logPath)}`;
}

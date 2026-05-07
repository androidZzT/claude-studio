import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HarnessError } from "@harness/core";

import { requireBusinessPage } from "./args.js";
import {
  pathExists,
  relativeTo,
  resolveHarnessRepo,
  shellQuote,
} from "./paths.js";
import {
  PAGE_ANALYSIS_AGENT,
  type AgentResult,
  type KmPageAnalysisArgs,
  type PageAnalysisPaths,
} from "./types.js";

export async function launchArchitect(
  paths: PageAnalysisPaths,
  args: KmPageAnalysisArgs,
): Promise<AgentResult> {
  if (!args.agentCommandTemplate) {
    throw new HarnessError(
      "Missing --agent-command-template.",
      "KM_PAGE_ANALYSIS_MISSING_AGENT_COMMAND",
    );
  }

  const command = substituteCommandTemplate(
    args.agentCommandTemplate,
    PAGE_ANALYSIS_AGENT,
    paths,
    args,
  );
  const logPath = path.join(paths.logsDir, `${PAGE_ANALYSIS_AGENT}.log`);
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

  return { agent: PAGE_ANALYSIS_AGENT, exitCode, logPath };
}

export function assertSucceeded(result: AgentResult): void {
  if (result.exitCode !== 0) {
    throw new HarnessError(
      `Agent phase failed: ${result.agent}=${result.exitCode}`,
      "KM_PAGE_ANALYSIS_AGENT_FAILED",
    );
  }
}

export async function validatePageAnalysis(
  args: KmPageAnalysisArgs,
): Promise<{ exitCode: number; lines: string[] }> {
  const required = requireBusinessPage(args);
  const harnessRepo = resolveHarnessRepo(args.harnessRepo);
  const outputDir = path.join(
    harnessRepo,
    "spec-package",
    required.business,
    required.page,
  );
  const pageAnalysisPath = path.join(outputDir, "page-analysis.md");
  const dependencyPath = path.join(outputDir, "module-dependency.yaml");
  const errors: string[] = [];

  if (!(await pathExists(pageAnalysisPath))) {
    errors.push(
      `${relativeTo(harnessRepo, pageAnalysisPath)}: required file is missing`,
    );
  }

  if (!(await pathExists(dependencyPath))) {
    errors.push(
      `${relativeTo(harnessRepo, dependencyPath)}: required file is missing`,
    );
  }

  if (errors.length === 0) {
    const pageText = await readFile(pageAnalysisPath, "utf8");
    const dependencyText = await readFile(dependencyPath, "utf8");
    errors.push(
      ...validatePageAnalysisText(harnessRepo, pageAnalysisPath, pageText),
      ...validateDependencyText(harnessRepo, dependencyPath, dependencyText),
    );
  }

  if (errors.length > 0) {
    return {
      exitCode: 1,
      lines: errors.map((error) => `ERROR: ${error}`),
    };
  }

  return {
    exitCode: 0,
    lines: ["KM Page Analysis validation passed."],
  };
}

export function renderAgentResult(
  paths: PageAnalysisPaths,
  result: AgentResult,
): string {
  return `${result.agent} completed: ${relativeTo(paths.harnessRepo, result.logPath)}`;
}

function substituteCommandTemplate(
  template: string,
  agent: string,
  paths: PageAnalysisPaths,
  args: KmPageAnalysisArgs,
): string {
  const required = requireBusinessPage(args);
  const promptFile = path.join(paths.promptDir, `${agent}.md`);
  const replacements: Record<string, string> = {
    agent,
    business: required.business,
    harness_repo: paths.harnessRepo,
    output_dir: paths.outputDir,
    page: required.page,
    prompt_file: promptFile,
    run_dir: paths.runDir,
  };

  return template.replaceAll(
    /\{(agent|prompt_file|run_dir|harness_repo|business|page|output_dir)\}/g,
    (_match, key: string) => shellQuote(replacements[key] ?? ""),
  );
}

function validatePageAnalysisText(
  root: string,
  targetPath: string,
  text: string,
): string[] {
  const errors: string[] = [];
  const cjkChars = text.match(/[\u4e00-\u9fff]/g) ?? [];
  if (cjkChars.length < 20) {
    errors.push(
      `${relativeTo(root, targetPath)}: Markdown document body must be written in Chinese`,
    );
  }

  const requiredMarkers = [
    "页面范围",
    "模块清单",
    "模块职责",
    "复用",
    "依赖",
    "批次",
    "km-module-design",
  ];
  for (const marker of requiredMarkers) {
    if (!text.includes(marker)) {
      errors.push(`${relativeTo(root, targetPath)}: \`${marker}\` section marker is required`);
    }
  }

  return errors;
}

function validateDependencyText(
  root: string,
  targetPath: string,
  text: string,
): string[] {
  const errors: string[] = [];
  const requiredFields = [
    "business_id:",
    "page_id:",
    "source:",
    "modules:",
    "dependencies:",
    "batches:",
    "design_queue:",
  ];
  for (const field of requiredFields) {
    if (!text.includes(field)) {
      errors.push(`${relativeTo(root, targetPath)}: \`${field}\` is required`);
    }
  }

  if (!/module_id:\s*\S+/.test(text)) {
    errors.push(`${relativeTo(root, targetPath)}: at least one module with module_id is required`);
  }

  if (!/kind:\s*\S+/.test(text)) {
    errors.push(`${relativeTo(root, targetPath)}: at least one dependency kind is required`);
  }

  if (!/owner_contract_hint:\s*\S+/.test(text)) {
    errors.push(`${relativeTo(root, targetPath)}: dependencies must include owner_contract_hint`);
  }

  if (!/batch_id:\s*\S+/.test(text)) {
    errors.push(`${relativeTo(root, targetPath)}: at least one batch is required`);
  }

  return errors;
}

import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { HarnessError } from "../errors.js";

import { extractAgents } from "./extractors/agents.js";
import { extractCommands } from "./extractors/commands.js";
import { extractDocs, extractMetrics } from "./extractors/passthrough.js";
import { extractReferenceProjects } from "./extractors/reference-projects.js";
import { extractRules } from "./extractors/rules.js";
import { extractScripts } from "./extractors/scripts.js";
import { extractSettings } from "./extractors/settings.js";
import { extractSkills } from "./extractors/skills.js";
import { buildAdoptGitignore } from "./gitignore-builder.js";
import { buildHarnessYaml } from "./harness-yaml-builder.js";
import type { AdoptFile, AdoptOptions, AdoptResult, CapabilityExtraction } from "./types.js";

const SUPPORTED_TOOLS = new Set(["claude-code"]);

const CAPABILITY_ORDER = [
  "agents",
  "skills",
  "rules",
  "scripts",
  "commands",
  "hooks",
  "mcp",
  "plugins",
  "reference_projects",
  "docs",
  "metrics"
] as const;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function inferTargetDir(sourceDir: string): string {
  return path.join(path.dirname(sourceDir), `${path.basename(sourceDir)}-harness`);
}

function inferHarnessName(sourceDir: string, explicitName?: string): string {
  return explicitName ?? `${path.basename(sourceDir)}-harness`;
}

async function loadCanonicalTemplate(sourceDir: string): Promise<string> {
  const candidatePaths = [path.join(sourceDir, "AGENTS.md"), path.join(sourceDir, "CLAUDE.md")];

  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return readFile(candidatePath, "utf8");
    }
  }

  return `# ${path.basename(sourceDir)}\n\nMigrated from ${sourceDir}.\n`;
}

async function writeAdoptFile(targetDir: string, file: AdoptFile): Promise<string> {
  const absoluteTargetPath = path.join(targetDir, file.targetPath);
  await mkdir(path.dirname(absoluteTargetPath), { recursive: true });

  if (file.sourcePath && file.content === undefined) {
    await copyFile(file.sourcePath, absoluteTargetPath);
  } else {
    await writeFile(absoluteTargetPath, file.content ?? "", { mode: file.mode });
  }

  return file.targetPath;
}

function shouldSkipCapability(capability: string, skipCapabilities: ReadonlySet<string>): boolean {
  return skipCapabilities.has(capability);
}

function collectNonEmptyCapabilities(extractions: readonly CapabilityExtraction[]): string[] {
  return CAPABILITY_ORDER.filter((capability) => extractions.some((extraction) => extraction.capability === capability && extraction.files.length > 0));
}

export async function adoptFromSource(source: string, options: AdoptOptions = {}): Promise<AdoptResult> {
  const sourceDir = path.resolve(source);
  const targetDir = path.resolve(options.outputDir ?? inferTargetDir(sourceDir));
  const harnessName = inferHarnessName(sourceDir, options.name);
  const skipCapabilities = new Set(options.skipCapabilities ?? []);
  const tools = options.tools ?? ["claude-code"];
  const warnings: string[] = [];

  for (const tool of tools) {
    if (!SUPPORTED_TOOLS.has(tool)) {
      throw new HarnessError(`Adopt currently supports only claude-code. Unsupported tool: ${tool}`, "ADOPT_UNSUPPORTED_TOOL");
    }
  }

  if ((await pathExists(targetDir)) && !options.force) {
    throw new HarnessError(`Adopt target already exists: ${targetDir}. Re-run with --force to overwrite it.`, "ADOPT_TARGET_EXISTS");
  }

  const [agents, skills, rules, scripts, commands, docs, metrics, referenceProjects, settings, templateSource] = await Promise.all([
    extractAgents(sourceDir),
    extractSkills(sourceDir, { onWarning: (message) => warnings.push(message) }),
    extractRules(sourceDir),
    extractScripts(sourceDir, { onWarning: (message) => warnings.push(message) }),
    extractCommands(sourceDir),
    extractDocs(sourceDir, { onWarning: (message) => warnings.push(message) }),
    extractMetrics(sourceDir, { onWarning: (message) => warnings.push(message) }),
    extractReferenceProjects(sourceDir),
    extractSettings(sourceDir),
    loadCanonicalTemplate(sourceDir)
  ]);

  warnings.push(...settings.warnings);

  const extractions = [agents, skills, rules, scripts, commands, referenceProjects, docs, metrics].filter(
    (extraction) => !shouldSkipCapability(extraction.capability, skipCapabilities)
  );
  const detectedCapabilities = collectNonEmptyCapabilities(extractions);
  if (settings.hooks && !shouldSkipCapability("hooks", skipCapabilities)) {
    detectedCapabilities.push("hooks");
  }
  if (settings.mcp && !shouldSkipCapability("mcp", skipCapabilities)) {
    detectedCapabilities.push("mcp");
  }
  if (settings.plugins && !shouldSkipCapability("plugins", skipCapabilities)) {
    detectedCapabilities.push("plugins");
  }

  const normalizedCapabilities = CAPABILITY_ORDER.filter((capability) => detectedCapabilities.includes(capability));
  const createdFiles = [
    "AGENTS.md.template",
    ".gitignore",
    "harness.yaml",
    ...extractions.flatMap((extraction) => extraction.files.map((file) => file.targetPath))
  ];

  if (options.dryRun) {
    return {
      targetDir,
      createdFiles,
      detectedCapabilities: normalizedCapabilities,
      skippedCapabilities: [...skipCapabilities].sort((left, right) => left.localeCompare(right)),
      warnings,
      dryRun: true
    };
  }

  if (await pathExists(targetDir)) {
    await rm(targetDir, { recursive: true, force: true });
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "AGENTS.md.template"), templateSource, "utf8");
  await writeFile(path.join(targetDir, ".gitignore"), buildAdoptGitignore(), "utf8");
  await writeFile(
    path.join(targetDir, "harness.yaml"),
    buildHarnessYaml({
      name: harnessName,
      description: `Migrated from ${sourceDir} at ${new Date().toISOString()}`,
      capabilities: normalizedCapabilities,
      ...(settings.hooks && !shouldSkipCapability("hooks", skipCapabilities) ? { hooks: settings.hooks } : {}),
      ...(settings.mcp && !shouldSkipCapability("mcp", skipCapabilities) ? { mcp: settings.mcp } : {}),
      ...(settings.plugins && !shouldSkipCapability("plugins", skipCapabilities) ? { plugins: settings.plugins } : {})
    }),
    "utf8"
  );

  for (const extraction of extractions) {
    for (const file of extraction.files) {
      await writeAdoptFile(targetDir, file);
    }
  }

  return {
    targetDir,
    createdFiles,
    detectedCapabilities: normalizedCapabilities,
    skippedCapabilities: [...skipCapabilities].sort((left, right) => left.localeCompare(right)),
    warnings,
    dryRun: false
  };
}

import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import {
  DEFAULT_CODEX_CONFIG_TEMPLATE_PATH,
  DEFAULT_CODEX_TARGET,
  DEFAULT_CONFIG_FILE,
  DEFAULT_INSTRUCTIONS_TEMPLATE_PATH
} from "./constants.js";
import { HarnessError } from "./errors.js";
import { harnessConfigSchema } from "./harness-config.js";
import type { HarnessConfig } from "./harness-config.js";
import { atomicWriteText, readTextIfExists } from "./reconciler/file-ops.js";

const INIT_TEMPLATE_FILES = Object.freeze([
  {
    source: "harness.yaml.tpl",
    output: DEFAULT_CONFIG_FILE,
    mode: 0o644
  },
  {
    source: "AGENTS.md.tpl",
    output: "AGENTS.md.template",
    mode: 0o644
  },
  {
    source: "codex-config.toml.tpl",
    output: ".codex/config.toml.template",
    mode: 0o644
  },
  {
    source: "gitignore.tpl",
    output: ".gitignore",
    mode: 0o644
  },
  {
    source: "README.md.tpl",
    output: "README.md",
    mode: 0o644
  }
] as const);

const HARNESS_CONFLICT_FILES = Object.freeze(
  INIT_TEMPLATE_FILES.map((file) => file.output).filter((filePath) => filePath === DEFAULT_CONFIG_FILE || filePath === "AGENTS.md.template")
);

interface TemplateContext {
  readonly date: string;
  readonly name: string;
  readonly scope: HarnessConfig["scope"];
}

export interface InitOptions {
  readonly force: boolean;
  readonly scope: HarnessConfig["scope"];
  readonly targetDir: string;
}

export interface InitResult {
  readonly targetDir: string;
  readonly createdFiles: string[];
  readonly skippedFiles: string[];
}

function sortPaths(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => {
    if (left < right) {
      return -1;
    }

    if (left > right) {
      return 1;
    }

    return 0;
  });
}

function getTemplatesDirectory(): string {
  return fileURLToPath(new URL("./templates/", import.meta.url));
}

function createTemplateContext(targetDir: string, scope: HarnessConfig["scope"]): TemplateContext {
  const name = path.basename(targetDir) || "harness-project";

  return {
    date: new Date().toISOString().slice(0, 10),
    name,
    scope
  };
}

function renderTemplate(source: string, context: TemplateContext): string {
  return source.replaceAll("{{name}}", context.name).replaceAll("{{scope}}", context.scope).replaceAll("{{date}}", context.date);
}

async function readTemplateFile(fileName: string): Promise<string> {
  return readFile(path.resolve(getTemplatesDirectory(), fileName), "utf8");
}

async function ensureDirectory(targetDir: string): Promise<void> {
  try {
    const targetStat = await stat(targetDir);

    if (!targetStat.isDirectory()) {
      throw new HarnessError(`Init target is not a directory: ${targetDir}`, "INIT_TARGET_INVALID");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    await mkdir(targetDir, { recursive: true });
  }
}

async function listConflicts(targetDir: string): Promise<string[]> {
  const conflicts = await Promise.all(
    HARNESS_CONFLICT_FILES.map(async (relativePath) => {
      const absolutePath = path.resolve(targetDir, relativePath);
      const existing = await readTextIfExists(absolutePath);

      return existing === undefined ? undefined : relativePath;
    })
  );

  return sortPaths(conflicts.flatMap((entry) => (entry ? [entry] : [])));
}

async function assertTargetIsSafe(targetDir: string, force: boolean): Promise<void> {
  const entries = await readdir(targetDir);
  const conflicts = await listConflicts(targetDir);

  if (conflicts.length > 0 && !force) {
    throw new HarnessError(
      `Refusing to initialize over existing harness files: ${conflicts.join(", ")}. Re-run with --force to overwrite them.`,
      "INIT_TARGET_CONFLICT"
    );
  }

  if (entries.length > 0 && !force) {
    throw new HarnessError(
      `Refusing to initialize non-empty directory without --force: ${targetDir}`,
      "INIT_TARGET_NOT_EMPTY"
    );
  }
}

function createDefaultConfig(context: TemplateContext): HarnessConfig {
  return harnessConfigSchema.parse({
    adapters: {
      codex: {
        enabled: true,
        target: DEFAULT_CODEX_TARGET
      }
    },
    canonical: {
      codexConfig: DEFAULT_CODEX_CONFIG_TEMPLATE_PATH,
      instructions: DEFAULT_INSTRUCTIONS_TEMPLATE_PATH
    },
    name: context.name,
    scope: context.scope,
    tools: ["codex"]
  });
}

async function renderInitFile(fileName: string, context: TemplateContext): Promise<string> {
  const rendered = renderTemplate(await readTemplateFile(fileName), context);

  if (fileName === "harness.yaml.tpl") {
    harnessConfigSchema.parse(YAML.parse(rendered));
  }

  return rendered;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const targetDir = path.resolve(options.targetDir);

  await ensureDirectory(targetDir);
  await assertTargetIsSafe(targetDir, options.force);

  const validatedConfig = createDefaultConfig(createTemplateContext(targetDir, options.scope));
  const context: TemplateContext = {
    date: new Date().toISOString().slice(0, 10),
    name: validatedConfig.name,
    scope: validatedConfig.scope
  };
  const createdFiles: string[] = [];

  for (const file of INIT_TEMPLATE_FILES) {
    const content = await renderInitFile(file.source, context);
    const outputPath = path.resolve(targetDir, file.output);

    await atomicWriteText(outputPath, content, file.mode);
    createdFiles.push(file.output);
  }

  return {
    targetDir,
    createdFiles: sortPaths(createdFiles),
    skippedFiles: []
  };
}

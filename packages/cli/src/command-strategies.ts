import path from "node:path";

import { renderRunInspectionText } from "@harness/core";

import { parseArgv } from "./args/index.js";
import { runAdaptersCommand } from "./commands/adapters.js";
import { runEvalCommand } from "./commands/eval.js";
import { runKmModuleDesignCommand } from "./commands/km-module-design.js";
import { CLI_COMMANDS } from "./constants.js";
import { resolveDependencies } from "./dependencies.js";
import {
  formatDoctorLine,
  getExitCodeForError,
  getHelpText,
  hasDrift,
  renderAdoptResult,
  renderAutonomousDryRunReport,
  renderAutonomousRunReport,
  renderInitResult,
  renderReconcileResult,
  renderRunVisualizationResult,
} from "./renderers.js";
import type { CliDependencies, CliIo, ParsedArgs } from "./types.js";

interface CommandContext {
  readonly dependencies: Required<CliDependencies>;
  readonly io: CliIo;
}

interface RawCommandStrategy {
  readonly command: string;
  execute(argv: readonly string[], context: CommandContext): Promise<number>;
  matches(argv: readonly string[]): boolean;
}

interface ParsedCommandStrategy {
  readonly command: ParsedArgs["command"];
  execute(parsed: ParsedArgs, context: CommandContext): Promise<number>;
}

const rawCommandStrategies: readonly RawCommandStrategy[] = [
  {
    command: CLI_COMMANDS.ADAPTERS,
    matches: (argv) => argv[0] === CLI_COMMANDS.ADAPTERS,
    async execute(argv, context) {
      return runAdaptersCommand(argv.slice(1), context.io);
    },
  },
  {
    command: CLI_COMMANDS.EVAL,
    matches: (argv) => argv[0] === CLI_COMMANDS.EVAL,
    async execute(argv, context) {
      return runEvalCommand(argv.slice(1), context.io);
    },
  },
  {
    command: CLI_COMMANDS.KM_MODULE_DESIGN,
    matches: (argv) => argv[0] === CLI_COMMANDS.KM_MODULE_DESIGN,
    async execute(argv, context) {
      return runKmModuleDesignCommand(argv.slice(1), context.io);
    },
  },
];

const parsedCommandStrategies: readonly ParsedCommandStrategy[] = [
  {
    command: CLI_COMMANDS.VERSION,
    async execute(_parsed, context) {
      context.io.stdout(await context.dependencies.loadVersion());
      return 0;
    },
  },
  {
    command: CLI_COMMANDS.HELP,
    async execute(parsed, context) {
      context.io.stdout(getHelpText(parsed.helpTopic));
      return 0;
    },
  },
  {
    command: CLI_COMMANDS.INIT,
    async execute(parsed, context) {
      const targetDir = parsed.initName
        ? path.resolve(process.cwd(), parsed.initName)
        : process.cwd();
      const result = await context.dependencies.runInit({
        force: parsed.force,
        scope: parsed.scope,
        targetDir,
      });

      writeJsonOrLines(context.io, parsed.json, result, renderInitResult);
      return 0;
    },
  },
  {
    command: CLI_COMMANDS.ADOPT,
    async execute(parsed, context) {
      const baseAdoptOptions = {
        force: parsed.force,
        interactive: parsed.interactive,
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.adoptOutput
          ? { outputDir: path.resolve(process.cwd(), parsed.adoptOutput) }
          : {}),
        skipCapabilities: parsed.skipCapabilities,
        ...(parsed.tools ? { tools: parsed.tools } : {}),
      };

      const interactiveSkips = parsed.interactive
        ? await context.dependencies.promptAdoptCapabilities(
            (
              await context.dependencies.runAdopt(parsed.adoptSource!, {
                ...baseAdoptOptions,
                dryRun: true,
              })
            ).detectedCapabilities,
            context.io,
          )
        : [];

      const result = await context.dependencies.runAdopt(parsed.adoptSource!, {
        ...baseAdoptOptions,
        dryRun: parsed.dryRun,
        skipCapabilities: [
          ...new Set([...parsed.skipCapabilities, ...interactiveSkips]),
        ],
      });

      writeJsonOrLines(context.io, parsed.json, result, renderAdoptResult);
      return 0;
    },
  },
  {
    command: CLI_COMMANDS.RUN,
    async execute(parsed, context) {
      return executeRunCommand(parsed, context);
    },
  },
  {
    command: CLI_COMMANDS.DIFF,
    async execute(parsed, context) {
      return executeReconcileCommand(parsed, context);
    },
  },
  {
    command: CLI_COMMANDS.SYNC,
    async execute(parsed, context) {
      return executeReconcileCommand(parsed, context);
    },
  },
  {
    command: CLI_COMMANDS.DOCTOR,
    async execute(parsed, context) {
      const report = await context.dependencies.runDoctor(parsed.configPath);

      if (parsed.json) {
        context.io.stdout(JSON.stringify(report, null, 2));
      } else {
        context.io.stdout(`Doctor report for ${report.projectName}`);
        context.io.stdout(`Config: ${report.configPath}`);
        for (const check of report.checks) {
          context.io.stdout(formatDoctorLine(check));
        }
        context.io.stdout(
          `Summary: ${report.summary.pass} pass, ${report.summary.fail} fail`,
        );
      }

      return report.summary.fail > 0 ? 1 : 0;
    },
  },
];

const parsedStrategyByCommand = new Map(
  parsedCommandStrategies.map((strategy) => [strategy.command, strategy]),
);

export async function executeCli(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliDependencies,
): Promise<number> {
  const context: CommandContext = {
    dependencies: resolveDependencies(dependencies),
    io,
  };

  try {
    const rawStrategy = rawCommandStrategies.find((strategy) =>
      strategy.matches(argv),
    );
    if (rawStrategy) {
      return await rawStrategy.execute(argv, context);
    }

    const parsed = parseArgv(argv);
    const strategy = parsedStrategyByCommand.get(parsed.command);
    if (!strategy) {
      throw new Error(`No CLI strategy registered for ${parsed.command}`);
    }

    return await strategy.execute(parsed, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    io.stderr(`Error: ${message}`);
    return getExitCodeForError(error);
  }
}

function writeJsonOrLines<T>(
  io: CliIo,
  json: boolean,
  result: T,
  render: (result: T) => readonly string[],
): void {
  if (json) {
    io.stdout(JSON.stringify(result, null, 2));
    return;
  }

  for (const line of render(result)) {
    io.stdout(line);
  }
}

async function executeRunCommand(
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<number> {
  if (parsed.runAction === "inspect") {
    const report = await context.dependencies.inspectRun({
      ...(parsed.harnessRepoPath
        ? { harnessRepoPath: parsed.harnessRepoPath }
        : {}),
      ...(parsed.runRoot ? { runRoot: parsed.runRoot } : {}),
      threadId: parsed.threadId!,
    });

    writeJsonOrLines(context.io, parsed.json, report, renderRunInspectionText);
    return 0;
  }

  if (parsed.runAction === "view") {
    const result = await context.dependencies.viewRun({
      ...(parsed.harnessRepoPath
        ? { harnessRepoPath: parsed.harnessRepoPath }
        : {}),
      ...(parsed.runRoot ? { runRoot: parsed.runRoot } : {}),
      threadId: parsed.threadId!,
    });

    writeJsonOrLines(
      context.io,
      parsed.json,
      result,
      renderRunVisualizationResult,
    );
    return 0;
  }

  if (parsed.dryRun) {
    const report = await context.dependencies.runAutonomousDryRun({
      ...(parsed.compoundName ? { compoundName: parsed.compoundName } : {}),
      ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
      ...(parsed.harnessRepoPath
        ? { harnessRepoPath: parsed.harnessRepoPath }
        : {}),
      noLocal: parsed.noLocal,
      onWarning: (message) => context.io.stderr(message),
      ...(parsed.runRoot ? { runRoot: parsed.runRoot } : {}),
      ...(parsed.skillPath ? { skillPath: parsed.skillPath } : {}),
      ...(parsed.taskCardPath ? { taskCardPath: parsed.taskCardPath } : {}),
      ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
    });

    writeJsonOrLines(
      context.io,
      parsed.json,
      report,
      renderAutonomousDryRunReport,
    );
    return 0;
  }

  const report = await context.dependencies.runAutonomousExecution({
    ...(parsed.briefPath ? { briefPath: parsed.briefPath } : {}),
    ...(parsed.compoundName ? { compoundName: parsed.compoundName } : {}),
    ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
    ...(parsed.harnessRepoPath
      ? { harnessRepoPath: parsed.harnessRepoPath }
      : {}),
    ...(parsed.judgeProfile ? { judgeProfile: parsed.judgeProfile } : {}),
    ...(parsed.judgeTimeoutSeconds !== undefined
      ? { judgeTimeoutSeconds: parsed.judgeTimeoutSeconds }
      : {}),
    ...(parsed.judgeTool ? { judgeTool: parsed.judgeTool } : {}),
    noLocal: parsed.noLocal,
    onWarning: (message) => context.io.stderr(message),
    ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
    resume: parsed.resume,
    ...(parsed.runId ? { runId: parsed.runId } : {}),
    ...(parsed.runRoot ? { runRoot: parsed.runRoot } : {}),
    ...(parsed.skillPath ? { skillPath: parsed.skillPath } : {}),
    ...(parsed.taskCardPath ? { taskCardPath: parsed.taskCardPath } : {}),
    ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
  });

  writeJsonOrLines(context.io, parsed.json, report, renderAutonomousRunReport);
  return report.status === "completed" ? 0 : 1;
}

async function executeReconcileCommand(
  parsed: ParsedArgs,
  context: CommandContext,
): Promise<number> {
  const result =
    parsed.command === CLI_COMMANDS.DIFF
      ? await context.dependencies.runDiff(parsed.configPath, {
          ...(parsed.harnessRepoPath
            ? { harnessRepoPath: parsed.harnessRepoPath }
            : {}),
          noLocal: parsed.noLocal,
          onWarning: (message) => context.io.stderr(message),
        })
      : await context.dependencies.runSync(parsed.configPath, parsed.dryRun, {
          adoptPartialJsonOwnership: parsed.adoptSettings,
          ...(parsed.harnessRepoPath
            ? { harnessRepoPath: parsed.harnessRepoPath }
            : {}),
          noLocal: parsed.noLocal,
          onWarning: (message) => context.io.stderr(message),
        });

  writeJsonOrLines(context.io, parsed.json, result, (value) =>
    renderReconcileResult(
      parsed.command as "diff" | "sync",
      value,
      parsed.dryRun,
    ),
  );

  if (
    parsed.command === CLI_COMMANDS.DIFF &&
    parsed.check &&
    hasDrift(result)
  ) {
    return 1;
  }

  return 0;
}

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import { HarnessError } from "../errors.js";

export const GATE_COMMAND_KINDS = [
  "compile",
  "test",
  "lint",
  "diff",
  "review",
  "drift",
  "env",
] as const;

export type GateCommandKind = (typeof GATE_COMMAND_KINDS)[number];

export interface GateCommand {
  readonly allowed_write_roots?: readonly string[];
  readonly argv: readonly string[];
  readonly cwd_ref: string;
  readonly id: string;
  readonly kind: GateCommandKind;
  readonly timeout_seconds: number;
}

export interface GateCommandResult {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly duration_ms: number;
  readonly environment?: GateCommandEnvironmentReport;
  readonly failure_category?: GateCommandFailureCategory;
  readonly exit_code: number | null;
  readonly id: string;
  readonly kind: GateCommandKind;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timed_out: boolean;
}

export interface GateCommandRunOptions {
  readonly android_sdk_search_paths?: readonly string[];
  readonly cwd: string;
  readonly max_output_bytes?: number;
  readonly spawnImpl?: GateCommandSpawn;
}

export type GateCommandSpawn = (
  file: string,
  args: string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly shell: false;
    readonly stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildProcess;

export type GateCommandFailureCategory = "environment_blocked";

export interface GateCommandEnvironmentReport {
  readonly android_sdk?: {
    readonly path?: string;
    readonly source?: "env" | "well-known";
    readonly status: "configured" | "missing" | "not-applicable";
  };
}

const SHELL_META_PATTERN = /[|&;><]|`|\$\(/;
const BLOCKED_COMMANDS = new Set(["rm", "mv", "curl", "wget", "ssh", "scp"]);
const BLOCKED_GIT_SUBCOMMANDS = new Set([
  "commit",
  "push",
  "reset",
  "checkout",
]);
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const ANDROID_GRADLE_COMMANDS = new Set(["gradle", "gradlew", "gradlew.bat"]);

function commandBasename(command: string): string {
  return path.basename(command).toLowerCase();
}

function appendBoundedOutput(
  current: string,
  chunk: unknown,
  maxOutputBytes: number,
): string {
  const next = `${current}${String(chunk)}`;

  if (Buffer.byteLength(next, "utf8") <= maxOutputBytes) {
    return next;
  }

  return `${next.slice(0, maxOutputBytes)}\n[truncated by harness]`;
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function defaultAndroidSdkSearchPaths(): readonly string[] {
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), "Library", "Android", "sdk"),
    path.join(os.homedir(), "Android", "Sdk"),
    "/opt/android-sdk",
    "/usr/local/share/android-sdk",
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function shouldPrepareAndroidSdk(command: GateCommand): boolean {
  const executable = command.argv[0];
  if (
    !executable ||
    !ANDROID_GRADLE_COMMANDS.has(commandBasename(executable))
  ) {
    return false;
  }

  const hintText =
    `${command.cwd_ref} ${command.id} ${command.argv.join(" ")}`.toLowerCase();
  return hintText.includes("android");
}

async function resolveAndroidSdkPath(
  searchPaths: readonly string[],
): Promise<
  { readonly path: string; readonly source: "env" | "well-known" } | undefined
> {
  for (const candidate of searchPaths) {
    if (await pathExists(candidate)) {
      return {
        path: candidate,
        source:
          candidate === process.env.ANDROID_HOME ||
          candidate === process.env.ANDROID_SDK_ROOT
            ? "env"
            : "well-known",
      };
    }
  }

  return undefined;
}

async function prepareGateEnvironment(
  command: GateCommand,
  options: GateCommandRunOptions,
): Promise<{
  readonly env?: NodeJS.ProcessEnv;
  readonly failure?: {
    readonly environment: GateCommandEnvironmentReport;
    readonly failure_category: GateCommandFailureCategory;
    readonly stderr: string;
  };
  readonly report?: GateCommandEnvironmentReport;
}> {
  if (!shouldPrepareAndroidSdk(command)) {
    return {
      report: { android_sdk: { status: "not-applicable" } },
    };
  }

  const sdk = await resolveAndroidSdkPath(
    options.android_sdk_search_paths ?? defaultAndroidSdkSearchPaths(),
  );

  if (!sdk) {
    return {
      failure: {
        environment: { android_sdk: { status: "missing" } },
        failure_category: "environment_blocked",
        stderr:
          "Android SDK location not found. Set ANDROID_HOME or ANDROID_SDK_ROOT, or install the SDK in a well-known location before running Android Gradle gates.",
      },
    };
  }

  return {
    env: {
      ...process.env,
      ANDROID_HOME: sdk.path,
      ANDROID_SDK_ROOT: sdk.path,
    },
    report: {
      android_sdk: {
        path: sdk.path,
        source: sdk.source,
        status: "configured",
      },
    },
  };
}

export function validateGateCommand(command: GateCommand): void {
  if (command.argv.length === 0) {
    throw new HarnessError(
      `Gate command "${command.id}" must declare argv.`,
      "GATE_COMMAND_EMPTY_ARGV",
    );
  }

  const executable = command.argv[0]!;

  if (SHELL_META_PATTERN.test(executable)) {
    throw new HarnessError(
      `Gate command "${command.id}" executable must not contain shell metacharacters.`,
      "GATE_COMMAND_SHELL_META",
    );
  }

  const baseCommand = commandBasename(executable);
  if (BLOCKED_COMMANDS.has(baseCommand)) {
    throw new HarnessError(
      `Gate command "${command.id}" cannot run blocked command "${baseCommand}".`,
      "GATE_COMMAND_BLOCKED",
    );
  }

  if (
    baseCommand === "git" &&
    BLOCKED_GIT_SUBCOMMANDS.has(command.argv[1] ?? "")
  ) {
    throw new HarnessError(
      `Gate command "${command.id}" cannot run git ${command.argv[1]}.`,
      "GATE_COMMAND_BLOCKED",
    );
  }
}

export async function runGateCommand(
  command: GateCommand,
  options: GateCommandRunOptions,
): Promise<GateCommandResult> {
  validateGateCommand(command);

  const maxOutputBytes = options.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = Date.now();
  const environment = await prepareGateEnvironment(command, options);
  if (environment.failure) {
    return {
      argv: command.argv,
      cwd: options.cwd,
      duration_ms: Date.now() - startedAt,
      environment: environment.failure.environment,
      exit_code: 1,
      failure_category: environment.failure.failure_category,
      id: command.id,
      kind: command.kind,
      signal: null,
      stderr: environment.failure.stderr,
      stdout: "",
      timed_out: false,
    };
  }

  const spawnImpl = options.spawnImpl ?? spawn;
  const child = spawnImpl(command.argv[0]!, [...command.argv.slice(1)], {
    cwd: options.cwd,
    ...(environment.env ? { env: environment.env } : {}),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout = appendBoundedOutput(stdout, chunk, maxOutputBytes);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendBoundedOutput(stderr, chunk, maxOutputBytes);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, command.timeout_seconds * 1000);

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        argv: command.argv,
        cwd: options.cwd,
        duration_ms: Date.now() - startedAt,
        ...(environment.report ? { environment: environment.report } : {}),
        exit_code: exitCode,
        ...(command.kind === "env" && (exitCode !== 0 || timedOut)
          ? { failure_category: "environment_blocked" }
          : {}),
        id: command.id,
        kind: command.kind,
        signal,
        stderr,
        stdout,
        timed_out: timedOut,
      });
    });
  });
}

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface HarnessCliRunOptions {
  readonly command?: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

export interface HarnessCliResult<T = unknown> {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly json?: T;
}

export interface HarnessCliAvailability {
  readonly available: boolean;
  readonly command: string;
  readonly cwd: string;
  readonly error?: string;
  readonly stdoutPreview?: string;
  readonly stderrPreview?: string;
}

export interface HarnessCliRunRequest {
  readonly compoundName?: string;
  readonly skillPath?: string;
  readonly threadId?: string;
  readonly runId?: string;
  readonly runRoot?: string;
  readonly briefPath?: string;
  readonly prompt?: string;
  readonly taskCardPath?: string;
  readonly judgeTool?: 'claude-code' | 'codex';
  readonly judgeProfile?: string;
  readonly judgeTimeoutSeconds?: number;
  readonly configPath?: string;
  readonly noLocal?: boolean;
}

export interface HarnessCliInspectRequest {
  readonly threadId: string;
  readonly runRoot?: string;
}

export type HarnessCliDryRunRequest = Pick<
  HarnessCliRunRequest,
  'compoundName' | 'skillPath' | 'threadId' | 'runRoot' | 'taskCardPath' | 'configPath' | 'noLocal'
>;

function resolveCommand(command?: string): string {
  return command ?? process.env.HARNESS_CLI_BIN ?? 'harness';
}

function truncatePreview(value: string, maxLength = 2_000): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}\n...[truncated]` : trimmed;
}

function appendOptionalFlag(args: string[], flag: string, value: string | number | undefined): void {
  if (value === undefined || value === '') return;
  args.push(flag, String(value));
}

function appendHarnessRepo(args: string[], harnessRepoPath: string): void {
  args.push('--harness-repo', harnessRepoPath);
}

function appendCommonRunArgs(args: string[], request: HarnessCliRunRequest): void {
  appendOptionalFlag(args, '--compound', request.compoundName);
  appendOptionalFlag(args, '--skill', request.skillPath);
  appendOptionalFlag(args, '--thread-id', request.threadId);
  appendOptionalFlag(args, '--run-id', request.runId);
  appendOptionalFlag(args, '--run-root', request.runRoot);
  appendOptionalFlag(args, '--brief', request.briefPath);
  appendOptionalFlag(args, '--prompt', request.prompt);
  appendOptionalFlag(args, '--task-card', request.taskCardPath);
  appendOptionalFlag(args, '--judge-tool', request.judgeTool);
  appendOptionalFlag(args, '--judge-profile', request.judgeProfile);
  appendOptionalFlag(args, '--judge-timeout-seconds', request.judgeTimeoutSeconds);
  appendOptionalFlag(args, '--config', request.configPath);
  if (request.noLocal) args.push('--no-local');
}

function assertHasRunnableSource(request: Pick<HarnessCliRunRequest, 'compoundName' | 'skillPath' | 'threadId'>): void {
  if (!request.compoundName && !request.skillPath && !request.threadId) {
    throw new Error('Missing harness run source: provide compoundName, skillPath, or threadId.');
  }
}

export function buildHarnessCliDryRunArgs(
  harnessRepoPath: string,
  request: HarnessCliDryRunRequest,
): readonly string[] {
  assertHasRunnableSource(request);
  const args = ['run', '--dry-run'];
  appendHarnessRepo(args, harnessRepoPath);
  appendCommonRunArgs(args, request);
  args.push('--json');
  return args;
}

export function buildHarnessCliRunArgs(
  harnessRepoPath: string,
  request: HarnessCliRunRequest,
): readonly string[] {
  assertHasRunnableSource(request);
  const args = ['run'];
  appendHarnessRepo(args, harnessRepoPath);
  appendCommonRunArgs(args, request);
  args.push('--json');
  return args;
}

export function buildHarnessCliResumeArgs(
  harnessRepoPath: string,
  request: HarnessCliInspectRequest & Pick<HarnessCliRunRequest, 'compoundName' | 'skillPath' | 'configPath' | 'noLocal'>,
): readonly string[] {
  const args = ['run', '--resume', request.threadId];
  appendHarnessRepo(args, harnessRepoPath);
  appendOptionalFlag(args, '--compound', request.compoundName);
  appendOptionalFlag(args, '--skill', request.skillPath);
  appendOptionalFlag(args, '--run-root', request.runRoot);
  appendOptionalFlag(args, '--config', request.configPath);
  if (request.noLocal) args.push('--no-local');
  args.push('--json');
  return args;
}

export function buildHarnessCliInspectArgs(
  harnessRepoPath: string,
  request: HarnessCliInspectRequest,
): readonly string[] {
  const args = ['run', 'inspect', request.threadId];
  appendHarnessRepo(args, harnessRepoPath);
  appendOptionalFlag(args, '--run-root', request.runRoot);
  args.push('--json');
  return args;
}

export function buildHarnessCliViewArgs(
  harnessRepoPath: string,
  request: HarnessCliInspectRequest,
): readonly string[] {
  const args = ['run', 'view', request.threadId];
  appendHarnessRepo(args, harnessRepoPath);
  appendOptionalFlag(args, '--run-root', request.runRoot);
  args.push('--json');
  return args;
}

export async function runHarnessCli<T = unknown>(
  args: readonly string[],
  options: HarnessCliRunOptions = {},
): Promise<HarnessCliResult<T>> {
  const command = resolveCommand(options.command);
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const proc = spawn(command, [...args], {
      cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (settled) return;
      proc.kill('SIGTERM');
      reject(new Error(`harness-cli timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to spawn harness-cli command "${command}": ${error.message}`));
    });

    proc.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result: HarnessCliResult<T> = {
        command,
        args,
        cwd,
        exitCode,
        signal,
        stdout,
        stderr,
      };
      if (exitCode === 0) {
        resolve(result);
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `harness-cli exited with code ${exitCode}`));
    });
  });
}

export async function runHarnessCliJson<T = unknown>(
  args: readonly string[],
  options: HarnessCliRunOptions = {},
): Promise<HarnessCliResult<T>> {
  const result = await runHarnessCli<T>(args, options);
  try {
    return {
      ...result,
      json: JSON.parse(result.stdout) as T,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON output';
    throw new Error(`harness-cli did not return valid JSON: ${message}`);
  }
}

export async function checkHarnessCliAvailability(
  harnessRepoPath: string,
  options: HarnessCliRunOptions = {},
): Promise<HarnessCliAvailability> {
  const command = resolveCommand(options.command);
  const cwd = options.cwd ?? harnessRepoPath;
  try {
    const result = await runHarnessCli(['run', '--help'], {
      ...options,
      cwd,
      timeoutMs: options.timeoutMs ?? 10_000,
    });
    return {
      available: true,
      command,
      cwd,
      stdoutPreview: truncatePreview(result.stdout),
      stderrPreview: truncatePreview(result.stderr),
    };
  } catch (error) {
    return {
      available: false,
      command,
      cwd,
      error: error instanceof Error ? error.message : 'Failed to run harness-cli',
    };
  }
}

export async function dryRunHarnessWorkflow<T = unknown>(
  harnessRepoPath: string,
  request: HarnessCliDryRunRequest,
  options: HarnessCliRunOptions = {},
): Promise<HarnessCliResult<T>> {
  return runHarnessCliJson<T>(buildHarnessCliDryRunArgs(harnessRepoPath, request), {
    ...options,
    cwd: options.cwd ?? harnessRepoPath,
  });
}

export async function inspectHarnessRun<T = unknown>(
  harnessRepoPath: string,
  request: HarnessCliInspectRequest,
  options: HarnessCliRunOptions = {},
): Promise<HarnessCliResult<T>> {
  return runHarnessCliJson<T>(buildHarnessCliInspectArgs(harnessRepoPath, request), {
    ...options,
    cwd: options.cwd ?? harnessRepoPath,
  });
}

export async function viewHarnessRun<T = unknown>(
  harnessRepoPath: string,
  request: HarnessCliInspectRequest,
  options: HarnessCliRunOptions = {},
): Promise<HarnessCliResult<T>> {
  return runHarnessCliJson<T>(buildHarnessCliViewArgs(harnessRepoPath, request), {
    ...options,
    cwd: options.cwd ?? harnessRepoPath,
  });
}

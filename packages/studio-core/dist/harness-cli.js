"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHarnessCliDryRunArgs = buildHarnessCliDryRunArgs;
exports.buildHarnessCliRunArgs = buildHarnessCliRunArgs;
exports.buildHarnessCliResumeArgs = buildHarnessCliResumeArgs;
exports.buildHarnessCliInspectArgs = buildHarnessCliInspectArgs;
exports.buildHarnessCliViewArgs = buildHarnessCliViewArgs;
exports.runHarnessCli = runHarnessCli;
exports.runHarnessCliJson = runHarnessCliJson;
exports.checkHarnessCliAvailability = checkHarnessCliAvailability;
exports.dryRunHarnessWorkflow = dryRunHarnessWorkflow;
exports.inspectHarnessRun = inspectHarnessRun;
exports.viewHarnessRun = viewHarnessRun;
const node_child_process_1 = require("node:child_process");
const DEFAULT_TIMEOUT_MS = 60_000;
function resolveCommand(command) {
    return command ?? process.env.HARNESS_CLI_BIN ?? 'harness';
}
function truncatePreview(value, maxLength = 2_000) {
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}\n...[truncated]` : trimmed;
}
function appendOptionalFlag(args, flag, value) {
    if (value === undefined || value === '')
        return;
    args.push(flag, String(value));
}
function appendHarnessRepo(args, harnessRepoPath) {
    args.push('--harness-repo', harnessRepoPath);
}
function appendCommonRunArgs(args, request) {
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
    if (request.noLocal)
        args.push('--no-local');
}
function assertHasRunnableSource(request) {
    if (!request.compoundName && !request.skillPath && !request.threadId) {
        throw new Error('Missing harness run source: provide compoundName, skillPath, or threadId.');
    }
}
function buildHarnessCliDryRunArgs(harnessRepoPath, request) {
    assertHasRunnableSource(request);
    const args = ['run', '--dry-run'];
    appendHarnessRepo(args, harnessRepoPath);
    appendCommonRunArgs(args, request);
    args.push('--json');
    return args;
}
function buildHarnessCliRunArgs(harnessRepoPath, request) {
    assertHasRunnableSource(request);
    const args = ['run'];
    appendHarnessRepo(args, harnessRepoPath);
    appendCommonRunArgs(args, request);
    args.push('--json');
    return args;
}
function buildHarnessCliResumeArgs(harnessRepoPath, request) {
    const args = ['run', '--resume', request.threadId];
    appendHarnessRepo(args, harnessRepoPath);
    appendOptionalFlag(args, '--compound', request.compoundName);
    appendOptionalFlag(args, '--skill', request.skillPath);
    appendOptionalFlag(args, '--run-root', request.runRoot);
    appendOptionalFlag(args, '--config', request.configPath);
    if (request.noLocal)
        args.push('--no-local');
    args.push('--json');
    return args;
}
function buildHarnessCliInspectArgs(harnessRepoPath, request) {
    const args = ['run', 'inspect', request.threadId];
    appendHarnessRepo(args, harnessRepoPath);
    appendOptionalFlag(args, '--run-root', request.runRoot);
    args.push('--json');
    return args;
}
function buildHarnessCliViewArgs(harnessRepoPath, request) {
    const args = ['run', 'view', request.threadId];
    appendHarnessRepo(args, harnessRepoPath);
    appendOptionalFlag(args, '--run-root', request.runRoot);
    args.push('--json');
    return args;
}
async function runHarnessCli(args, options = {}) {
    const command = resolveCommand(options.command);
    const cwd = options.cwd ?? process.cwd();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        let settled = false;
        let stdout = '';
        let stderr = '';
        const proc = (0, node_child_process_1.spawn)(command, [...args], {
            cwd,
            env: { ...process.env, ...options.env },
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timer = setTimeout(() => {
            if (settled)
                return;
            proc.kill('SIGTERM');
            reject(new Error(`harness-cli timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
        }, timeoutMs);
        proc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        proc.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`Failed to spawn harness-cli command "${command}": ${error.message}`));
        });
        proc.on('close', (exitCode, signal) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            const result = {
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
async function runHarnessCliJson(args, options = {}) {
    const result = await runHarnessCli(args, options);
    try {
        return {
            ...result,
            json: JSON.parse(result.stdout),
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid JSON output';
        throw new Error(`harness-cli did not return valid JSON: ${message}`);
    }
}
async function checkHarnessCliAvailability(harnessRepoPath, options = {}) {
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
    }
    catch (error) {
        return {
            available: false,
            command,
            cwd,
            error: error instanceof Error ? error.message : 'Failed to run harness-cli',
        };
    }
}
async function dryRunHarnessWorkflow(harnessRepoPath, request, options = {}) {
    return runHarnessCliJson(buildHarnessCliDryRunArgs(harnessRepoPath, request), {
        ...options,
        cwd: options.cwd ?? harnessRepoPath,
    });
}
async function inspectHarnessRun(harnessRepoPath, request, options = {}) {
    return runHarnessCliJson(buildHarnessCliInspectArgs(harnessRepoPath, request), {
        ...options,
        cwd: options.cwd ?? harnessRepoPath,
    });
}
async function viewHarnessRun(harnessRepoPath, request, options = {}) {
    return runHarnessCliJson(buildHarnessCliViewArgs(harnessRepoPath, request), {
        ...options,
        cwd: options.cwd ?? harnessRepoPath,
    });
}
//# sourceMappingURL=harness-cli.js.map
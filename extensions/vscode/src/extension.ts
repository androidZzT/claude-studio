import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createStudioCore,
  expandHome,
  formatWorkflowDocument,
  getExecution,
  parseWorkflowDocument,
  startExecution,
  validateWorkflow,
  type ExecutionEvent,
  type ProjectTemplate,
  type ResourceType,
  type WorkflowInput,
} from '@harness-studio/studio-core';

type OpenMode = 'webview' | 'nativePreview' | 'simpleBrowser' | 'external';

interface StudioConfig {
  readonly serverUrl: URL;
  readonly autoStart: boolean;
  readonly openMode: OpenMode;
  readonly startCommand: string;
  readonly startupTimeoutMs: number;
  readonly autoOpenWorkflowOnFileOpen: boolean;
}

interface StudioOpenTarget {
  readonly projectPath: string;
  readonly workflowName?: string;
}

interface BridgeRequestPayload {
  readonly url: string;
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

interface BridgeResponsePayload {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface BridgeRequestMessage {
  readonly type: 'bridgeRequest';
  readonly id: string;
  readonly request: BridgeRequestPayload;
}

interface BridgeResponseMessage {
  readonly type: 'bridgeResponse';
  readonly id: string;
  readonly response: BridgeResponsePayload;
}

interface BridgeStreamStartMessage {
  readonly type: 'bridgeStreamStart';
  readonly id: string;
  readonly url: string;
}

interface BridgeStreamStopMessage {
  readonly type: 'bridgeStreamStop';
  readonly id: string;
}

interface BridgeStreamEventMessage {
  readonly type: 'bridgeStreamEvent';
  readonly id: string;
  readonly data: string;
}

interface BridgeStreamErrorMessage {
  readonly type: 'bridgeStreamError';
  readonly id: string;
  readonly error: string;
}

interface BridgeStreamEndMessage {
  readonly type: 'bridgeStreamEnd';
  readonly id: string;
}

interface BridgePickDirectoryMessage {
  readonly type: 'bridgePickDirectory';
  readonly id: string;
}

interface BridgePickDirectoryResponseMessage {
  readonly type: 'bridgePickDirectoryResponse';
  readonly id: string;
  readonly path?: string;
  readonly error?: string;
}

interface UiCommandMessage {
  readonly type: 'reload' | 'openExternal' | 'showLogs' | 'openEmbedded';
}

interface WorkflowNodeParsed {
  readonly id: string;
  readonly agent: string;
  readonly task: string;
  readonly checkpoint?: boolean;
  readonly depends_on?: readonly string[];
  readonly roundtrip?: readonly string[];
  readonly skills?: readonly string[];
}

interface ExecuteRequestBody {
  readonly workflow?: {
    readonly name: string;
    readonly nodes: readonly WorkflowNodeParsed[];
  };
  readonly projectPath?: string;
  readonly simulate?: boolean;
}

interface BridgeStreamHandle {
  readonly kind: 'http' | 'inProcessWatch' | 'inProcessExecution';
  request?: http.ClientRequest;
  response?: http.IncomingMessage;
  keepAliveTimer?: NodeJS.Timeout;
  watchers?: nodeFs.FSWatcher[];
  cleanup?: () => void;
}

let studioProcess: ChildProcess | null = null;
let studioPanel: vscode.WebviewPanel | null = null;
let outputChannel: vscode.OutputChannel | null = null;
let studioPanelServerUrl: URL | null = null;
let studioPanelMode: 'webview' | 'nativePreview' | null = null;
let studioPanelTarget: StudioOpenTarget | null = null;
let extensionContextRef: vscode.ExtensionContext | null = null;
let lastAutoOpenKey: string | null = null;
let lastAutoOpenAt = 0;
const bridgeStreams = new Map<string, BridgeStreamHandle>();
const studioCore = createStudioCore();
const FILE_BASED_RESOURCE_TYPES = new Set<ResourceType>(['agents', 'workflows', 'skills', 'rules']);
const WATCHED_RESOURCE_DIRS = ['agents', 'workflows', 'skills', 'rules'] as const;
const COMMUNITY_REPOS = [
  { name: 'Awesome Claude Code', owner: 'hesreallyhim', repo: 'awesome-claude-code', fallbackStars: 37_000 },
  { name: 'Agent Templates', owner: 'VoltAgent', repo: 'awesome-claude-code-subagents', fallbackStars: 17_000 },
  { name: 'Skills Collection', owner: 'alirezarezvani', repo: 'claude-skills', fallbackStars: 10_000 },
  { name: 'Official Plugins', owner: 'anthropics', repo: 'claude-plugins-official', fallbackStars: 16_000 },
] as const;
const NON_GITHUB_COMMUNITY_LINKS = [
  { name: 'Plugin Docs', url: 'https://code.claude.com/docs/en/plugins-reference' },
  { name: 'Agent Teams Docs', url: 'https://code.claude.com/docs/en/agent-teams' },
] as const;
let communityLinksCache: { data: readonly CommunityLink[]; fetchedAt: number } | null = null;
const COMMUNITY_CACHE_TTL_MS = 60 * 60 * 1000;

interface CommunityLink {
  readonly name: string;
  readonly url: string;
  readonly stars?: number;
  readonly description?: string;
}

interface GenerateRequestBody {
  readonly type?: 'workflow' | 'agent' | 'skill';
  readonly description?: string;
  readonly agents?: readonly string[];
  readonly skills?: readonly string[];
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContextRef = context;
  outputChannel = vscode.window.createOutputChannel('Harness Studio');
  context.subscriptions.push(outputChannel);

  const startDisposable = vscode.commands.registerCommand('harnessStudio.start', async () => {
    try {
      const config = readConfig();
      const started = await ensureStudioServerRunning(config);
      if (started) {
        vscode.window.showInformationMessage(`Harness Studio started at ${config.serverUrl.toString()}`);
      } else {
        vscode.window.showInformationMessage(`Harness Studio is already running at ${config.serverUrl.toString()}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to start Harness Studio: ${message}`);
    }
  });

  const openDisposable = vscode.commands.registerCommand('harnessStudio.open', async () => {
    try {
      const config = readConfig();
      const target = resolveDefaultOpenTarget();
      if (requiresStudioServer(config.openMode)) {
        try {
          await ensureStudioServerRunning(config);
        } catch (error) {
          if (config.openMode === 'webview') {
            const message = error instanceof Error ? error.message : String(error);
            appendLog(`[open] webview server unavailable, fallback to nativePreview: ${message}`);
            await openStudio({ ...config, openMode: 'nativePreview' }, target ?? undefined);
            vscode.window.showWarningMessage(
              'Harness Studio server is unavailable, opened Native Preview instead. Check Harness Studio logs for details.',
            );
            return;
          }
          throw error;
        }
      } else {
        appendLog('[open] nativePreview mode uses in-process bridge (no server required)');
      }
      await openStudio(config, target ?? undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to open Harness Studio: ${message}`);
    }
  });

  const showLogsDisposable = vscode.commands.registerCommand('harnessStudio.showLogs', () => {
    outputChannel?.show(true);
  });

  const openDagDisposable = vscode.commands.registerCommand(
    'harnessStudio.openDagForActiveWorkflowFile',
    async (uri?: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor;
      const targetUri = uri ?? editor?.document.uri;
      if (!targetUri) {
        vscode.window.showInformationMessage('Open a workflow file first.');
        return;
      }

      const target = resolveWorkflowOpenTarget(targetUri);
      if (!target) {
        vscode.window.showInformationMessage(
          'Current file is not a workflow. Expected path: .claude/workflows/*.md',
        );
        return;
      }

      try {
        const config = readConfig();
        const dagConfig: StudioConfig = { ...config, openMode: 'webview' };
        if (requiresStudioServer(dagConfig.openMode)) {
          await ensureStudioServerRunning(dagConfig);
        }
        await openStudio(dagConfig, target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to open workflow DAG: ${message}`);
      }
    },
  );

  const autoOpenDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
    void maybeAutoOpenWorkflowDagFromEditor(editor);
  });

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(hubot) Harness Studio';
  statusBar.command = 'harnessStudio.open';
  statusBar.tooltip = 'Open Harness Studio';
  statusBar.show();

  context.subscriptions.push(
    startDisposable,
    openDisposable,
    showLogsDisposable,
    openDagDisposable,
    autoOpenDisposable,
    statusBar,
  );
  context.subscriptions.push(new vscode.Disposable(() => stopStudioProcess()));
  void maybeAutoOpenWorkflowDagFromEditor(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  clearAllBridgeStreams();
  if (studioPanel) {
    studioPanel.dispose();
    studioPanel = null;
  }
  studioPanelServerUrl = null;
  studioPanelMode = null;
  studioPanelTarget = null;
  stopStudioProcess();
}

function readConfig(): StudioConfig {
  const config = vscode.workspace.getConfiguration('harnessStudio');
  const rawUrl = config.get<string>('serverUrl', 'http://127.0.0.1:3100');
  const autoStart = config.get<boolean>('autoStart', true);
  const openMode = config.get<OpenMode>('openMode', 'webview');
  const startCommand = config.get<string>('startCommand', 'npx harness-studio --port {port}');
  const startupTimeoutMs = config.get<number>('startupTimeoutMs', 45_000);
  const autoOpenWorkflowOnFileOpen = config.get<boolean>('autoOpenWorkflowOnFileOpen', true);

  let serverUrl: URL;
  try {
    serverUrl = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid harnessStudio.serverUrl: ${rawUrl}`);
  }

  if (serverUrl.protocol !== 'http:' && serverUrl.protocol !== 'https:') {
    throw new Error('harnessStudio.serverUrl must use http:// or https://');
  }

  if (!['webview', 'nativePreview', 'simpleBrowser', 'external'].includes(openMode)) {
    throw new Error(`Invalid harnessStudio.openMode: ${openMode}`);
  }

  return {
    serverUrl,
    autoStart,
    openMode,
    startCommand,
    startupTimeoutMs,
    autoOpenWorkflowOnFileOpen,
  };
}

function resolveWorkflowOpenTarget(uri: vscode.Uri): StudioOpenTarget | null {
  if (uri.scheme !== 'file') return null;

  const normalizedPath = path.normalize(uri.fsPath);
  const ext = path.extname(normalizedPath).toLowerCase();
  if (!['.md', '.yaml', '.yml'].includes(ext)) return null;

  const marker = `${path.sep}.claude${path.sep}workflows${path.sep}`;
  const markerIndex = normalizedPath.lastIndexOf(marker);
  if (markerIndex < 0) return null;

  const workflowName = path.basename(normalizedPath, ext);
  if (!workflowName) return null;

  const projectPath = normalizedPath.slice(0, markerIndex);
  if (!projectPath || path.normalize(projectPath) === path.normalize(os.homedir())) {
    // Ignore ~/.claude/workflows for now — Studio canvas is project-centric.
    return null;
  }

  return { projectPath, workflowName };
}

function resolveDefaultOpenTarget(): StudioOpenTarget | null {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const workflowTarget = activeUri ? resolveWorkflowOpenTarget(activeUri) : null;
  if (workflowTarget) {
    return workflowTarget;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return null;
  }

  const normalizedRoot = path.normalize(workspaceRoot);
  if (normalizedRoot === path.normalize(os.homedir())) {
    return null;
  }

  return { projectPath: normalizedRoot };
}

async function maybeAutoOpenWorkflowDagFromEditor(editor: vscode.TextEditor | undefined): Promise<void> {
  if (!editor) return;

  try {
    const config = readConfig();
    if (!config.autoOpenWorkflowOnFileOpen) return;

    const target = resolveWorkflowOpenTarget(editor.document.uri);
    if (!target) return;

    const dedupeKey = `${target.projectPath}::${target.workflowName ?? ''}`;
    const now = Date.now();
    if (lastAutoOpenKey === dedupeKey && now - lastAutoOpenAt < 1200) {
      return;
    }
    lastAutoOpenKey = dedupeKey;
    lastAutoOpenAt = now;

    const dagConfig: StudioConfig = { ...config, openMode: 'webview' };
    if (requiresStudioServer(dagConfig.openMode)) {
      await ensureStudioServerRunning(dagConfig);
    }
    await openStudio(dagConfig, target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`[auto-open] failed for ${editor.document.uri.fsPath}: ${message}`);
  }
}

function requiresStudioServer(mode: OpenMode): boolean {
  return mode === 'simpleBrowser' || mode === 'external';
}

async function ensureStudioServerRunning(config: StudioConfig): Promise<boolean> {
  if (await isStudioReachable(config.serverUrl)) {
    return false;
  }

  if (!config.autoStart) {
    throw new Error(
      `Server not reachable at ${config.serverUrl.toString()}. Enable harnessStudio.autoStart or start it manually.`,
    );
  }

  if (!isProcessAlive(studioProcess)) {
    startStudioProcess(config);
  }

  const reachable = await waitForStudio(config.serverUrl, config.startupTimeoutMs);
  if (!reachable) {
    throw new Error(
      `Timed out waiting for Harness Studio at ${config.serverUrl.toString()} after ${config.startupTimeoutMs}ms.`,
    );
  }

  return true;
}

function startStudioProcess(config: StudioConfig): void {
  const cwd = resolveStudioStartCwd();
  const resolvedPort = config.serverUrl.port || '3100';
  const command = config.startCommand
    .replaceAll('{port}', resolvedPort)
    .replaceAll('{url}', config.serverUrl.toString());

  appendLog(`[start] ${command} (cwd=${cwd})`);

  const child = spawn(command, {
    cwd,
    shell: true,
    env: { ...process.env },
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    appendLog(chunk.toString().trimEnd());
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    appendLog(`[stderr] ${chunk.toString().trimEnd()}`);
  });

  child.on('error', (error) => {
    appendLog(`[error] ${error.message}`);
  });

  child.on('exit', (code, signal) => {
    appendLog(`[exit] code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (studioProcess === child) {
      studioProcess = null;
    }
  });

  studioProcess = child;
  outputChannel?.show(true);
}

function resolveStudioStartCwd(): string {
  const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceCwd) {
    return os.homedir();
  }

  const packageJsonPath = path.join(workspaceCwd, 'package.json');
  try {
    if (!nodeFs.existsSync(packageJsonPath)) {
      return os.homedir();
    }
    const raw = nodeFs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string };
    if (parsed.name === 'harness-studio') {
      return workspaceCwd;
    }
    return os.homedir();
  } catch {
    return os.homedir();
  }
}

function stopStudioProcess(): void {
  if (!isProcessAlive(studioProcess)) {
    studioProcess = null;
    return;
  }

  appendLog('[stop] Stopping Harness Studio process');
  studioProcess.kill();
  studioProcess = null;
}

function isProcessAlive(proc: ChildProcess | null): proc is ChildProcess {
  return Boolean(proc && proc.exitCode === null && !proc.killed);
}

async function waitForStudio(url: URL, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isStudioReachable(url)) {
      return true;
    }
    await delay(1000);
  }

  return false;
}

function isStudioReachable(url: URL): Promise<boolean> {
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: '/api/resources',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function openStudio(config: StudioConfig, target?: StudioOpenTarget): Promise<void> {
  switch (config.openMode) {
    case 'webview':
      openStudioInPanel(config.serverUrl, 'webview', target);
      return;
    case 'nativePreview':
      openStudioInPanel(config.serverUrl, 'nativePreview', target);
      return;
    case 'simpleBrowser':
      await openStudioInSimpleBrowser(config.serverUrl);
      return;
    case 'external':
      await openStudioExternal(config.serverUrl);
      return;
  }
}

function openStudioInPanel(serverUrl: URL, mode: 'webview' | 'nativePreview', target?: StudioOpenTarget): void {
  appendLog(`[open] ${mode} ${serverUrl.toString()}`);

  if (studioPanel) {
    studioPanel.reveal(vscode.ViewColumn.Active, true);
    setStudioPanelContent(studioPanel, serverUrl, mode, target);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'harnessStudio',
    'Harness Studio',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: extensionContextRef
        ? [vscode.Uri.joinPath(extensionContextRef.extensionUri, 'media')]
        : undefined,
    },
  );

  setStudioPanelContent(panel, serverUrl, mode, target);

  panel.onDidDispose(() => {
    clearAllBridgeStreams();
    if (studioPanel === panel) {
      studioPanel = null;
      studioPanelServerUrl = null;
      studioPanelMode = null;
      studioPanelTarget = null;
    }
  });

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    const activeServerUrl = studioPanelServerUrl ?? serverUrl;

    if (isUiCommandMessage(message)) {
      if (message.type === 'openExternal') {
        await openStudioExternal(activeServerUrl);
        return;
      }

      if (message.type === 'showLogs') {
        outputChannel?.show(true);
        return;
      }

      if (message.type === 'openEmbedded') {
        setStudioPanelContent(panel, activeServerUrl, 'webview');
        return;
      }

      if (message.type === 'reload') {
        setStudioPanelContent(
          panel,
          activeServerUrl,
          studioPanelMode ?? mode,
          studioPanelTarget ?? undefined,
        );
      }
      return;
    }

    if (isBridgeRequestMessage(message)) {
      const response = await proxyBridgeRequest(activeServerUrl, message.request);
      const payload: BridgeResponseMessage = {
        type: 'bridgeResponse',
        id: message.id,
        response,
      };
      await panel.webview.postMessage(payload);
      return;
    }

    if (isBridgePickDirectoryMessage(message)) {
      const response = await pickDirectoryViaVscodeDialog();
      const payload: BridgePickDirectoryResponseMessage = {
        type: 'bridgePickDirectoryResponse',
        id: message.id,
        path: response.path,
        error: response.error,
      };
      await panel.webview.postMessage(payload);
      return;
    }

    if (isBridgeStreamStartMessage(message)) {
      await startBridgeStream(activeServerUrl, panel, message);
      return;
    }

    if (isBridgeStreamStopMessage(message)) {
      stopBridgeStream(message.id);
    }
  });

  studioPanel = panel;
}

async function openStudioInSimpleBrowser(serverUrl: URL): Promise<void> {
  appendLog(`[open] simpleBrowser ${serverUrl.toString()}`);
  const url = serverUrl.toString();
  try {
    await vscode.commands.executeCommand('simpleBrowser.show', url);
  } catch {
    await openStudioExternal(serverUrl);
  }
}

async function openStudioExternal(serverUrl: URL): Promise<void> {
  appendLog(`[open] external ${serverUrl.toString()}`);
  await vscode.env.openExternal(vscode.Uri.parse(serverUrl.toString()));
}

function setStudioPanelContent(
  panel: vscode.WebviewPanel,
  serverUrl: URL,
  mode: 'webview' | 'nativePreview',
  target?: StudioOpenTarget,
): void {
  clearAllBridgeStreams();
  studioPanelServerUrl = new URL(serverUrl.toString());
  studioPanelMode = mode;
  studioPanelTarget = target ?? null;
  panel.title = mode === 'nativePreview' ? 'Harness Studio (Native Preview)' : 'Harness Studio';
  panel.webview.html = mode === 'nativePreview'
    ? getNativePreviewHtml(serverUrl)
    : getWebviewHtml(panel.webview, target);
}

function getWebviewHtml(webview: vscode.Webview, target?: StudioOpenTarget): string {
  const extensionContext = extensionContextRef;
  if (!extensionContext) {
    return getEmbeddedStudioErrorHtml('Harness Studio extension context is unavailable.');
  }

  const studioRootUri = vscode.Uri.joinPath(extensionContext.extensionUri, 'media', 'studio');
  const templatePath = path.join(extensionContext.extensionPath, 'media', 'studio', 'index.html');
  if (!nodeFs.existsSync(templatePath)) {
    return getEmbeddedStudioErrorHtml(
      'Packaged Harness Studio webview assets are missing. Run `npm run vscode:build` before launching the extension.',
    );
  }

  const nextBaseUrl = ensureTrailingSlash(
    webview.asWebviewUri(vscode.Uri.joinPath(studioRootUri, '_next')).toString(),
  );
  const publicBaseUrl = ensureTrailingSlash(
    webview.asWebviewUri(vscode.Uri.joinPath(studioRootUri, 'public')).toString(),
  );
  const iconUrl = webview.asWebviewUri(vscode.Uri.joinPath(studioRootUri, 'icon.svg')).toString();
  const template = nodeFs.readFileSync(templatePath, 'utf8');

  const bootstrapPayload = {
    bridgeEnabled: true,
    openProjectPath: target?.projectPath,
    openWorkflowName: target?.workflowName,
    publicBaseUrl,
    nextBaseUrl,
  };

  const contentSecurityPolicy = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: https:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'`,
    `worker-src blob: ${webview.cspSource}`,
    `child-src blob: ${webview.cspSource}`,
    `connect-src ${webview.cspSource} https:`,
  ].join('; ');

  const rewrittenHtml = rewriteEmbeddedStudioHtml(template, {
    nextBaseUrl,
    publicBaseUrl,
    iconUrl,
  });

  const bootstrapScript = `<script>
window.__CLAUDE_STUDIO_VSCODE__ = ${JSON.stringify(bootstrapPayload)};
globalThis.__CLAUDE_STUDIO_NEXT_BASE__ = ${toJavaScriptString(nextBaseUrl)};
</script>`;

  return rewrittenHtml.replace(
    '<head>',
    `<head><meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy)}" />${bootstrapScript}`,
  );
}

function rewriteEmbeddedStudioHtml(
  template: string,
  assets: {
    readonly nextBaseUrl: string;
    readonly publicBaseUrl: string;
    readonly iconUrl: string;
  },
): string {
  let html = template;
  html = html.replaceAll('/_next/', assets.nextBaseUrl);
  html = html.replaceAll('/icon.svg', assets.iconUrl);

  for (const fileName of ['clawd-idle.png', 'clawd-happy.png', 'file.svg', 'globe.svg', 'next.svg', 'vercel.svg', 'window.svg']) {
    html = html.replaceAll(`/${fileName}`, `${assets.publicBaseUrl}${fileName}`);
  }

  return html;
}

function getEmbeddedStudioErrorHtml(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Harness Studio</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family, sans-serif);
    }
    .card {
      max-width: 640px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: var(--vscode-editorWidget-background);
      padding: 16px 18px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="card">${escapeHtml(message)}</div>
</body>
</html>`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function getNativePreviewHtml(serverUrl: URL): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const escapedServerUrl = escapeHtml(serverUrl.toString());

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>Harness Studio Native Preview</title>
  <style>
    :root { color-scheme: dark light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      font-family: var(--vscode-font-family, sans-serif);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .title strong { font-size: 13px; }
    .title span {
      font-size: 11px;
      opacity: 0.75;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 6px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-color: var(--vscode-panel-border);
    }
    .layout {
      flex: 1;
      min-height: 0;
      display: grid;
      gap: 12px;
      grid-template-columns: 1.05fr 1fr;
      grid-template-rows: minmax(280px, 1fr) minmax(240px, 1fr);
      padding: 12px;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--vscode-editorWidget-background);
    }
    .resources-card {
      grid-row: 1 / span 2;
    }
    .card h2 {
      margin: 0;
      padding: 10px 12px;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .card-body {
      padding: 10px 12px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .grow { flex: 1; min-width: 0; }
    input[type="text"], select {
      width: 100%;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 6px 8px;
      font-size: 12px;
    }
    .resource-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .pill {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 6px 8px;
      background: var(--vscode-input-background);
    }
    .pill label {
      display: block;
      font-size: 10px;
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .pill strong { font-size: 14px; }
    .resource-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .resource-list li {
      margin: 0;
      padding: 0;
    }
    .resource-item {
      width: 100%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      text-align: left;
      background: var(--vscode-input-background);
      color: inherit;
      cursor: pointer;
    }
    .resource-item:hover {
      border-color: var(--vscode-focusBorder);
    }
    .resource-item.selected {
      border-color: var(--vscode-focusBorder);
      background: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
    }
    .resource-list code {
      font-size: 11px;
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 65%;
    }
    .meta {
      font-size: 11px;
      opacity: 0.75;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-input-background);
      padding: 6px 8px;
    }
    textarea {
      width: 100%;
      min-height: 180px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      padding: 8px;
    }
    textarea[readonly] {
      opacity: 0.78;
    }
    .status {
      padding: 8px 12px;
      font-size: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      min-height: 32px;
    }
    .status.error { color: var(--vscode-errorForeground); }
    @media (max-width: 980px) {
      .layout {
        grid-template-columns: 1fr;
        grid-template-rows: auto auto auto;
      }
      .resources-card { grid-row: auto; }
      .resource-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <strong>Harness Studio Native Preview</strong>
      <span>${escapedServerUrl}</span>
    </div>
    <div class="toolbar">
      <button id="refresh-all" type="button">Refresh All</button>
      <button id="save-settings" type="button">Save Settings</button>
      <button id="open-embedded" class="secondary" type="button">Open Embedded</button>
      <button id="logs" class="secondary" type="button">Logs</button>
    </div>
  </div>

  <div class="layout">
    <section class="card resources-card">
      <h2>Resources</h2>
      <div class="card-body">
        <div class="row">
          <input id="resource-filter" type="text" placeholder="Filter by type / name / path..." />
        </div>
        <div class="row">
          <select id="new-resource-type" class="grow">
            <option value="agents">agents</option>
            <option value="workflows">workflows</option>
            <option value="skills">skills</option>
            <option value="rules">rules</option>
          </select>
          <input id="new-resource-id" class="grow" type="text" placeholder="new-resource-id" />
          <button id="create-resource" type="button">Create</button>
        </div>
        <div id="resource-summary" class="resource-summary"></div>
        <ul id="resource-list" class="resource-list"></ul>
      </div>
    </section>

    <section class="card">
      <h2>Resource Editor</h2>
      <div class="card-body">
        <div class="row">
          <strong id="resource-title" class="grow">No resource selected</strong>
          <button id="reload-resource" class="secondary" type="button" disabled>Reload Resource</button>
          <button id="delete-resource" class="secondary" type="button" disabled>Delete Resource</button>
          <button id="save-resource" type="button" disabled>Save Resource</button>
        </div>
        <div id="resource-meta" class="meta">Select a resource from the left list.</div>
        <textarea id="resource-editor" spellcheck="false" readonly placeholder="Select a resource to edit"></textarea>
      </div>
    </section>

    <section class="card">
      <h2>Global Settings (~/.claude/settings.json)</h2>
      <div class="card-body">
        <textarea id="settings-editor" spellcheck="false"></textarea>
      </div>
    </section>
  </div>

  <div id="status" class="status"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const statusEl = document.getElementById('status');
    const summaryEl = document.getElementById('resource-summary');
    const listEl = document.getElementById('resource-list');
    const filterInput = document.getElementById('resource-filter');
    const newResourceTypeSelect = document.getElementById('new-resource-type');
    const newResourceIdInput = document.getElementById('new-resource-id');
    const createResourceButton = document.getElementById('create-resource');
    const resourceTitle = document.getElementById('resource-title');
    const resourceMeta = document.getElementById('resource-meta');
    const resourceEditor = document.getElementById('resource-editor');
    const saveResourceButton = document.getElementById('save-resource');
    const reloadResourceButton = document.getElementById('reload-resource');
    const deleteResourceButton = document.getElementById('delete-resource');
    const settingsEditor = document.getElementById('settings-editor');
    const supportedTypes = new Set(['agents', 'workflows', 'skills', 'rules']);
    const pending = new Map();
    const state = {
      resources: [],
      filterText: '',
      selectedType: '',
      selectedId: '',
      selectedResource: null,
      creatingResource: false,
      savingResource: false,
      deletingResource: false,
      loadingResource: false,
    };
    let reqCounter = 0;

    function setStatus(text, isError = false) {
      statusEl.textContent = text;
      statusEl.classList.toggle('error', Boolean(isError));
    }

    function createRequestId() {
      reqCounter += 1;
      return 'native-' + Date.now() + '-' + reqCounter;
    }

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }
      if (data.type !== 'bridgeResponse' || typeof data.id !== 'string') {
        return;
      }
      const pendingItem = pending.get(data.id);
      if (!pendingItem) {
        return;
      }
      pending.delete(data.id);
      clearTimeout(pendingItem.timeoutId);
      pendingItem.resolve(data.response);
    });

    function bridgeFetch(url, init = {}) {
      const id = createRequestId();
      const method = (init.method || 'GET').toUpperCase();
      const headers = init.headers && typeof init.headers === 'object' ? init.headers : {};
      const body = typeof init.body === 'string' ? init.body : undefined;

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Request timed out'));
        }, 30000);

        pending.set(id, { resolve, reject, timeoutId });
        vscode.postMessage({
          type: 'bridgeRequest',
          id,
          request: { url, method, headers, body },
        });
      });
    }

    async function requestJson(url, init) {
      const response = await bridgeFetch(url, init);
      const body = response && typeof response.body === 'string' ? response.body : '';
      let parsed = {};
      if (body) {
        try {
          parsed = JSON.parse(body);
        } catch (error) {
          throw new Error('Response JSON parse failed: ' + (error instanceof Error ? error.message : String(error)));
        }
      }
      return { status: response.status, payload: parsed };
    }

    function sortResources(items) {
      return [...items].sort((a, b) => {
        const at = typeof a?.type === 'string' ? a.type : '';
        const bt = typeof b?.type === 'string' ? b.type : '';
        if (at !== bt) {
          return at.localeCompare(bt);
        }
        const an = typeof a?.name === 'string' ? a.name : '';
        const bn = typeof b?.name === 'string' ? b.name : '';
        if (an !== bn) {
          return an.localeCompare(bn);
        }
        const ap = typeof a?.path === 'string' ? a.path : '';
        const bp = typeof b?.path === 'string' ? b.path : '';
        return ap.localeCompare(bp);
      });
    }

    function renderResources(items) {
      const buckets = { agents: 0, workflows: 0, skills: 0, rules: 0 };
      for (const item of items) {
        if (typeof item?.type === 'string' && Object.prototype.hasOwnProperty.call(buckets, item.type)) {
          buckets[item.type] += 1;
        }
      }

      summaryEl.replaceChildren();
      for (const [key, count] of Object.entries(buckets)) {
        const div = document.createElement('div');
        div.className = 'pill';
        const label = document.createElement('label');
        label.textContent = key;
        const strong = document.createElement('strong');
        strong.textContent = String(count);
        div.append(label, strong);
        summaryEl.appendChild(div);
      }

      const filterText = state.filterText.trim().toLowerCase();
      const sorted = sortResources(items);
      const filtered = filterText
        ? sorted.filter((item) => {
          const type = typeof item?.type === 'string' ? item.type : '';
          const name = typeof item?.name === 'string' ? item.name : '';
          const path = typeof item?.path === 'string' ? item.path : '';
          return (type + ' ' + name + ' ' + path).toLowerCase().includes(filterText);
        })
        : sorted;

      listEl.replaceChildren();
      for (const item of filtered.slice(0, 500)) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'resource-item';
        if (item?.type === state.selectedType && item?.id === state.selectedId) {
          button.classList.add('selected');
        }

        button.addEventListener('click', () => {
          void selectResource(item);
        });

        const left = document.createElement('span');
        const type = typeof item?.type === 'string' ? item.type : 'unknown';
        const name = typeof item?.name === 'string' ? item.name : '(unnamed)';
        const path = typeof item?.path === 'string' ? item.path : '';
        left.textContent = '[' + type + '] ' + name;
        const right = document.createElement('code');
        right.textContent = path;

        button.append(left, right);
        li.appendChild(button);
        listEl.appendChild(li);
      }

      if (filtered.length === 0) {
        const li = document.createElement('li');
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No resources matched current filter.';
        li.appendChild(empty);
        listEl.appendChild(li);
      }
    }

    function setResourceEditorState(resource) {
      state.selectedResource = resource;
      if (!resource) {
        resourceTitle.textContent = 'No resource selected';
        resourceMeta.textContent = 'Select a resource from the left list.';
        resourceEditor.value = '';
        resourceEditor.readOnly = true;
        resourceEditor.placeholder = 'Select a resource to edit';
        updateResourceActions();
        return;
      }

      const type = typeof resource.type === 'string' ? resource.type : 'unknown';
      const name = typeof resource.name === 'string' ? resource.name : '(unnamed)';
      const id = typeof resource.id === 'string' ? resource.id : '';
      const path = typeof resource.path === 'string' ? resource.path : '';
      resourceTitle.textContent = '[' + type + '] ' + name;
      resourceMeta.textContent = 'ID: ' + id + ' | Path: ' + path;
      resourceEditor.readOnly = false;
      resourceEditor.placeholder = '';
      resourceEditor.value = typeof resource.content === 'string' ? resource.content : '';
      if (supportedTypes.has(type)) {
        newResourceTypeSelect.value = type;
      }
      updateResourceActions();
    }

    function hasResourceChanges() {
      if (!state.selectedResource) {
        return false;
      }
      return resourceEditor.value !== (state.selectedResource.content || '');
    }

    function updateResourceActions() {
      const hasSelection = Boolean(state.selectedResource);
      const canSave =
        hasSelection &&
        !state.loadingResource &&
        !state.savingResource &&
        !state.deletingResource &&
        hasResourceChanges();
      saveResourceButton.disabled = !canSave;
      reloadResourceButton.disabled =
        !hasSelection ||
        state.loadingResource ||
        state.savingResource ||
        state.deletingResource;
      deleteResourceButton.disabled =
        !hasSelection ||
        state.loadingResource ||
        state.savingResource ||
        state.deletingResource;
      saveResourceButton.textContent = state.savingResource
        ? 'Saving...'
        : hasResourceChanges()
          ? 'Save Resource'
          : 'Saved';
      createResourceButton.disabled = state.creatingResource || state.loadingResource;
      createResourceButton.textContent = state.creatingResource ? 'Creating...' : 'Create';
    }

    async function selectResource(item) {
      const type = typeof item?.type === 'string' ? item.type : '';
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!type || !id) {
        setStatus('Invalid resource selection', true);
        return;
      }
      state.selectedType = type;
      state.selectedId = id;
      if (supportedTypes.has(type)) {
        newResourceTypeSelect.value = type;
      }
      renderResources(state.resources);
      await loadSelectedResource();
    }

    function getDefaultResourceContent(type, id) {
      if (type === 'workflows') {
        return [
          'name: ' + id,
          'description: Workflow created from VS Code native preview',
          'version: 1',
          'nodes:',
          '  - id: step-1',
          '    agent: default',
          '    task: TODO',
        ].join('\\n');
      }
      return '# ' + id + '\\n';
    }

    async function createResource() {
      const type = String(newResourceTypeSelect.value || '').trim();
      const rawId = String(newResourceIdInput.value || '').trim();
      if (!supportedTypes.has(type)) {
        setStatus('Resource type is invalid', true);
        return;
      }
      if (!rawId) {
        setStatus('Resource id is required', true);
        return;
      }
      if (rawId.includes('..')) {
        setStatus('Resource id cannot include ".."', true);
        return;
      }

      const encodedId = encodeURIComponent(rawId);
      const exists = state.resources.some((item) => item?.type === type && item?.id === encodedId);
      if (exists) {
        setStatus('Resource already exists: ' + rawId, true);
        return;
      }

      state.creatingResource = true;
      updateResourceActions();
      setStatus('Creating resource...');
      try {
        const { status, payload } = await requestJson('/api/resources/' + encodeURIComponent(type), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: encodedId,
            content: getDefaultResourceContent(type, rawId),
          }),
        });
        if (status >= 400 || !payload || payload.success !== true) {
          const err = payload && typeof payload.error === 'string' ? payload.error : 'Failed to create resource';
          throw new Error(err);
        }

        const created = payload.data && typeof payload.data === 'object' ? payload.data : null;
        state.selectedType = created?.type && typeof created.type === 'string' ? created.type : type;
        state.selectedId = created?.id && typeof created.id === 'string' ? created.id : encodedId;
        newResourceIdInput.value = '';
        await loadResources({ preserveSelection: true, silent: true });
        setStatus('Resource created.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        state.creatingResource = false;
        updateResourceActions();
      }
    }

    async function loadSelectedResource() {
      if (!state.selectedType || !state.selectedId) {
        setResourceEditorState(null);
        return;
      }

      state.loadingResource = true;
      updateResourceActions();
      setStatus('Loading resource...');
      try {
        const url = '/api/resources/' +
          encodeURIComponent(state.selectedType) +
          '/' +
          encodeURIComponent(state.selectedId);
        const { status, payload } = await requestJson(url);
        if (status >= 400 || !payload || payload.success !== true) {
          const err = payload && typeof payload.error === 'string' ? payload.error : 'Failed to load resource';
          throw new Error(err);
        }
        const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
        setResourceEditorState(data);
        renderResources(state.resources);
        setStatus('Resource loaded.');
      } catch (error) {
        setResourceEditorState(null);
        setStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        state.loadingResource = false;
        updateResourceActions();
      }
    }

    async function saveSelectedResource() {
      if (!state.selectedResource) {
        return;
      }
      if (!hasResourceChanges()) {
        setStatus('No changes to save.');
        updateResourceActions();
        return;
      }

      state.savingResource = true;
      updateResourceActions();
      setStatus('Saving resource...');
      try {
        const payload = { content: resourceEditor.value };
        if (
          state.selectedResource.frontmatter &&
          typeof state.selectedResource.frontmatter === 'object' &&
          !Array.isArray(state.selectedResource.frontmatter)
        ) {
          payload.frontmatter = state.selectedResource.frontmatter;
        }

        const url = '/api/resources/' +
          encodeURIComponent(state.selectedType) +
          '/' +
          encodeURIComponent(state.selectedId);
        const { status, payload: responsePayload } = await requestJson(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (status >= 400 || !responsePayload || responsePayload.success !== true) {
          const err =
            responsePayload && typeof responsePayload.error === 'string'
              ? responsePayload.error
              : 'Failed to save resource';
          throw new Error(err);
        }

        const saved = responsePayload.data && typeof responsePayload.data === 'object'
          ? responsePayload.data
          : { ...state.selectedResource, content: resourceEditor.value };
        state.selectedResource = saved;
        setResourceEditorState(saved);
        await loadResources({ preserveSelection: true, silent: true });
        setStatus('Resource saved.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        state.savingResource = false;
        updateResourceActions();
      }
    }

    async function deleteSelectedResource() {
      if (!state.selectedResource) {
        return;
      }
      const resourceName = typeof state.selectedResource.name === 'string'
        ? state.selectedResource.name
        : state.selectedId;
      const confirmed = window.confirm('Delete resource "' + resourceName + '"? This cannot be undone.');
      if (!confirmed) {
        return;
      }

      state.deletingResource = true;
      updateResourceActions();
      setStatus('Deleting resource...');
      try {
        const url = '/api/resources/' +
          encodeURIComponent(state.selectedType) +
          '/' +
          encodeURIComponent(state.selectedId);
        const { status, payload } = await requestJson(url, { method: 'DELETE' });
        if (status >= 400 || !payload || payload.success !== true) {
          const err = payload && typeof payload.error === 'string' ? payload.error : 'Failed to delete resource';
          throw new Error(err);
        }

        state.selectedType = '';
        state.selectedId = '';
        setResourceEditorState(null);
        await loadResources({ preserveSelection: false, silent: true });
        setStatus('Resource deleted.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        state.deletingResource = false;
        updateResourceActions();
      }
    }

    async function loadResources(options = { preserveSelection: true, silent: false }) {
      const { status, payload } = await requestJson('/api/resources');
      if (status >= 400 || !payload || payload.success !== true) {
        const err = payload && typeof payload.error === 'string' ? payload.error : 'Failed to load resources';
        throw new Error(err);
      }
      const data = Array.isArray(payload.data) ? payload.data : [];
      state.resources = data;

      if (options.preserveSelection && state.selectedType && state.selectedId) {
        const exists = data.some((item) => item?.type === state.selectedType && item?.id === state.selectedId);
        if (!exists) {
          state.selectedType = '';
          state.selectedId = '';
          setResourceEditorState(null);
        }
      }

      renderResources(data);
      if (options.preserveSelection && state.selectedType && state.selectedId) {
        await loadSelectedResource();
      } else if (!options.silent) {
        setStatus('Resources loaded.');
      }
    }

    async function loadSettings() {
      const { status, payload } = await requestJson('/api/settings');
      if (status >= 400 || !payload || payload.success !== true) {
        const err = payload && typeof payload.error === 'string' ? payload.error : 'Failed to load settings';
        throw new Error(err);
      }
      const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
      settingsEditor.value = JSON.stringify(data, null, 2);
    }

    async function saveSettings() {
      let parsed;
      try {
        parsed = JSON.parse(settingsEditor.value || '{}');
      } catch (error) {
        throw new Error('Settings JSON is invalid: ' + (error instanceof Error ? error.message : String(error)));
      }

      const { status, payload } = await requestJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (status >= 400 || !payload || payload.success !== true) {
        const err = payload && typeof payload.error === 'string' ? payload.error : 'Failed to save settings';
        throw new Error(err);
      }
      const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
      settingsEditor.value = JSON.stringify(data, null, 2);
    }

    async function refreshAll() {
      setStatus('Loading resources and settings...');
      try {
        await Promise.all([loadResources(), loadSettings()]);
        setStatus('Loaded.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    }

    document.getElementById('refresh-all').addEventListener('click', async () => {
      await refreshAll();
    });

    document.getElementById('save-settings').addEventListener('click', async () => {
      setStatus('Saving settings...');
      try {
        await saveSettings();
        setStatus('Settings saved.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    });

    filterInput.addEventListener('input', () => {
      state.filterText = filterInput.value || '';
      renderResources(state.resources);
    });

    createResourceButton.addEventListener('click', async () => {
      await createResource();
    });

    resourceEditor.addEventListener('input', () => {
      updateResourceActions();
    });

    saveResourceButton.addEventListener('click', async () => {
      await saveSelectedResource();
    });

    reloadResourceButton.addEventListener('click', async () => {
      await loadSelectedResource();
    });

    deleteResourceButton.addEventListener('click', async () => {
      await deleteSelectedResource();
    });

    document.getElementById('open-embedded').addEventListener('click', () => {
      vscode.postMessage({ type: 'openEmbedded' });
    });

    document.getElementById('logs').addEventListener('click', () => {
      vscode.postMessage({ type: 'showLogs' });
    });

    setResourceEditorState(null);
    refreshAll();
  </script>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toJavaScriptString(input: string): string {
  return JSON.stringify(input);
}

async function fetchCommunityLinks(): Promise<readonly CommunityLink[]> {
  const now = Date.now();
  if (communityLinksCache && now - communityLinksCache.fetchedAt < COMMUNITY_CACHE_TTL_MS) {
    return communityLinksCache.data;
  }

  const repoLinks = await Promise.all(
    COMMUNITY_REPOS.map(async ({ name, owner, repo, fallbackStars }) => ({
      name,
      url: `https://github.com/${owner}/${repo}`,
      stars: await fetchRepoStars(owner, repo, fallbackStars),
    })),
  );

  const data = [...repoLinks, ...NON_GITHUB_COMMUNITY_LINKS];
  communityLinksCache = { data, fetchedAt: now };
  return data;
}

async function fetchRepoStars(owner: string, repo: string, fallbackStars: number): Promise<number> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return fallbackStars;
    }
    const data = await response.json() as { stargazers_count?: unknown };
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : fallbackStars;
  } catch {
    return fallbackStars;
  }
}

function buildGeneratePrompt(
  type: 'workflow' | 'agent' | 'skill',
  description: string,
  agents: readonly string[],
  skills: readonly string[],
): string {
  switch (type) {
    case 'workflow':
      return buildWorkflowPrompt(description, agents, skills);
    case 'agent':
      return buildAgentPrompt(description);
    case 'skill':
      return buildSkillPrompt(description);
  }
}

function buildWorkflowPrompt(description: string, agents: readonly string[], skills: readonly string[]): string {
  const agentList = agents.length > 0 ? agents.join(', ') : '(none)';
  const skillList = skills.length > 0 ? skills.join(', ') : '(none)';

  return `You are a workflow designer for Claude Code Agent Teams.

CRITICAL CONSTRAINT — READ THIS FIRST:
The ONLY agents you may use are: user, ${agentList}
Do NOT invent, create, or hallucinate agent names that are not in this list.
Every node's "agent" field MUST be exactly one of: user, ${agentList}
If the available agents don't cover a needed role, pick the closest match from the list above.
Violating this rule makes the entire output invalid.

The ONLY skills you may reference are: ${skillList}
Do NOT invent skill names. Only add "skills:" if a matching skill exists in the list.

User's description: ${description}

Output ONLY valid YAML (no markdown fences, no explanation, no commentary):

name: Workflow Name
description: One line description
version: 1

nodes:
  - id: user
    agent: user
    task: describe what the user does
    checkpoint: true

  - id: team-lead
    agent: (MUST be one of: ${agentList})
    task: describe the coordination task
    depends_on: [user]

  - id: worker-1
    agent: (MUST be one of: ${agentList})
    task: describe the task
    depends_on: [team-lead]

Rules:
- Always start with a "user" node (checkpoint: true) and a "team-lead" node
- Use depends_on for execution order
- Use reports_to for feedback edges
- Use syncs_with for peer collaboration between same-level nodes
- Use roundtrip for bidirectional dispatch+report
- Set checkpoint: true on approval/review nodes
- Parallel tasks should depend on the same parent
- REMINDER: agent field must be exactly from: user, ${agentList}`;
}

function buildAgentPrompt(description: string): string {
  return `Generate a Claude Code agent definition based on the user's description.

User's description: ${description}

Output ONLY valid YAML frontmatter followed by a markdown body. No markdown fences, no explanation.

Format:
name: kebab-case-name
description: one line description
model: sonnet
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep

---
(structured system prompt in markdown with sections: Role, Responsibilities, Scope, Workflow, Output Format, Quality Standards, Stop Conditions)

Rules:
- name must be kebab-case
- model must be one of: sonnet, opus, haiku
- tools must be from: Read, Write, Edit, Bash, Glob, Grep, Agent, SendMessage
- The body after --- should be a comprehensive system prompt in markdown
- Keep the system prompt practical and focused`;
}

function buildSkillPrompt(description: string): string {
  return `Generate a Claude Code skill definition based on the user's description.

User's description: ${description}

Output ONLY valid YAML frontmatter followed by a markdown body. No markdown fences, no explanation.

Format:
name: kebab-case-name
description: one line description

---
(skill instructions in markdown: when to use, step-by-step process, output format, examples)

Rules:
- name must be kebab-case
- The body after --- should be clear, actionable instructions
- Include specific examples where helpful
- Keep instructions focused and practical`;
}

async function callClaudeCli(prompt: string): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (result: { success: boolean; output: string; error?: string }): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const proc = spawn('claude', ['-p', prompt], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      settle({
        success: false,
        output: '',
        error: 'Claude CLI timed out after 60 seconds',
      });
    }, 60_000);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        settle({ success: true, output: stdout.trim() });
        return;
      }
      settle({
        success: false,
        output: stdout.trim(),
        error: `claude exited with code ${code}: ${stderr.trim()}`,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      settle({
        success: false,
        output: '',
        error: `Failed to spawn claude CLI: ${error.message}`,
      });
    });
  });
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:ya?ml)?\s*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .trim();
}

function parseGeneratedWorkflow(raw: string): Record<string, unknown> {
  const cleaned = stripMarkdownFences(raw);
  const parsed = parseWorkflowDocument(cleaned);
  if (!parsed) {
    throw new Error('Failed to parse workflow output as YAML or workflow markdown');
  }

  const validation = validateWorkflow(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid workflow: ${validation.errors.join('; ')}`);
  }

  return {
    type: 'workflow',
    workflow: parsed as unknown as Record<string, unknown>,
  };
}

function parseGeneratedAgent(raw: string): Record<string, unknown> {
  const { frontmatter, body } = splitGeneratedMarkdown(raw);
  const parsed = parseSimpleFrontmatter(frontmatter);
  const tools = Array.isArray(parsed.tools)
    ? parsed.tools.filter((value): value is string => typeof value === 'string')
    : ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

  return {
    type: 'agent',
    name: typeof parsed.name === 'string' ? parsed.name : 'unnamed-agent',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    model: typeof parsed.model === 'string' ? parsed.model : 'sonnet',
    tools,
    body,
  };
}

function parseGeneratedSkill(raw: string): Record<string, unknown> {
  const { frontmatter, body } = splitGeneratedMarkdown(raw);
  const parsed = parseSimpleFrontmatter(frontmatter);

  return {
    type: 'skill',
    name: typeof parsed.name === 'string' ? parsed.name : 'unnamed-skill',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    body,
  };
}

function splitGeneratedMarkdown(raw: string): { frontmatter: string; body: string } {
  const cleaned = stripMarkdownFences(raw);
  const separatorIndex = cleaned.indexOf('\n---\n');
  if (separatorIndex < 0) {
    return { frontmatter: cleaned, body: '' };
  }

  return {
    frontmatter: cleaned.slice(0, separatorIndex).trim(),
    body: cleaned.slice(separatorIndex + 5).trim(),
  };
}

function parseSimpleFrontmatter(frontmatter: string): Record<string, string | readonly string[]> {
  const parsed: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;

  for (const line of frontmatter.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && currentListKey) {
      const list = Array.isArray(parsed[currentListKey]) ? [...parsed[currentListKey] as string[]] : [];
      list.push(stripWrappedQuotes(listItem[1].trim()));
      parsed[currentListKey] = list;
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) {
      currentListKey = null;
      continue;
    }

    const [, key, rawValue] = keyValue;
    if (rawValue.trim() === '') {
      parsed[key] = [];
      currentListKey = key;
      continue;
    }

    parsed[key] = stripWrappedQuotes(rawValue.trim());
    currentListKey = null;
  }

  return parsed;
}

function stripWrappedQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function isUiCommandMessage(value: unknown): value is UiCommandMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybeType = (value as { type?: unknown }).type;
  return (
    maybeType === 'reload' ||
    maybeType === 'openExternal' ||
    maybeType === 'showLogs' ||
    maybeType === 'openEmbedded'
  );
}

function isBridgeRequestMessage(value: unknown): value is BridgeRequestMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Partial<BridgeRequestMessage> & { type?: string };
  if (!['bridgeRequest', 'bridge-request'].includes(msg.type ?? '') || typeof msg.id !== 'string') {
    return false;
  }
  if (!msg.request || typeof msg.request !== 'object') {
    return false;
  }
  const request = msg.request as Partial<BridgeRequestPayload>;
  return (
    typeof request.url === 'string' &&
    typeof request.method === 'string' &&
    (request.headers === undefined || typeof request.headers === 'object') &&
    (request.body === undefined || typeof request.body === 'string')
  );
}

function isBridgePickDirectoryMessage(value: unknown): value is BridgePickDirectoryMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Partial<BridgePickDirectoryMessage> & { type?: string };
  return ['bridgePickDirectory', 'bridge-pick-directory'].includes(msg.type ?? '') && typeof msg.id === 'string';
}

async function pickDirectoryViaVscodeDialog(): Promise<{ path?: string; error?: string }> {
  try {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Open Project',
    });
    if (!selected || selected.length === 0) {
      return {};
    }
    return { path: selected[0].fsPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to pick directory via VS Code';
    return { error: message };
  }
}

function jsonBridgeResponse(status: number, payload: unknown): BridgeResponsePayload {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function parseJsonObjectBody(body: string | undefined): Record<string, unknown> {
  const parsed = body && body.trim().length > 0 ? JSON.parse(body) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function parseResourceType(type: string): ResourceType | null {
  try {
    const decoded = decodeURIComponent(type) as ResourceType;
    return FILE_BASED_RESOURCE_TYPES.has(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function parseProjectTemplate(value: unknown): ProjectTemplate {
  if (value === 'dev-team' || value === 'ops-team') {
    return value;
  }
  return 'blank';
}

function sanitizeFileName(name: string): string | null {
  const sanitized = name
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '')
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, '-')
    .trim();

  if (sanitized === '' || sanitized === '.' || sanitized === '..') {
    return null;
  }

  return sanitized;
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getClaudeHomePath(): string {
  return expandHome('~/.claude');
}

function isAllowedClaudeFilePath(filePath: string): boolean {
  return isPathWithin(getClaudeHomePath(), filePath);
}

function buildMarkdownContent(content: string, frontmatter?: Record<string, unknown>): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return content;
  }

  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push('---', '', content);
  return lines.join('\n');
}

async function resolveProjectPath(projectId: string): Promise<string | null> {
  if (projectId === 'global') {
    return getClaudeHomePath();
  }
  const project = await studioCore.projects.scanProjectById(projectId);
  return project?.path ?? null;
}

async function resolveProjectResourceDir(
  projectId: string,
  type: 'agents' | 'skills' | 'workflows',
): Promise<string | null> {
  const projectPath = await resolveProjectPath(projectId);
  if (!projectPath) {
    return null;
  }
  return path.join(projectPath, type === 'skills' ? '.claude/skills' : `.claude/${type}`);
}

async function resolveClaudeMdPath(projectId: string): Promise<string | null> {
  if (projectId === 'global') {
    return path.join(getClaudeHomePath(), 'CLAUDE.md');
  }
  const projectPath = await resolveProjectPath(projectId);
  return projectPath ? path.join(projectPath, 'CLAUDE.md') : null;
}

const WORKFLOWS_SECTION_RE = /(^|\n)(## Workflows\n)([\s\S]*?)(?=\n## |\n*$)/;

function buildWorkflowLineRegex(workflowName: string): RegExp {
  const escaped = workflowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^- \\[${escaped}\\]\\(.*\\).*$`, 'm');
}

function updateWorkflowsSection(existing: string, workflowName: string, workflowLine: string): string {
  const sectionMatch = existing.match(WORKFLOWS_SECTION_RE);

  if (sectionMatch) {
    const sectionContent = sectionMatch[3];
    const lineRegex = buildWorkflowLineRegex(workflowName);

    if (lineRegex.test(sectionContent)) {
      const updatedContent = sectionContent.replace(lineRegex, workflowLine);
      return existing.replace(WORKFLOWS_SECTION_RE, `$1$2${updatedContent}`);
    }

    const trimmedContent = sectionContent.trimEnd();
    const newContent = trimmedContent ? `${trimmedContent}\n${workflowLine}` : workflowLine;
    return existing.replace(WORKFLOWS_SECTION_RE, `$1$2${newContent}`);
  }

  const separator = existing.length > 0 && !existing.endsWith('\n\n')
    ? (existing.endsWith('\n') ? '\n' : '\n\n')
    : '';
  return `${existing}${separator}## Workflows\n${workflowLine}\n`;
}

function detectWatchResourceType(filePath: string, claudeHome: string): ResourceType | null {
  const relative = path.relative(claudeHome, filePath);
  const firstDir = relative.split(path.sep)[0];
  const mapping: Record<string, ResourceType> = {
    agents: 'agents',
    workflows: 'workflows',
    skills: 'skills',
    rules: 'rules',
  };

  if (mapping[firstDir]) {
    return mapping[firstDir];
  }
  if (path.basename(filePath) === 'settings.json') {
    return 'mcps';
  }
  return null;
}

async function tryHandleBridgeRequestInProcess(
  target: URL,
  request: BridgeRequestPayload,
): Promise<BridgeResponsePayload | null> {
  const method = request.method.toUpperCase();
  const segments = target.pathname.split('/').filter(Boolean);
  let projectIdFromPath: string | null = null;
  if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'projects') {
    try {
      projectIdFromPath = decodeURIComponent(segments[2]);
    } catch {
      return jsonBridgeResponse(400, { success: false, error: 'Invalid project id' });
    }
  }

  try {
    // GET /api/resources
    if (target.pathname === '/api/resources' && method === 'GET') {
      const results = await Promise.all(
        ['agents', 'workflows', 'skills', 'rules'].map((type) =>
          studioCore.resources.listResourceFiles(type as ResourceType),
        ),
      );
      return jsonBridgeResponse(200, { success: true, data: results.flat() });
    }

    // /api/resources/:type
    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'resources') {
      const type = parseResourceType(segments[2]);
      if (!type) {
        return jsonBridgeResponse(400, { success: false, error: `Invalid resource type: ${segments[2]}` });
      }

      if (method === 'GET') {
        const resources = await studioCore.resources.listResourceFiles(type);
        return jsonBridgeResponse(200, { success: true, data: resources });
      }

      if (method === 'POST') {
        const body = parseJsonObjectBody(request.body);
        const id = typeof body.id === 'string' ? body.id : '';
        const content = typeof body.content === 'string' ? body.content : null;
        if (!id || content === null) {
          return jsonBridgeResponse(400, { success: false, error: 'Missing required fields: id, content' });
        }
        const frontmatter = body.frontmatter && typeof body.frontmatter === 'object' && !Array.isArray(body.frontmatter)
          ? body.frontmatter as Record<string, unknown>
          : undefined;
        const resource = await studioCore.resources.writeResourceFile(type, id, content, frontmatter);
        return jsonBridgeResponse(201, { success: true, data: resource });
      }
      return null;
    }

    // /api/resources/:type/:id
    if (segments.length >= 4 && segments[0] === 'api' && segments[1] === 'resources') {
      const type = parseResourceType(segments[2]);
      if (!type) {
        return jsonBridgeResponse(400, { success: false, error: `Invalid resource type: ${segments[2]}` });
      }
      const id = decodeURIComponent(segments.slice(3).join('/'));
      if (!id) {
        return jsonBridgeResponse(400, { success: false, error: 'Missing resource id' });
      }

      if (method === 'GET') {
        const resources = await studioCore.resources.listResourceFiles(type);
        const resource = resources.find((r) => r.id === id);
        if (!resource) {
          return jsonBridgeResponse(404, { success: false, error: `Resource not found: ${id}` });
        }
        return jsonBridgeResponse(200, { success: true, data: resource });
      }

      if (method === 'PUT') {
        const body = parseJsonObjectBody(request.body);
        const content = typeof body.content === 'string' ? body.content : null;
        if (content === null) {
          return jsonBridgeResponse(400, { success: false, error: 'Missing required field: content' });
        }

        const resourcePath = typeof body.path === 'string' ? body.path : '';
        if (resourcePath.endsWith('/CLAUDE.md') && isAllowedClaudeFilePath(resourcePath)) {
          await fs.mkdir(path.dirname(resourcePath), { recursive: true });
          await fs.writeFile(resourcePath, content, 'utf-8');
          return jsonBridgeResponse(200, {
            success: true,
            data: {
              id,
              type,
              name: 'CLAUDE.md',
              path: resourcePath,
              content,
            },
          });
        }

        const frontmatter = body.frontmatter && typeof body.frontmatter === 'object' && !Array.isArray(body.frontmatter)
          ? body.frontmatter as Record<string, unknown>
          : undefined;
        const resource = await studioCore.resources.writeResourceFile(type, id, content, frontmatter);
        return jsonBridgeResponse(200, { success: true, data: resource });
      }

      if (method === 'DELETE') {
        await studioCore.resources.deleteResourceFile(type, id);
        return jsonBridgeResponse(200, { success: true, data: null });
      }

      return null;
    }

    // /api/settings
    if (target.pathname === '/api/settings') {
      const scope = target.searchParams.get('scope') ?? 'global';
      const projectPath = target.searchParams.get('projectPath');

      if (method === 'GET') {
        if (scope === 'project') {
          if (!projectPath) {
            return jsonBridgeResponse(400, { success: false, error: 'projectPath is required for scope=project' });
          }
          const data = await studioCore.settings.readProjectSettings(projectPath);
          return jsonBridgeResponse(200, { success: true, data: data as unknown as Record<string, unknown> });
        }
        const settings = await studioCore.settings.readSettings();
        return jsonBridgeResponse(200, { success: true, data: settings });
      }

      if (method === 'PUT') {
        const body = parseJsonObjectBody(request.body);
        if (scope === 'project-shared') {
          if (!projectPath) {
            return jsonBridgeResponse(400, { success: false, error: 'projectPath is required for scope=project-shared' });
          }
          await studioCore.settings.writeProjectSharedSettings(projectPath, body);
          const data = await studioCore.settings.readProjectSettings(projectPath);
          return jsonBridgeResponse(200, { success: true, data: data as unknown as Record<string, unknown> });
        }
        if (scope === 'project-local') {
          if (!projectPath) {
            return jsonBridgeResponse(400, { success: false, error: 'projectPath is required for scope=project-local' });
          }
          await studioCore.settings.writeProjectLocalSettings(projectPath, body);
          const data = await studioCore.settings.readProjectSettings(projectPath);
          return jsonBridgeResponse(200, { success: true, data: data as unknown as Record<string, unknown> });
        }
        await studioCore.settings.writeSettings(body);
        const updated = await studioCore.settings.readSettings();
        return jsonBridgeResponse(200, { success: true, data: updated });
      }

      return null;
    }

    // /api/files
    if (target.pathname === '/api/files') {
      if (method === 'DELETE') {
        const filePath = target.searchParams.get('path') ?? '';
        if (!filePath) {
          return jsonBridgeResponse(400, { success: false, error: 'Missing required query param: path' });
        }
        if (!isAllowedClaudeFilePath(filePath)) {
          return jsonBridgeResponse(403, { success: false, error: 'Path must be under ~/.claude/' });
        }
        if (!(await studioCore.files.fileExists(filePath))) {
          return jsonBridgeResponse(404, { success: false, error: `File not found: ${filePath}` });
        }
        await fs.unlink(filePath);
        return jsonBridgeResponse(200, { success: true, data: null });
      }

      if (method === 'PUT') {
        const body = parseJsonObjectBody(request.body);
        const filePath = typeof body.path === 'string' ? body.path : '';
        const content = typeof body.content === 'string' ? body.content : null;
        if (!filePath || content === null) {
          return jsonBridgeResponse(400, { success: false, error: 'Missing required fields: path, content' });
        }
        if (!isAllowedClaudeFilePath(filePath)) {
          return jsonBridgeResponse(403, { success: false, error: 'Path must be under ~/.claude/' });
        }
        if (!(await studioCore.files.fileExists(filePath))) {
          return jsonBridgeResponse(404, { success: false, error: `File not found: ${filePath}` });
        }
        const frontmatter =
          body.frontmatter && typeof body.frontmatter === 'object' && !Array.isArray(body.frontmatter)
            ? body.frontmatter as Record<string, unknown>
            : undefined;
        const fileContent = buildMarkdownContent(content, frontmatter);
        await fs.writeFile(filePath, fileContent, 'utf-8');
        return jsonBridgeResponse(200, { success: true, data: null });
      }

      return null;
    }

    // GET /api/community
    if (target.pathname === '/api/community' && method === 'GET') {
      const links = await fetchCommunityLinks();
      return jsonBridgeResponse(200, links);
    }

    // POST /api/generate
    if (target.pathname === '/api/generate' && method === 'POST') {
      const body = parseJsonObjectBody(request.body) as GenerateRequestBody;
      const type = body.type;
      const description = typeof body.description === 'string' ? body.description.trim() : '';

      if (!description) {
        return jsonBridgeResponse(400, { success: false, error: 'Description is required' });
      }
      if (!type || !['workflow', 'agent', 'skill'].includes(type)) {
        return jsonBridgeResponse(400, {
          success: false,
          error: 'Type must be "workflow", "agent", or "skill"',
        });
      }

      const prompt = buildGeneratePrompt(type, description, body.agents ?? [], body.skills ?? []);
      const generated = await callClaudeCli(prompt);
      if (!generated.success) {
        return jsonBridgeResponse(502, {
          success: false,
          error: generated.error ?? 'Claude CLI failed',
        });
      }

      try {
        let parsed: Record<string, unknown>;
        if (type === 'workflow') {
          parsed = parseGeneratedWorkflow(generated.output);
        } else if (type === 'agent') {
          parsed = parseGeneratedAgent(generated.output);
        } else {
          parsed = parseGeneratedSkill(generated.output);
        }
        return jsonBridgeResponse(200, { success: true, data: parsed });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to parse Claude output';
        return jsonBridgeResponse(422, { success: false, error: message });
      }
    }

    // GET /api/projects
    if (target.pathname === '/api/projects' && method === 'GET') {
      const projects = await studioCore.projects.scanAllProjectSummaries();
      return jsonBridgeResponse(200, { success: true, data: projects });
    }

    // GET /api/projects/browse?prefix=...
    if (target.pathname === '/api/projects/browse' && method === 'GET') {
      const prefix = target.searchParams.get('prefix') ?? '';
      if (prefix === '') {
        return jsonBridgeResponse(200, { success: true, data: { entries: [] } });
      }

      const expanded = expandHome(prefix);
      const resolved = path.resolve(expanded);
      const homeDir = os.homedir();
      if (!isPathWithin(homeDir, resolved)) {
        return jsonBridgeResponse(403, { success: false, error: 'Path not allowed: must be within home directory' });
      }

      const parentDir = expanded.endsWith('/') ? resolved : path.dirname(resolved);
      const namePrefix = expanded.endsWith('/') ? '' : path.basename(resolved).toLowerCase();

      let entries: readonly string[];
      try {
        const dirEntries = await fs.readdir(parentDir, { withFileTypes: true });
        entries = dirEntries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .filter((e) => namePrefix === '' || e.name.toLowerCase().startsWith(namePrefix))
          .slice(0, 20)
          .map((e) => path.join(parentDir, e.name));
      } catch {
        entries = [];
      }

      return jsonBridgeResponse(200, { success: true, data: { entries } });
    }

    // POST /api/projects/pick-directory
    if (target.pathname === '/api/projects/pick-directory' && method === 'POST') {
      const picked = await pickDirectoryViaVscodeDialog();
      if (picked.path) {
        return jsonBridgeResponse(200, { success: true, data: { path: picked.path } });
      }
      return jsonBridgeResponse(400, { success: false, error: picked.error ?? 'No directory selected' });
    }

    // POST /api/projects/open
    if (target.pathname === '/api/projects/open' && method === 'POST') {
      const body = parseJsonObjectBody(request.body);
      const rawPath = typeof body.path === 'string' ? body.path : '';
      if (!rawPath.trim()) {
        return jsonBridgeResponse(400, { success: false, error: 'Missing required field: path' });
      }

      const projectPath = path.resolve(expandHome(rawPath).replace(/\/+$/, ''));
      const homeDir = os.homedir();
      if (!isPathWithin(homeDir, projectPath)) {
        return jsonBridgeResponse(403, { success: false, error: 'Path not allowed: must be within home directory' });
      }
      if (!(await studioCore.files.fileExists(projectPath))) {
        return jsonBridgeResponse(404, { success: false, error: `Path does not exist: ${projectPath}` });
      }
      const project = await studioCore.projects.scanProjectAtPath(projectPath);
      return jsonBridgeResponse(200, { success: true, data: project });
    }

    // POST /api/projects/create
    if (target.pathname === '/api/projects/create' && method === 'POST') {
      const body = parseJsonObjectBody(request.body);
      const projectName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!projectName) {
        return jsonBridgeResponse(400, { success: false, error: 'Missing required field: name' });
      }

      const parentDirRaw = typeof body.parentDir === 'string' ? body.parentDir : '~/Claude';
      const parentDir = expandHome(parentDirRaw);
      const homeDir = os.homedir();
      if (!isPathWithin(homeDir, parentDir)) {
        return jsonBridgeResponse(403, { success: false, error: 'Path not allowed: must be within home directory' });
      }
      const projectPath = path.join(parentDir, projectName);
      if (await studioCore.files.fileExists(projectPath)) {
        return jsonBridgeResponse(409, { success: false, error: `Directory already exists: ${projectPath}` });
      }

      const template = parseProjectTemplate(body.template);
      const project = await studioCore.projects.createProject({
        name: projectName,
        parentDir: parentDirRaw,
        template,
      });
      return jsonBridgeResponse(201, { success: true, data: project });
    }

    // GET /api/projects/:id
    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'projects' && method === 'GET') {
      const project = await studioCore.projects.scanProjectById(projectIdFromPath ?? '');
      if (!project) {
        return jsonBridgeResponse(404, { success: false, error: `Project not found: ${projectIdFromPath}` });
      }
      return jsonBridgeResponse(200, { success: true, data: project });
    }

    // /api/projects/:id/(agents|skills|workflows|claudemd)
    if (
      segments.length === 4 &&
      segments[0] === 'api' &&
      segments[1] === 'projects' &&
      projectIdFromPath
    ) {
      const resourceKind = segments[3];

      if (resourceKind === 'agents') {
        const agentsDir = await resolveProjectResourceDir(projectIdFromPath, 'agents');
        if (!agentsDir) {
          return jsonBridgeResponse(404, { success: false, error: `Project not found: ${projectIdFromPath}` });
        }

        if (method === 'POST') {
          const body = parseJsonObjectBody(request.body);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const content = typeof body.content === 'string' ? body.content : null;
          if (!name) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: name' });
          }
          if (content === null) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: content' });
          }
          const safeName = sanitizeFileName(name);
          if (!safeName) {
            return jsonBridgeResponse(400, { success: false, error: 'Invalid agent name: contains unsafe characters' });
          }
          await fs.mkdir(agentsDir, { recursive: true });
          const filePath = path.join(agentsDir, `${safeName}.md`);
          if (await studioCore.files.fileExists(filePath)) {
            return jsonBridgeResponse(409, { success: false, error: `Agent already exists: ${name}` });
          }
          const frontmatter =
            body.frontmatter && typeof body.frontmatter === 'object' && !Array.isArray(body.frontmatter)
              ? body.frontmatter as Record<string, unknown>
              : undefined;
          const fileContent = buildMarkdownContent(content, frontmatter);
          await fs.writeFile(filePath, fileContent, 'utf-8');
          return jsonBridgeResponse(201, {
            success: true,
            data: {
              id: encodeURIComponent(name),
              type: 'agents',
              name,
              path: filePath,
              content,
              frontmatter,
            },
          });
        }

        if (method === 'DELETE') {
          const agentName = target.searchParams.get('name') ?? '';
          if (!agentName) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required query param: name' });
          }
          const safeName = sanitizeFileName(agentName);
          if (!safeName) {
            return jsonBridgeResponse(400, { success: false, error: 'Invalid agent name: contains unsafe characters' });
          }
          const filePath = path.join(agentsDir, `${safeName}.md`);
          if (!(await studioCore.files.fileExists(filePath))) {
            return jsonBridgeResponse(404, { success: false, error: `Agent not found: ${agentName}` });
          }
          await fs.unlink(filePath);
          return jsonBridgeResponse(200, { success: true, data: null });
        }

        return null;
      }

      if (resourceKind === 'skills') {
        const skillsDir = await resolveProjectResourceDir(projectIdFromPath, 'skills');
        if (!skillsDir) {
          return jsonBridgeResponse(404, { success: false, error: `Project not found: ${projectIdFromPath}` });
        }

        if (method === 'POST') {
          const body = parseJsonObjectBody(request.body);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const content = typeof body.content === 'string' ? body.content : null;
          const description = typeof body.description === 'string' ? body.description.trim() : '';
          if (!name) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: name' });
          }
          if (content === null) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: content' });
          }
          const safeName = sanitizeFileName(name);
          if (!safeName) {
            return jsonBridgeResponse(400, { success: false, error: 'Invalid skill name: contains unsafe characters' });
          }

          const skillDir = path.join(skillsDir, safeName);
          const filePath = path.join(skillDir, 'SKILL.md');
          if (await studioCore.files.fileExists(filePath)) {
            return jsonBridgeResponse(409, { success: false, error: `Skill already exists: ${safeName}` });
          }

          await fs.mkdir(skillDir, { recursive: true });
          const frontmatter: Record<string, unknown> = { name };
          if (description) {
            frontmatter.description = description;
          }
          const fileContent = buildMarkdownContent(content, frontmatter);
          await fs.writeFile(filePath, fileContent, 'utf-8');
          return jsonBridgeResponse(201, {
            success: true,
            data: {
              id: encodeURIComponent(name),
              type: 'skills',
              name,
              path: filePath,
              content,
              frontmatter,
            },
          });
        }

        if (method === 'DELETE') {
          const skillName = target.searchParams.get('name') ?? '';
          if (!skillName) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required query param: name' });
          }
          const safeName = sanitizeFileName(skillName);
          if (!safeName) {
            return jsonBridgeResponse(400, { success: false, error: 'Invalid skill name: contains unsafe characters' });
          }
          const skillDir = path.join(skillsDir, safeName);
          const filePath = path.join(skillDir, 'SKILL.md');
          if (!(await studioCore.files.fileExists(filePath))) {
            return jsonBridgeResponse(404, { success: false, error: `Skill not found: ${skillName}` });
          }
          await fs.rm(skillDir, { recursive: true });
          return jsonBridgeResponse(200, { success: true, data: null });
        }

        return null;
      }

      if (resourceKind === 'workflows') {
        const workflowsDir = await resolveProjectResourceDir(projectIdFromPath, 'workflows');
        if (!workflowsDir) {
          return jsonBridgeResponse(404, { success: false, error: `Project not found: ${projectIdFromPath}` });
        }

        if (method === 'POST' || method === 'PUT') {
          const body = parseJsonObjectBody(request.body);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const content = typeof body.content === 'string' ? body.content : null;
          if (!name) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: name' });
          }
          if (content === null) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: content' });
          }
          const safeName = sanitizeFileName(name);
          if (!safeName) {
            return jsonBridgeResponse(400, { success: false, error: 'Invalid workflow name: contains unsafe characters' });
          }

          const parsedWorkflow = parseWorkflowDocument(content);
          if (!parsedWorkflow) {
            return jsonBridgeResponse(400, {
              success: false,
              error: 'Invalid workflow content: expected YAML or markdown with YAML block',
            });
          }
          const formattedContent = formatWorkflowDocument(parsedWorkflow as unknown as Record<string, unknown>);

          await fs.mkdir(workflowsDir, { recursive: true });
          const filePath = path.join(workflowsDir, `${safeName}.md`);
          if (method === 'POST') {
            const conflictCandidates = [
              filePath,
              path.join(workflowsDir, `${safeName}.yaml`),
              path.join(workflowsDir, `${safeName}.yml`),
            ];
            let existsAny = false;
            for (const candidate of conflictCandidates) {
              if (await studioCore.files.fileExists(candidate)) {
                existsAny = true;
                break;
              }
            }
            if (existsAny) {
              return jsonBridgeResponse(409, { success: false, error: `Workflow already exists: ${safeName}` });
            }
          }

          await fs.writeFile(filePath, formattedContent, 'utf-8');
          for (const ext of ['.yaml', '.yml']) {
            const legacyPath = path.join(workflowsDir, `${safeName}${ext}`);
            if (await studioCore.files.fileExists(legacyPath)) {
              await fs.unlink(legacyPath);
            }
          }
          return jsonBridgeResponse(method === 'POST' ? 201 : 200, {
            success: true,
            data: {
              id: encodeURIComponent(name),
              type: 'workflows',
              name,
              path: filePath,
              content: formattedContent,
            },
          });
        }

        if (method === 'DELETE') {
          const workflowName = target.searchParams.get('name') ?? '';
          if (!workflowName) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required query param: name' });
          }
          const safeName = sanitizeFileName(workflowName);
          if (!safeName) {
            return jsonBridgeResponse(400, { success: false, error: 'Invalid workflow name: contains unsafe characters' });
          }

          const candidates = [
            path.join(workflowsDir, `${safeName}.md`),
            path.join(workflowsDir, `${safeName}.yaml`),
            path.join(workflowsDir, `${safeName}.yml`),
          ];
          let targetPath: string | null = null;
          for (const candidate of candidates) {
            if (await studioCore.files.fileExists(candidate)) {
              targetPath = candidate;
              break;
            }
          }

          if (!targetPath) {
            return jsonBridgeResponse(404, { success: false, error: `Workflow not found: ${workflowName}` });
          }
          await fs.unlink(targetPath);
          return jsonBridgeResponse(200, { success: true, data: null });
        }

        return null;
      }

      if (resourceKind === 'claudemd') {
        const claudeMdPath = await resolveClaudeMdPath(projectIdFromPath);
        if (!claudeMdPath) {
          return jsonBridgeResponse(404, { success: false, error: `Project not found: ${projectIdFromPath}` });
        }

        if (method === 'POST') {
          const body = parseJsonObjectBody(request.body);
          const content = typeof body.content === 'string' ? body.content : null;
          if (content === null) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: content' });
          }
          await fs.mkdir(path.dirname(claudeMdPath), { recursive: true });
          await fs.writeFile(claudeMdPath, content, 'utf-8');
          return jsonBridgeResponse(200, { success: true, data: { updated: true } });
        }

        if (method === 'PUT') {
          const body = parseJsonObjectBody(request.body);
          const workflowName = typeof body.workflowName === 'string' ? body.workflowName.trim() : '';
          const workflowLine = typeof body.workflowLine === 'string' ? body.workflowLine : null;
          if (!workflowName) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: workflowName' });
          }
          if (workflowLine === null) {
            return jsonBridgeResponse(400, { success: false, error: 'Missing required field: workflowLine' });
          }

          let existing = '';
          if (await studioCore.files.fileExists(claudeMdPath)) {
            existing = await fs.readFile(claudeMdPath, 'utf-8');
          }
          const updated = updateWorkflowsSection(existing, workflowName, workflowLine);
          await fs.mkdir(path.dirname(claudeMdPath), { recursive: true });
          await fs.writeFile(claudeMdPath, updated, 'utf-8');
          return jsonBridgeResponse(200, { success: true, data: { updated: true } });
        }

        return null;
      }
    }

    // /api/execute
    if (target.pathname === '/api/execute' && method === 'POST') {
      const body = parseJsonObjectBody(request.body) as ExecuteRequestBody;
      const workflow = body.workflow;

      if (!workflow) {
        return jsonBridgeResponse(400, {
          success: false,
          error: 'Either workflow or workflowYaml is required',
        });
      }
      if (!workflow.name || !Array.isArray(workflow.nodes)) {
        return jsonBridgeResponse(400, {
          success: false,
          error: 'Invalid workflow: missing name or nodes',
        });
      }
      if (workflow.nodes.length === 0) {
        return jsonBridgeResponse(400, {
          success: false,
          error: 'Workflow must have at least one node',
        });
      }

      const workflowInput: WorkflowInput = {
        name: workflow.name,
        nodes: workflow.nodes.map((node) => ({
          id: node.id,
          agent: node.agent,
          task: node.task,
          checkpoint: node.checkpoint,
          depends_on: node.depends_on,
          roundtrip: node.roundtrip,
          skills: node.skills,
        })),
      };

      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : undefined;
      const simulate = body.simulate ?? true;
      const runner = startExecution(workflowInput, { simulate, projectPath });
      const state = runner.getState();
      return jsonBridgeResponse(200, {
        success: true,
        data: { executionId: state.id },
      });
    }

    // GET /api/execute/:id
    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'execute' && method === 'GET') {
      let executionId = '';
      try {
        executionId = decodeURIComponent(segments[2]);
      } catch {
        return jsonBridgeResponse(400, { success: false, error: 'Invalid execution id' });
      }
      const runner = getExecution(executionId);
      if (!runner) {
        return jsonBridgeResponse(404, { success: false, error: `Execution not found: ${executionId}` });
      }
      return jsonBridgeResponse(200, { success: true, data: runner.getState() });
    }

    // POST /api/execute/:id/cancel
    if (
      segments.length === 4 &&
      segments[0] === 'api' &&
      segments[1] === 'execute' &&
      segments[3] === 'cancel' &&
      method === 'POST'
    ) {
      let executionId = '';
      try {
        executionId = decodeURIComponent(segments[2]);
      } catch {
        return jsonBridgeResponse(400, { success: false, error: 'Invalid execution id' });
      }
      const runner = getExecution(executionId);
      if (!runner) {
        return jsonBridgeResponse(404, { success: false, error: `Execution not found: ${executionId}` });
      }
      runner.cancel();
      return jsonBridgeResponse(200, { success: true, data: { cancelled: true } });
    }

    // POST /api/execute/:id/checkpoint/:nodeId
    if (
      segments.length === 5 &&
      segments[0] === 'api' &&
      segments[1] === 'execute' &&
      segments[3] === 'checkpoint' &&
      method === 'POST'
    ) {
      let executionId = '';
      let nodeId = '';
      try {
        executionId = decodeURIComponent(segments[2]);
        nodeId = decodeURIComponent(segments[4]);
      } catch {
        return jsonBridgeResponse(400, { success: false, error: 'Invalid execution or node id' });
      }
      const runner = getExecution(executionId);
      if (!runner) {
        return jsonBridgeResponse(404, { success: false, error: `Execution not found: ${executionId}` });
      }
      const approved = runner.approveCheckpoint(nodeId);
      if (!approved) {
        return jsonBridgeResponse(400, {
          success: false,
          error: `No pending checkpoint for node: ${nodeId}`,
        });
      }
      return jsonBridgeResponse(200, { success: true, data: { approved: true } });
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'In-process bridge request failed';
    return jsonBridgeResponse(500, { success: false, error: message });
  }
}

async function proxyBridgeRequest(
  serverUrl: URL,
  request: BridgeRequestPayload,
): Promise<BridgeResponsePayload> {
  let target: URL;
  try {
    target = resolveBridgeTarget(serverUrl, request.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid bridge target URL';
    return errorBridgeResponse(400, message);
  }

  const transport = target.protocol === 'https:' ? https : http;
  const method = request.method.toUpperCase();
  const headers = sanitizeOutgoingHeaders(request.headers ?? {});

  const inProcessResponse = await tryHandleBridgeRequestInProcess(target, request);
  if (inProcessResponse) {
    appendLog(`[bridge:local] ${method} ${target.pathname}${target.search}`);
    return inProcessResponse;
  }

  return new Promise((resolve) => {
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const response: BridgeResponsePayload = {
            status: res.statusCode ?? 500,
            headers: normalizeIncomingHeaders(res.headers),
            body: Buffer.concat(chunks).toString('utf-8'),
          };
          resolve(response);
        });
      },
    );

    req.on('error', (error) => {
      const message = error instanceof Error ? error.message : 'Bridge proxy request failed';
      resolve(errorBridgeResponse(502, message));
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(errorBridgeResponse(504, 'Bridge proxy request timed out'));
    });

    if (request.body && method !== 'GET' && method !== 'HEAD') {
      req.write(request.body);
    }
    req.end();
  });
}

function resolveBridgeTarget(serverUrl: URL, requestUrl: string): URL {
  const target = new URL(requestUrl, serverUrl);
  const allowedOrigin = `${serverUrl.protocol}//${serverUrl.host}`;
  if (target.origin !== allowedOrigin) {
    throw new Error('Cross-origin bridge request is not allowed');
  }
  if (!target.pathname.startsWith('/api/')) {
    throw new Error('Only /api/* bridge requests are allowed');
  }
  return target;
}

function sanitizeOutgoingHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;
    const normalized = key.toLowerCase();
    if (normalized === 'host' || normalized === 'content-length') {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function normalizeIncomingHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function errorBridgeResponse(status: number, message: string): BridgeResponsePayload {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ success: false, error: message }),
  };
}

function createFsWatcherSafely(
  watchPath: string,
  onChange: (eventType: string, filename: string | Buffer | null) => void,
): nodeFs.FSWatcher {
  try {
    return nodeFs.watch(watchPath, { recursive: true }, onChange);
  } catch {
    return nodeFs.watch(watchPath, onChange);
  }
}

async function tryStartBridgeStreamInProcess(
  target: URL,
  panel: vscode.WebviewPanel,
  message: BridgeStreamStartMessage,
): Promise<boolean> {
  const segments = target.pathname.split('/').filter(Boolean);

  // /api/execute/:id/stream
  if (
    segments.length === 4 &&
    segments[0] === 'api' &&
    segments[1] === 'execute' &&
    segments[3] === 'stream'
  ) {
    let executionId = '';
    try {
      executionId = decodeURIComponent(segments[2]);
    } catch {
      await postBridgeStreamError(panel, message.id, 'Invalid execution id');
      await postBridgeStreamEnd(panel, message.id);
      return true;
    }

    const runner = getExecution(executionId);
    if (!runner) {
      await postBridgeStreamError(panel, message.id, `Execution not found: ${executionId}`);
      await postBridgeStreamEnd(panel, message.id);
      return true;
    }

    const postExecutionEvent = async (event: unknown): Promise<void> => {
      await postBridgeStreamEvent(panel, message.id, JSON.stringify(event));
    };

    const onEvent = (event: ExecutionEvent): void => {
      if (!bridgeStreams.has(message.id)) {
        return;
      }

      void postExecutionEvent(event);

      if (
        event.type === 'execution-status' &&
        (event.overallStatus === 'completed' || event.overallStatus === 'failed' || event.overallStatus === 'cancelled')
      ) {
        void (async () => {
          await postExecutionEvent({ type: 'final', state: runner.getState() });
          await postBridgeStreamEnd(panel, message.id);
          stopBridgeStream(message.id);
        })();
      }
    };

    bridgeStreams.set(message.id, {
      kind: 'inProcessExecution',
      cleanup: () => {
        runner.removeListener('event', onEvent);
      },
    });

    runner.on('event', onEvent);
    await postExecutionEvent({ type: 'init', state: runner.getState() });

    const currentStatus = runner.getState().status;
    if (currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'cancelled') {
      await postExecutionEvent({ type: 'final', state: runner.getState() });
      await postBridgeStreamEnd(panel, message.id);
      stopBridgeStream(message.id);
    }

    appendLog(`[bridge:local] STREAM GET /api/execute/${executionId}/stream`);
    return true;
  }

  if (target.pathname !== '/api/watch') {
    return false;
  }

  const claudeHome = getClaudeHomePath();
  const watchers: nodeFs.FSWatcher[] = [];

  const emitChange = (filePath: string, eventType: string): void => {
    const resourceType = detectWatchResourceType(filePath, claudeHome);
    if (!resourceType) {
      return;
    }
    const normalizedType: 'add' | 'change' | 'unlink' = eventType === 'change' ? 'change' : 'add';
    void postBridgeStreamEvent(
      panel,
      message.id,
      JSON.stringify({
        type: normalizedType,
        path: filePath,
        resourceType,
      }),
    );
  };

  for (const dirName of WATCHED_RESOURCE_DIRS) {
    const dirPath = path.join(claudeHome, dirName);
    await fs.mkdir(dirPath, { recursive: true });
    const watcher = createFsWatcherSafely(dirPath, (eventType, filename) => {
      if (!bridgeStreams.has(message.id)) {
        return;
      }
      const fileNameText = typeof filename === 'string' ? filename : filename?.toString() ?? '';
      if (!fileNameText) {
        return;
      }
      emitChange(path.join(dirPath, fileNameText), eventType);
    });
    watcher.on('error', (error) => {
      if (!bridgeStreams.has(message.id)) {
        return;
      }
      const text = error instanceof Error ? error.message : 'File watcher error';
      void postBridgeStreamError(panel, message.id, text);
      stopBridgeStream(message.id);
    });
    watchers.push(watcher);
  }

  const settingsPath = path.join(claudeHome, 'settings.json');
  if (await studioCore.files.fileExists(settingsPath)) {
    const settingsWatcher = createFsWatcherSafely(settingsPath, (eventType) => {
      if (!bridgeStreams.has(message.id)) {
        return;
      }
      emitChange(settingsPath, eventType);
    });
    settingsWatcher.on('error', (error) => {
      if (!bridgeStreams.has(message.id)) {
        return;
      }
      const text = error instanceof Error ? error.message : 'Settings watcher error';
      void postBridgeStreamError(panel, message.id, text);
      stopBridgeStream(message.id);
    });
    watchers.push(settingsWatcher);
  }

  const keepAliveTimer = setInterval(() => {
    if (!bridgeStreams.has(message.id)) {
      return;
    }
    void postBridgeStreamEvent(panel, message.id, JSON.stringify({ type: 'connected', path: claudeHome }));
  }, 30_000);

  bridgeStreams.set(message.id, {
    kind: 'inProcessWatch',
    keepAliveTimer,
    watchers,
  });

  await postBridgeStreamEvent(panel, message.id, JSON.stringify({ type: 'connected', path: claudeHome }));
  appendLog('[bridge:local] STREAM GET /api/watch');
  return true;
}

function isBridgeStreamStartMessage(value: unknown): value is BridgeStreamStartMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Partial<BridgeStreamStartMessage> & { type?: string };
  return ['bridgeStreamStart', 'bridge-stream-start'].includes(msg.type ?? '') && typeof msg.id === 'string' && typeof msg.url === 'string';
}

function isBridgeStreamStopMessage(value: unknown): value is BridgeStreamStopMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Partial<BridgeStreamStopMessage> & { type?: string };
  return ['bridgeStreamStop', 'bridge-stream-stop'].includes(msg.type ?? '') && typeof msg.id === 'string';
}

async function startBridgeStream(
  serverUrl: URL,
  panel: vscode.WebviewPanel,
  message: BridgeStreamStartMessage,
): Promise<void> {
  let target: URL;
  try {
    target = resolveBridgeTarget(serverUrl, message.url);
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Invalid bridge stream target URL';
    await postBridgeStreamError(panel, message.id, text);
    return;
  }

  stopBridgeStream(message.id);

  try {
    if (await tryStartBridgeStreamInProcess(target, panel, message)) {
      return;
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Failed to start in-process stream';
    appendLog(`[bridge:local] stream fallback to http: ${text}`);
  }

  const transport = target.protocol === 'https:' ? https : http;
  const req = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      timeout: 0,
    },
    (res) => {
      const handle = bridgeStreams.get(message.id);
      if (!handle) {
        res.destroy();
        return;
      }
      if (handle.kind === 'http') {
        handle.response = res;
      }

      if ((res.statusCode ?? 500) >= 400) {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const text = body || `Bridge stream failed with status ${res.statusCode ?? 500}`;
          void postBridgeStreamError(panel, message.id, text);
          stopBridgeStream(message.id);
        });
        return;
      }

      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (!bridgeStreams.has(message.id)) {
          return;
        }
        buffer += chunk.replace(/\r\n/g, '\n');
        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          const block = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const data = parseSseEventData(block);
          if (data !== null) {
            void postBridgeStreamEvent(panel, message.id, data);
          }
          sepIndex = buffer.indexOf('\n\n');
        }
      });

      res.on('end', () => {
        if (!bridgeStreams.has(message.id)) {
          return;
        }
        void postBridgeStreamEnd(panel, message.id);
        stopBridgeStream(message.id);
      });

      res.on('error', (error) => {
        if (!bridgeStreams.has(message.id)) {
          return;
        }
        const text = error instanceof Error ? error.message : 'Bridge stream response error';
        void postBridgeStreamError(panel, message.id, text);
        stopBridgeStream(message.id);
      });
    },
  );

  req.on('error', (error) => {
    if (!bridgeStreams.has(message.id)) {
      return;
    }
    const text = error instanceof Error ? error.message : 'Bridge stream request failed';
    void postBridgeStreamError(panel, message.id, text);
    stopBridgeStream(message.id);
  });

  bridgeStreams.set(message.id, { kind: 'http', request: req });
  req.end();
}

function stopBridgeStream(id: string): void {
  const handle = bridgeStreams.get(id);
  if (!handle) {
    return;
  }
  bridgeStreams.delete(id);
  if (handle.kind === 'http') {
    handle.response?.destroy();
    handle.request?.destroy();
    return;
  }
  if (handle.kind === 'inProcessExecution') {
    handle.cleanup?.();
    return;
  }
  if (handle.keepAliveTimer) {
    clearInterval(handle.keepAliveTimer);
  }
  if (handle.watchers) {
    for (const watcher of handle.watchers) {
      watcher.close();
    }
  }
}

function clearAllBridgeStreams(): void {
  for (const id of bridgeStreams.keys()) {
    stopBridgeStream(id);
  }
}

function parseSseEventData(block: string): string | null {
  if (!block) {
    return null;
  }

  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join('\n');
}

async function postBridgeStreamEvent(
  panel: vscode.WebviewPanel,
  id: string,
  data: string,
): Promise<void> {
  const payload: BridgeStreamEventMessage = { type: 'bridgeStreamEvent', id, data };
  try {
    await panel.webview.postMessage(payload);
  } catch {
    // Ignore post failures from stale/disposed panels.
  }
}

async function postBridgeStreamError(
  panel: vscode.WebviewPanel,
  id: string,
  error: string,
): Promise<void> {
  const payload: BridgeStreamErrorMessage = { type: 'bridgeStreamError', id, error };
  try {
    await panel.webview.postMessage(payload);
  } catch {
    // Ignore post failures from stale/disposed panels.
  }
}

async function postBridgeStreamEnd(
  panel: vscode.WebviewPanel,
  id: string,
): Promise<void> {
  const payload: BridgeStreamEndMessage = { type: 'bridgeStreamEnd', id };
  try {
    await panel.webview.postMessage(payload);
  } catch {
    // Ignore post failures from stale/disposed panels.
  }
}

function appendLog(message: string): void {
  const now = new Date().toISOString();
  outputChannel?.appendLine(`[${now}] ${message}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

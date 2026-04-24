'use client';

export interface ClaudeStudioVscodeBootstrap {
  readonly bridgeEnabled?: boolean;
  readonly openProjectPath?: string;
  readonly openWorkflowName?: string;
  readonly publicBaseUrl?: string;
  readonly nextBaseUrl?: string;
}

interface VscodePostMessageApi {
  postMessage: (message: unknown) => void;
}

let cachedVscodeApi: VscodePostMessageApi | null | undefined;

declare global {
  interface Window {
    __CLAUDE_STUDIO_VSCODE__?: ClaudeStudioVscodeBootstrap;
    acquireVsCodeApi?: () => VscodePostMessageApi;
  }

  interface WindowEventMap {
    message: MessageEvent<unknown>;
  }
}

export function getVscodeWebviewBootstrap(): ClaudeStudioVscodeBootstrap | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.__CLAUDE_STUDIO_VSCODE__ ?? null;
}

export function getVscodeApi(): VscodePostMessageApi | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (cachedVscodeApi !== undefined) {
    return cachedVscodeApi;
  }

  if (typeof window.acquireVsCodeApi !== 'function') {
    cachedVscodeApi = null;
    return cachedVscodeApi;
  }

  cachedVscodeApi = window.acquireVsCodeApi();
  return cachedVscodeApi;
}

export function getPublicAssetUrl(assetPath: string): string {
  const normalizedPath = assetPath.startsWith('/') ? assetPath.slice(1) : assetPath;
  const bootstrap = getVscodeWebviewBootstrap();
  const publicBaseUrl = bootstrap?.publicBaseUrl;

  if (!publicBaseUrl) {
    return assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  }

  return new URL(normalizedPath, ensureTrailingSlash(publicBaseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

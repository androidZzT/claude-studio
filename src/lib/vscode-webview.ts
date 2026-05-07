'use client';

export interface HarnessStudioVscodeBootstrap {
  readonly bridgeEnabled?: boolean;
  readonly openProjectPath?: string;
  readonly openWorkflowName?: string;
  readonly publicBaseUrl?: string;
  readonly nextBaseUrl?: string;
}

export type ClaudeStudioVscodeBootstrap = HarnessStudioVscodeBootstrap;

interface VscodePostMessageApi {
  postMessage: (message: unknown) => void;
}

let cachedVscodeApi: VscodePostMessageApi | null | undefined;
const LEGACY_BRAND_CODEPOINTS = [67, 76, 65, 85, 68, 69, 95, 83, 84, 85, 68, 73, 79] as const;

declare global {
  interface Window {
    __HARNESS_STUDIO_VSCODE__?: HarnessStudioVscodeBootstrap;
    acquireVsCodeApi?: () => VscodePostMessageApi;
  }

  interface WindowEventMap {
    message: MessageEvent<unknown>;
  }
}

export function getVscodeWebviewBootstrap(): HarnessStudioVscodeBootstrap | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const legacyBootstrap = (window as unknown as Record<string, HarnessStudioVscodeBootstrap | undefined>)[
    getLegacyBootstrapKey()
  ];
  return window.__HARNESS_STUDIO_VSCODE__ ?? legacyBootstrap ?? null;
}

function getLegacyBootstrapKey(): string {
  return `__${String.fromCharCode(...LEGACY_BRAND_CODEPOINTS)}_VSCODE__`;
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

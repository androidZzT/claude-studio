'use client';

import { getVscodeApi, getVscodeWebviewBootstrap } from './vscode-webview';

interface BridgeRequestPayload {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

interface BridgeRequestMessage {
  readonly source: 'harness-studio-app';
  readonly type: 'bridgeRequest';
  readonly id: string;
  readonly request: BridgeRequestPayload;
}

interface BridgeResponsePayload {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

interface BridgeResponseMessage {
  readonly source: 'harness-studio-webview';
  readonly type: 'bridge-response';
  readonly id: string;
  readonly response: BridgeResponsePayload;
}

interface BridgeStreamStartMessage {
  readonly source: 'harness-studio-app';
  readonly type: 'bridgeStreamStart';
  readonly id: string;
  readonly url: string;
}

interface BridgeStreamStopMessage {
  readonly source: 'harness-studio-app';
  readonly type: 'bridgeStreamStop';
  readonly id: string;
}

interface BridgeStreamEventMessage {
  readonly source: 'harness-studio-webview';
  readonly type: 'bridge-stream-event';
  readonly id: string;
  readonly data: string;
}

interface BridgeStreamErrorMessage {
  readonly source: 'harness-studio-webview';
  readonly type: 'bridge-stream-error';
  readonly id: string;
  readonly error?: string;
}

interface BridgeStreamEndMessage {
  readonly source: 'harness-studio-webview';
  readonly type: 'bridge-stream-end';
  readonly id: string;
}

interface BridgePickDirectoryMessage {
  readonly source: 'harness-studio-app';
  readonly type: 'bridgePickDirectory';
  readonly id: string;
}

interface BridgePickDirectoryResponseMessage {
  readonly source: 'harness-studio-webview';
  readonly type: 'bridge-pick-directory-response';
  readonly id: string;
  readonly path?: string;
  readonly error?: string;
}

interface PendingRequest {
  readonly resolve: (value: BridgeResponsePayload) => void;
  readonly reject: (error: Error) => void;
  readonly cleanupAbort: () => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingDirectoryPick {
  readonly resolve: (value: string | null) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

export interface ApiEventStream {
  close: () => void;
}

export interface ApiEventStreamHandlers {
  readonly onMessage: (data: string) => void;
  readonly onError?: (error?: string) => void;
  readonly onEnd?: () => void;
}

const BRIDGE_TIMEOUT_MS = 30_000;
const pendingRequests = new Map<string, PendingRequest>();
const pendingStreams = new Map<string, ApiEventStreamHandlers>();
const pendingDirectoryPicks = new Map<string, PendingDirectoryPick>();
let bridgeListenerInstalled = false;
let requestCounter = 0;
let streamCounter = 0;
let directoryPickCounter = 0;

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof window === 'undefined') {
    return fetch(input, init);
  }

  if (!isVscodeBridgeEnabled()) {
    return fetch(input, init);
  }

  const normalized = normalizeRequest(input, init);
  if (!normalized) {
    return fetch(input, init);
  }

  const bridgeUrl = toBridgeUrl(normalized.url);
  if (!bridgeUrl) {
    return fetch(input, init);
  }

  if (!isSupportedBody(normalized.body)) {
    return fetch(input, init);
  }

  ensureBridgeListener();

  const bridgeResponse = await sendBridgeRequest(
    {
      url: bridgeUrl,
      method: normalized.method,
      headers: normalized.headers,
      body: normalized.body,
    },
    normalized.signal,
  );

  return new Response(bridgeResponse.body ?? '', {
    status: bridgeResponse.status,
    headers: bridgeResponse.headers,
  });
}

export function createApiEventStream(url: string, handlers: ApiEventStreamHandlers): ApiEventStream {
  if (typeof window === 'undefined') {
    return { close: () => {} };
  }

  const bridgeUrl = toBridgeUrl(url);
  if (!isVscodeBridgeEnabled() || !bridgeUrl) {
    return createNativeEventStream(url, handlers);
  }

  ensureBridgeListener();

  const streamId = createStreamId();
  pendingStreams.set(streamId, handlers);

  const startMessage: BridgeStreamStartMessage = {
    source: 'harness-studio-app',
    type: 'bridgeStreamStart',
    id: streamId,
    url: bridgeUrl,
  };
  postBridgeMessage(startMessage);

  return {
    close: () => {
      const existed = pendingStreams.delete(streamId);
      if (!existed) {
        return;
      }
      const stopMessage: BridgeStreamStopMessage = {
        source: 'harness-studio-app',
        type: 'bridgeStreamStop',
        id: streamId,
      };
      postBridgeMessage(stopMessage);
    },
  };
}

export function isVscodeBridgeEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const bootstrap = getVscodeWebviewBootstrap();
  if (bootstrap?.bridgeEnabled) {
    return true;
  }

  if (window.parent !== window) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('vscodeBridge') === '1') {
      return true;
    }
  }

  return getVscodeApi() !== null;
}

export async function pickDirectoryViaVscodeBridge(): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!isVscodeBridgeEnabled()) {
    return null;
  }

  ensureBridgeListener();
  const id = createDirectoryPickId();

  return new Promise<string | null>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const pending = pendingDirectoryPicks.get(id);
      if (!pending) {
        return;
      }
      pendingDirectoryPicks.delete(id);
      reject(new Error('Directory pick request timed out'));
    }, BRIDGE_TIMEOUT_MS);

    pendingDirectoryPicks.set(id, { resolve, reject, timeoutId });

    const message: BridgePickDirectoryMessage = {
      source: 'harness-studio-app',
      type: 'bridgePickDirectory',
      id,
    };
    postBridgeMessage(message);
  });
}

function createNativeEventStream(url: string, handlers: ApiEventStreamHandlers): ApiEventStream {
  if (typeof EventSource === 'undefined') {
    queueMicrotask(() => {
      handlers.onError?.('EventSource is not available in this environment');
    });
    return { close: () => {} };
  }

  const es = new EventSource(url);
  es.onmessage = (event) => {
    handlers.onMessage(event.data);
  };
  es.onerror = () => {
    handlers.onError?.('EventSource error');
  };

  return {
    close: () => {
      es.close();
    },
  };
}

function normalizeRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: BodyInit | null;
  readonly signal?: AbortSignal | null;
} | null {
  if (input instanceof Request) {
    return null;
  }

  const url = typeof input === 'string' ? input : input.toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = headersToRecord(init?.headers);

  return {
    url,
    method,
    headers,
    body: init?.body,
    signal: init?.signal,
  };
}

function toBridgeUrl(requestUrl: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const resolved = new URL(requestUrl, window.location.href);
  const sameOrigin = resolved.origin === window.location.origin;
  if (!sameOrigin || !resolved.pathname.startsWith('/api/')) {
    return null;
  }

  return `${resolved.pathname}${resolved.search}`;
}

function isSupportedBody(body: BodyInit | null | undefined): body is string | undefined {
  if (body === undefined || body === null) {
    return true;
  }
  return typeof body === 'string';
}

function headersToRecord(headersInit: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(headersInit ?? {});
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function ensureBridgeListener(): void {
  if (bridgeListenerInstalled) {
    return;
  }

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data;

    if (isBridgeResponseMessage(data)) {
      const pending = pendingRequests.get(data.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      pending.cleanupAbort();
      pendingRequests.delete(data.id);
      pending.resolve(data.response);
      return;
    }

    if (isBridgeStreamEventMessage(data)) {
      pendingStreams.get(data.id)?.onMessage(data.data);
      return;
    }

    if (isBridgeStreamErrorMessage(data)) {
      const streamHandlers = pendingStreams.get(data.id);
      if (!streamHandlers) {
        return;
      }
      pendingStreams.delete(data.id);
      streamHandlers.onError?.(data.error ?? 'Bridge stream error');
      return;
    }

    if (isBridgeStreamEndMessage(data)) {
      const streamHandlers = pendingStreams.get(data.id);
      if (!streamHandlers) {
        return;
      }
      pendingStreams.delete(data.id);
      streamHandlers.onEnd?.();
      return;
    }

    if (isBridgePickDirectoryResponseMessage(data)) {
      const pending = pendingDirectoryPicks.get(data.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeoutId);
      pendingDirectoryPicks.delete(data.id);
      if (typeof data.path === 'string' && data.path.trim() !== '') {
        pending.resolve(data.path);
        return;
      }
      if (typeof data.error === 'string' && data.error.length > 0) {
        pending.reject(new Error(data.error));
        return;
      }
      pending.resolve(null);
    }
  });

  bridgeListenerInstalled = true;
}

async function sendBridgeRequest(
  request: BridgeRequestPayload,
  signal?: AbortSignal | null,
): Promise<BridgeResponsePayload> {
  const id = createRequestId();

  return new Promise<BridgeResponsePayload>((resolve, reject) => {
    const onAbort = () => {
      const pending = pendingRequests.get(id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeoutId);
      pending.cleanupAbort();
      pendingRequests.delete(id);
      reject(new Error('Bridge request aborted'));
    };

    if (signal?.aborted) {
      reject(new Error('Bridge request aborted'));
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    const timeoutId = setTimeout(() => {
      const pending = pendingRequests.get(id);
      if (!pending) {
        return;
      }
      pending.cleanupAbort();
      pendingRequests.delete(id);
      reject(new Error('Bridge request timed out'));
    }, BRIDGE_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve,
      reject,
      timeoutId,
      cleanupAbort: () => {
        signal?.removeEventListener('abort', onAbort);
      },
    });

    const message: BridgeRequestMessage = {
      source: 'harness-studio-app',
      type: 'bridgeRequest',
      id,
      request,
    };

    postBridgeMessage(message);
  });
}

function postBridgeMessage(message: unknown): void {
  const vscode = getVscodeApi();
  if (vscode) {
    vscode.postMessage(message);
    return;
  }

  if (window.parent !== window) {
    window.parent.postMessage(message, '*');
    return;
  }

  throw new Error('VS Code bridge is not available');
}

function createRequestId(): string {
  requestCounter += 1;
  return `bridge-req-${Date.now()}-${requestCounter}`;
}

function createStreamId(): string {
  streamCounter += 1;
  return `bridge-stream-${Date.now()}-${streamCounter}`;
}

function createDirectoryPickId(): string {
  directoryPickCounter += 1;
  return `bridge-pick-${Date.now()}-${directoryPickCounter}`;
}

function isBridgeResponseMessage(value: unknown): value is BridgeResponseMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<BridgeResponseMessage>;
  const legacyMessage = value as {
    readonly type?: unknown;
    readonly id?: unknown;
    readonly response?: Partial<BridgeResponsePayload>;
  };
  return (
    (
      isBridgeWebviewSource(message.source) &&
      message.type === 'bridge-response' &&
      typeof message.id === 'string' &&
      !!message.response &&
      typeof message.response === 'object' &&
      typeof (message.response as Partial<BridgeResponsePayload>).status === 'number'
    ) || (
      legacyMessage.type === 'bridgeResponse' &&
      typeof legacyMessage.id === 'string' &&
      !!legacyMessage.response &&
      typeof legacyMessage.response === 'object' &&
      typeof legacyMessage.response.status === 'number'
    )
  );
}

function isBridgeStreamEventMessage(value: unknown): value is BridgeStreamEventMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<BridgeStreamEventMessage>;
  const legacyMessage = value as {
    readonly type?: unknown;
    readonly id?: unknown;
    readonly data?: unknown;
  };
  return (
    (
      isBridgeWebviewSource(message.source) &&
      message.type === 'bridge-stream-event' &&
      typeof message.id === 'string' &&
      typeof message.data === 'string'
    ) || (
      legacyMessage.type === 'bridgeStreamEvent' &&
      typeof legacyMessage.id === 'string' &&
      typeof legacyMessage.data === 'string'
    )
  );
}

function isBridgeStreamErrorMessage(value: unknown): value is BridgeStreamErrorMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<BridgeStreamErrorMessage>;
  const legacyMessage = value as {
    readonly type?: unknown;
    readonly id?: unknown;
  };
  return (
    (
      isBridgeWebviewSource(message.source) &&
      message.type === 'bridge-stream-error' &&
      typeof message.id === 'string'
    ) || (
      legacyMessage.type === 'bridgeStreamError' &&
      typeof legacyMessage.id === 'string'
    )
  );
}

function isBridgeStreamEndMessage(value: unknown): value is BridgeStreamEndMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<BridgeStreamEndMessage>;
  const legacyMessage = value as {
    readonly type?: unknown;
    readonly id?: unknown;
  };
  return (
    (
      isBridgeWebviewSource(message.source) &&
      message.type === 'bridge-stream-end' &&
      typeof message.id === 'string'
    ) || (
      legacyMessage.type === 'bridgeStreamEnd' &&
      typeof legacyMessage.id === 'string'
    )
  );
}

function isBridgePickDirectoryResponseMessage(value: unknown): value is BridgePickDirectoryResponseMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<BridgePickDirectoryResponseMessage>;
  const legacyMessage = value as {
    readonly type?: unknown;
    readonly id?: unknown;
    readonly path?: unknown;
    readonly error?: unknown;
  };
  return (
    (
      isBridgeWebviewSource(message.source) &&
      message.type === 'bridge-pick-directory-response' &&
      typeof message.id === 'string' &&
      (message.path === undefined || typeof message.path === 'string') &&
      (message.error === undefined || typeof message.error === 'string')
    ) || (
      legacyMessage.type === 'bridgePickDirectoryResponse' &&
      typeof legacyMessage.id === 'string' &&
      (legacyMessage.path === undefined || typeof legacyMessage.path === 'string') &&
      (legacyMessage.error === undefined || typeof legacyMessage.error === 'string')
    )
  );
}

function isBridgeWebviewSource(source: unknown): source is 'harness-studio-webview' {
  return source === 'harness-studio-webview';
}

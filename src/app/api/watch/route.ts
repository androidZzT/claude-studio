import { NextResponse } from 'next/server';
import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { getClaudeHome } from '@studio-core/claude-home';
import { getSettingsPath } from '@studio-core/resource-paths';
import type { ResourceType } from '@/types/resources';

// Prevent unhandled errors from crashing the process
if (typeof process !== 'undefined' && !(process as NodeJS.Process & { __claudeStudioGuarded?: boolean }).__claudeStudioGuarded) {
  (process as NodeJS.Process & { __claudeStudioGuarded?: boolean }).__claudeStudioGuarded = true;
  process.on('uncaughtException', (err) => {
    console.error('[harness-studio] uncaughtException (kept alive):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[harness-studio] unhandledRejection (kept alive):', reason);
  });
}

const WATCHED_DIRS = ['agents', 'workflows', 'skills', 'rules'] as const;

function detectResourceType(filePath: string, claudeHome: string): ResourceType | null {
  const relative = path.relative(claudeHome, filePath);
  const firstDir = relative.split(path.sep)[0];

  const mapping: Record<string, ResourceType> = {
    agents: 'agents',
    workflows: 'workflows',
    skills: 'skills',
    rules: 'rules',
  };

  if (mapping[firstDir]) return mapping[firstDir];
  if (path.basename(filePath) === 'settings.json') return 'mcps';
  return null;
}

// ---- Singleton watcher shared across all SSE connections ----
type Listener = (event: string, filePath: string) => void;

let singletonWatcher: FSWatcher | null = null;
const listeners = new Set<Listener>();

function getOrCreateWatcher(): FSWatcher {
  if (singletonWatcher) return singletonWatcher;

  const claudeHome = getClaudeHome();
  const watchPaths = [
    ...WATCHED_DIRS.map((dir) => path.join(claudeHome, dir)),
    getSettingsPath(),
  ];

  const w = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    depth: 3,
  });

  w.on('error', (err) => {
    console.error('[harness-studio] chokidar error:', err);
  });

  w.on('all', (event: string, filePath: string) => {
    for (const listener of listeners) {
      try {
        listener(event, filePath);
      } catch {
        // Swallow per-listener errors
      }
    }
  });

  singletonWatcher = w;
  return w;
}

function subscribe(listener: Listener): () => void {
  // Ensure the singleton watcher exists
  getOrCreateWatcher();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---- SSE endpoint ----

export async function GET(): Promise<Response> {
  const claudeHome = getClaudeHome();

  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      unsubscribe = subscribe((event, filePath) => {
        const eventType = event === 'add' ? 'add' : event === 'change' ? 'change' : event === 'unlink' ? 'unlink' : null;
        if (!eventType) return;

        const resourceType = detectResourceType(filePath, claudeHome);
        if (!resourceType) return;

        send({
          type: eventType,
          path: filePath,
          resourceType,
        });
      });

      send({ type: 'connected', path: claudeHome });

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          cleanup();
        }
      }, 30_000);
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Workflow } from '@/types/resources';
import { apiFetch, createApiEventStream, type ApiEventStream } from './api-client';
import type { ExecutionState, ExecutionEvent, NodeExecutionStatus } from './execution-engine';

export type { ExecutionState, NodeExecutionStatus };

interface UseExecutionResult {
  readonly executing: boolean;
  readonly executionState: ExecutionState | null;
  readonly startExecution: (workflow: Workflow, projectPath?: string, simulate?: boolean) => Promise<void>;
  readonly approveCheckpoint: (nodeId: string) => Promise<void>;
  readonly cancelExecution: () => Promise<void>;
  readonly getNodeExecutionStatus: (nodeId: string) => NodeExecutionStatus | null;
  readonly logs: readonly string[];
}

interface SSEInitEvent {
  readonly type: 'init';
  readonly state: ExecutionState;
}

interface SSEFinalEvent {
  readonly type: 'final';
  readonly state: ExecutionState;
}

type SSEMessage = SSEInitEvent | SSEFinalEvent | ExecutionEvent;

export function useExecution(): UseExecutionResult {
  const [executing, setExecuting] = useState(false);
  const [executionState, setExecutionState] = useState<ExecutionState | null>(null);
  const [logs, setLogs] = useState<readonly string[]>([]);
  const executionIdRef = useRef<string | null>(null);
  const eventStreamRef = useRef<ApiEventStream | null>(null);

  // Cleanup SSE connection
  const closeStream = useCallback(() => {
    if (eventStreamRef.current) {
      eventStreamRef.current.close();
      eventStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return closeStream;
  }, [closeStream]);

  const connectToStream = useCallback((executionId: string) => {
    closeStream();

    const handleStreamError = () => {
      // On error, try to get final state
      apiFetch(`/api/execute/${executionId}`)
        .then((res) => res.json())
        .then((json: { success: boolean; data?: ExecutionState }) => {
          if (json.success && json.data) {
            setExecutionState(json.data);
            const status = json.data.status;
            if (['completed', 'failed', 'cancelled'].includes(status)) {
              setExecuting(false);
            }
          }
        })
        .catch(() => {
          // Give up
          setExecuting(false);
        });
      closeStream();
    };

    const stream = createApiEventStream(`/api/execute/${executionId}/stream`, {
      onMessage: (raw) => {
        try {
          const data = JSON.parse(raw) as SSEMessage;

          if (data.type === 'init' || data.type === 'final') {
            setExecutionState(data.state);

            if (data.type === 'final') {
              setExecuting(false);
              closeStream();
            }
            return;
          }

          // ExecutionEvent — apply incremental state updates from SSE events directly
          const execEvent = data as ExecutionEvent;

          if (execEvent.message) {
            const MAX_LOG_ENTRIES = 500;
            setLogs((prev) => {
              const next = [...prev, `[${execEvent.timestamp}] ${execEvent.message}`];
              return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
            });
          }

          if (execEvent.type === 'node-status' && execEvent.nodeId && execEvent.nodeStatus) {
            setExecutionState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                nodes: prev.nodes.map((n) =>
                  n.nodeId === execEvent.nodeId
                    ? { ...n, status: execEvent.nodeStatus! }
                    : n
                ),
              };
            });
          }

          // Streaming output from live execution — append to node output
          if (execEvent.type === 'node-output' && execEvent.nodeId && execEvent.output) {
            setExecutionState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                nodes: prev.nodes.map((n) =>
                  n.nodeId === execEvent.nodeId
                    ? { ...n, output: (n.output ?? '') + execEvent.output }
                    : n
                ),
              };
            });
          }

          if (execEvent.type === 'level-start' && execEvent.level !== undefined) {
            setExecutionState((prev) => {
              if (!prev) return prev;
              return { ...prev, currentLevel: execEvent.level! };
            });
          }

          if (execEvent.type === 'execution-status' && execEvent.overallStatus) {
            setExecutionState((prev) => {
              if (!prev) return prev;
              return { ...prev, status: execEvent.overallStatus! };
            });
          }

          if (
            execEvent.type === 'execution-status' &&
            (execEvent.overallStatus === 'completed' ||
              execEvent.overallStatus === 'failed' ||
              execEvent.overallStatus === 'cancelled')
          ) {
            setExecuting(false);
            closeStream();
          }
        } catch {
          // Ignore parse errors
        }
      },
      onError: handleStreamError,
      onEnd: () => {
        // Stream ended: allow final event path to settle state.
      },
    });

    eventStreamRef.current = stream;
  }, [closeStream]);

  const startExecution = useCallback(async (workflow: Workflow, projectPath?: string, simulate = true) => {
    setLogs([]);
    setExecuting(true);
    setExecutionState(null);

    try {
      const res = await apiFetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow: {
            name: workflow.name,
            nodes: workflow.nodes.map((n) => ({
              id: n.id,
              agent: n.agent,
              task: n.task,
              checkpoint: n.checkpoint,
              depends_on: n.depends_on,
              roundtrip: n.roundtrip,
              skills: n.skills,
            })),
          },
          projectPath,
          simulate,
        }),
      });

      const json = await res.json() as { success: boolean; data?: { executionId: string }; error?: string };

      if (!json.success || !json.data) {
        setExecuting(false);
        setLogs((prev) => [...prev, `Error: ${json.error ?? 'Unknown error starting execution'}`]);
        return;
      }

      executionIdRef.current = json.data.executionId;
      connectToStream(json.data.executionId);
    } catch (err) {
      setExecuting(false);
      const message = err instanceof Error ? err.message : 'Failed to start execution';
      setLogs((prev) => [...prev, `Error: ${message}`]);
    }
  }, [connectToStream]);

  const approveCheckpoint = useCallback(async (nodeId: string) => {
    const execId = executionIdRef.current;
    if (!execId) return;

    try {
      await apiFetch(`/api/execute/${execId}/checkpoint/${nodeId}`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to approve checkpoint:', error);
    }
  }, []);

  const cancelExecution = useCallback(async () => {
    const execId = executionIdRef.current;
    if (!execId) return;

    try {
      await apiFetch(`/api/execute/${execId}/cancel`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to cancel execution:', error);
    }
  }, []);

  const getNodeExecutionStatus = useCallback(
    (nodeId: string): NodeExecutionStatus | null => {
      if (!executionState) return null;
      const node = executionState.nodes.find((n) => n.nodeId === nodeId);
      return node?.status ?? null;
    },
    [executionState]
  );

  return {
    executing,
    executionState,
    startExecution,
    approveCheckpoint,
    cancelExecution,
    getNodeExecutionStatus,
    logs,
  };
}

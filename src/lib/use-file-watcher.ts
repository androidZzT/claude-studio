'use client';

import { useEffect, useRef, useState } from 'react';
import type { FileChangeEvent } from '@/types/resources';
import { createApiEventStream, type ApiEventStream } from './api-client';

export function useFileWatcher(onEvent: (event: FileChangeEvent) => void) {
  const [connected, setConnected] = useState(false);
  const streamRef = useRef<ApiEventStream | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const closeCurrentStream = () => {
      if (!streamRef.current) {
        return;
      }
      streamRef.current.close();
      streamRef.current = null;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimerRef.current) {
        return;
      }
      const delayMs = Math.min(1000 * (2 ** reconnectAttemptRef.current), 15000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delayMs);
    };

    const handleDisconnect = () => {
      if (disposed) {
        return;
      }
      setConnected(false);
      closeCurrentStream();
      scheduleReconnect();
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      closeCurrentStream();
      const stream = createApiEventStream('/api/watch', {
        onMessage: (data) => {
          setConnected(true);
          reconnectAttemptRef.current = 0;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'connected') {
              return;
            }
            onEventRef.current(parsed as FileChangeEvent);
          } catch {
            // ignore parse errors
          }
        },
        onError: () => {
          handleDisconnect();
        },
        onEnd: () => {
          handleDisconnect();
        },
      });

      streamRef.current = stream;
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      closeCurrentStream();
      setConnected(false);
    };
  }, []);

  return { connected } as const;
}

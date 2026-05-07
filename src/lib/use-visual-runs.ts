'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api-client';
import type { ApiResponse } from '@/types/resources';
import type { VisualWorkflowRun, VisualWorkflowRunSummary } from '@/types/visual-workflow';

interface UseVisualRunsResult {
  readonly summaries: readonly VisualWorkflowRunSummary[];
  readonly selectedRunId: string | null;
  readonly selectedRun: VisualWorkflowRun | null;
  readonly loading: boolean;
  readonly runLoading: boolean;
  readonly error: string | null;
  readonly selectRun: (runId: string) => void;
  readonly clearSelection: () => void;
  readonly refetch: () => void;
}

export function useVisualRuns(projectId: string | null, enabled: boolean): UseVisualRunsResult {
  const [summaries, setSummaries] = useState<readonly VisualWorkflowRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<VisualWorkflowRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [autoSelect, setAutoSelect] = useState(true);

  useEffect(() => {
    setSummaries([]);
    setSelectedRunId(null);
    setSelectedRun(null);
    setError(null);
    setAutoSelect(true);
  }, [projectId]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/visual-runs`);
        const json = await res.json() as ApiResponse<readonly VisualWorkflowRunSummary[]>;
        if (cancelled) return;
        if (!json.success) {
          setError(json.error ?? 'Failed to load runs');
          setSummaries([]);
          return;
        }
        const nextSummaries = json.data ?? [];
        setSummaries(nextSummaries);
        setSelectedRunId((current) => {
          if (current && nextSummaries.some((run) => run.runId === current)) return current;
          return autoSelect ? nextSummaries[0]?.runId ?? null : null;
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load runs');
        setSummaries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, enabled, refreshToken, autoSelect]);

  useEffect(() => {
    if (!enabled || !projectId || !selectedRunId) {
      setSelectedRun(null);
      return;
    }
    let cancelled = false;
    setRunLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/visual-runs/${encodeURIComponent(selectedRunId)}`,
        );
        const json = await res.json() as ApiResponse<VisualWorkflowRun>;
        if (cancelled) return;
        if (!json.success || !json.data) {
          setError(json.error ?? 'Failed to load run');
          setSelectedRun(null);
          return;
        }
        setSelectedRun(json.data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load run');
        setSelectedRun(null);
      } finally {
        if (!cancelled) setRunLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, enabled, selectedRunId]);

  const selectRun = useCallback((runId: string) => {
    setAutoSelect(false);
    setSelectedRunId(runId);
  }, []);

  const clearSelection = useCallback(() => {
    setAutoSelect(false);
    setSelectedRunId(null);
    setSelectedRun(null);
  }, []);

  const refetch = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  return useMemo(() => ({
    summaries,
    selectedRunId,
    selectedRun,
    loading,
    runLoading,
    error,
    selectRun,
    clearSelection,
    refetch,
  }), [summaries, selectedRunId, selectedRun, loading, runLoading, error, selectRun, clearSelection, refetch]);
}

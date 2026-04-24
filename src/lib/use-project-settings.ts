'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SettingsData } from '@/types/settings';
import { parseSettingsData } from '@/types/settings';
import { apiFetch } from './api-client';

interface ProjectSettingsResult {
  readonly shared: SettingsData | null;
  readonly local: SettingsData | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly saveShared: (data: SettingsData) => Promise<boolean>;
  readonly saveLocal: (data: SettingsData) => Promise<boolean>;
  readonly saving: boolean;
  readonly refetch: () => void;
}

export function useProjectSettings(projectPath: string | undefined): ProjectSettingsResult {
  const [shared, setShared] = useState<SettingsData | null>(null);
  const [local, setLocal] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!projectPath) {
      setShared(null);
      setLocal(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/settings?scope=project&projectPath=${encodeURIComponent(projectPath)}`
      );
      const json = await res.json() as {
        success: boolean;
        data?: { shared: Record<string, unknown>; local: Record<string, unknown> };
        error?: string;
      };
      if (json.success && json.data) {
        setShared(parseSettingsData(json.data.shared));
        setLocal(parseSettingsData(json.data.local));
      } else {
        setError(json.error ?? 'Failed to load project settings');
      }
    } catch {
      setError('Failed to connect to settings API');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveShared = useCallback(async (data: SettingsData): Promise<boolean> => {
    if (!projectPath) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/settings?scope=project-shared&projectPath=${encodeURIComponent(projectPath)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      const json = await res.json() as {
        success: boolean;
        data?: { shared: Record<string, unknown>; local: Record<string, unknown> };
        error?: string;
      };
      if (json.success && json.data) {
        setShared(parseSettingsData(json.data.shared));
        setLocal(parseSettingsData(json.data.local));
        return true;
      }
      setError(json.error ?? 'Failed to save shared settings');
      return false;
    } catch {
      setError('Failed to save shared settings');
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectPath]);

  const saveLocal = useCallback(async (data: SettingsData): Promise<boolean> => {
    if (!projectPath) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/settings?scope=project-local&projectPath=${encodeURIComponent(projectPath)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      const json = await res.json() as {
        success: boolean;
        data?: { shared: Record<string, unknown>; local: Record<string, unknown> };
        error?: string;
      };
      if (json.success && json.data) {
        setShared(parseSettingsData(json.data.shared));
        setLocal(parseSettingsData(json.data.local));
        return true;
      }
      setError(json.error ?? 'Failed to save local settings');
      return false;
    } catch {
      setError('Failed to save local settings');
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectPath]);

  return { shared, local, loading, error, saveShared, saveLocal, saving, refetch: fetchSettings };
}

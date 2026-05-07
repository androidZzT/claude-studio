'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SettingsData } from '@/types/settings';
import { parseSettingsData } from '@/types/settings';
import { apiFetch } from './api-client';

interface UseSettingsResult {
  readonly settings: SettingsData | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
  readonly save: (data: SettingsData) => Promise<boolean>;
  readonly saving: boolean;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        setSettings(parseSettingsData(json.data as Record<string, unknown>));
      } else {
        setError(json.error ?? 'Failed to load settings');
      }
    } catch {
      setError('Failed to connect to settings API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const save = useCallback(async (data: SettingsData): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.success) {
        setSettings(parseSettingsData(json.data as Record<string, unknown>));
        return true;
      }
      setError(json.error ?? 'Failed to save settings');
      return false;
    } catch {
      setError('Failed to save settings');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, loading, error, refetch: fetchSettings, save, saving };
}

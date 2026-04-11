'use client';

import { useState, useCallback, useEffect } from 'react';

export interface StudioSettings {
  readonly language: 'en' | 'zh';
  readonly theme: 'claude-dark' | 'system';
  readonly editorFontSize: number;
  readonly showCanvasGrid: boolean;
  readonly showMinimap: boolean;
  readonly autoSave: boolean;
  readonly defaultModel: 'opus' | 'sonnet' | 'haiku';
  readonly confirmBeforeDelete: boolean;
  readonly animationSpeed: 'fast' | 'normal' | 'slow';
}

const STORAGE_KEY = 'claude-studio-settings';

const DEFAULT_SETTINGS: StudioSettings = {
  language: 'en',
  theme: 'claude-dark',
  editorFontSize: 12,
  showCanvasGrid: true,
  showMinimap: true,
  autoSave: false,
  defaultModel: 'sonnet',
  confirmBeforeDelete: true,
  animationSpeed: 'normal',
};

function loadSettings(): StudioSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: StudioSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage full or unavailable
  }
}

interface UseStudioSettingsResult {
  readonly settings: StudioSettings;
  readonly updateSetting: <K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) => void;
  readonly resetSettings: () => void;
}

export function useStudioSettings(): UseStudioSettingsResult {
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const updateSetting = useCallback(<K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      persistSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    persistSettings(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, updateSetting, resetSettings };
}

'use client';

import { useState, useCallback, useEffect } from 'react';

export type ThemeOption = 'claude-dark' | 'claude-light' | 'system';

export interface StudioSettings {
  readonly language: 'en' | 'zh';
  readonly theme: ThemeOption;
  readonly editorFontSize: number;
  readonly showCanvasGrid: boolean;
  readonly showMinimap: boolean;
  readonly autoSave: boolean;
  readonly defaultModel: 'opus' | 'sonnet' | 'haiku';
  readonly confirmBeforeDelete: boolean;
  readonly animationSpeed: 'fast' | 'normal' | 'slow';
}

const STORAGE_KEY = 'harness-studio-settings';

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

function resolveTheme(theme: ThemeOption): 'claude-dark' | 'claude-light' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'claude-dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'claude-light'
    : 'claude-dark';
}

function applyTheme(theme: ThemeOption): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

interface UseStudioSettingsResult {
  readonly settings: StudioSettings;
  readonly updateSetting: <K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) => void;
  readonly resetSettings: () => void;
}

export function useStudioSettings(): UseStudioSettingsResult {
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    applyTheme(loaded.theme);
  }, []);

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.theme]);

  const updateSetting = useCallback(<K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      persistSettings(next);
      if (key === 'theme') {
        applyTheme(value as ThemeOption);
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    persistSettings(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
    applyTheme(DEFAULT_SETTINGS.theme);
  }, []);

  return { settings, updateSetting, resetSettings };
}

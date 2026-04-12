'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Project } from '@/types/resources';

const STORAGE_KEY = 'claude-studio:activeProjectId';
const RECENT_KEY = 'claude-studio:recentProjects';
const MAX_RECENT = 10;

export interface RecentProject {
  readonly path: string;
  readonly name: string;
  readonly openedAt: number;
}

// --- Recent projects (localStorage) ---

export function loadRecentProjects(): readonly RecentProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as readonly RecentProject[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentProject(projectPath: string, name: string): readonly RecentProject[] {
  const existing = loadRecentProjects().filter((p) => p.path !== projectPath);
  const updated: readonly RecentProject[] = [
    { path: projectPath, name, openedAt: Date.now() },
    ...existing,
  ].slice(0, MAX_RECENT);
  if (typeof window !== 'undefined') {
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  }
  return updated;
}

export function removeRecentProject(projectPath: string): readonly RecentProject[] {
  const updated = loadRecentProjects().filter((p) => p.path !== projectPath);
  if (typeof window !== 'undefined') {
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  }
  return updated;
}

// --- Active project ID (localStorage) ---

export function loadStoredProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function storeProjectId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id) {
    localStorage.setItem(STORAGE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// --- Open project hook ---

export interface OpenProjectResult {
  readonly project: Project | null;
  readonly error: string | null;
  readonly loading: boolean;
}

export function useProjectOpen() {
  const [result, setResult] = useState<OpenProjectResult>({
    project: null,
    error: null,
    loading: false,
  });

  const openProject = useCallback(async (projectPath: string): Promise<Project | null> => {
    setResult({ project: null, error: null, loading: true });
    try {
      const res = await fetch('/api/projects/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      });
      const json = await res.json() as { success: boolean; data?: Project; error?: string };
      if (json.success && json.data) {
        setResult({ project: json.data, error: null, loading: false });
        return json.data;
      }
      setResult({ project: null, error: json.error ?? 'Failed to open project', loading: false });
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setResult({ project: null, error: msg, loading: false });
      return null;
    }
  }, []);

  const closeProject = useCallback(() => {
    setResult({ project: null, error: null, loading: false });
  }, []);

  const projectPathRef = useRef<string | null>(null);
  useEffect(() => {
    projectPathRef.current = result.project?.path ?? null;
  }, [result.project]);

  const refetch = useCallback(async () => {
    const currentPath = projectPathRef.current;
    if (currentPath) {
      await openProject(currentPath);
    }
  }, [openProject]);

  return { ...result, openProject, closeProject, refetch } as const;
}

// --- Browse directories hook ---

export function useBrowseDirectories() {
  const [entries, setEntries] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (prefix: string) => {
    if (prefix.length < 2) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/browse?prefix=${encodeURIComponent(prefix)}`);
      const json = await res.json() as { success: boolean; data?: { entries: readonly string[] } };
      if (json.success && json.data) {
        setEntries(json.data.entries);
      } else {
        setEntries([]);
      }
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, loading, browse, clear } as const;
}

// --- Create project hook ---

export interface CreateProjectParams {
  readonly name: string;
  readonly parentDir: string;
  readonly template: string;
}

export function useCreateProject() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = useCallback(async (params: CreateProjectParams): Promise<Project | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const json = await res.json() as { success: boolean; data?: Project; error?: string };
      if (json.success && json.data) {
        setLoading(false);
        return json.data;
      }
      setError(json.error ?? 'Failed to create project');
      setLoading(false);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setError(msg);
      setLoading(false);
      return null;
    }
  }, []);

  return { createProject, loading, error } as const;
}

// --- Project detail (by ID) ---

export function useProjectDetail(projectId: string | null) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      const json = await res.json() as { success: boolean; data?: Project; error?: string };
      if (json.success) {
        setProject(json.data ?? null);
      } else {
        setError(json.error ?? 'Failed to fetch project');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
    } else {
      setProject(null);
    }
  }, [projectId, fetchProject]);

  const refetch = useCallback(() => {
    if (projectId) {
      fetchProject(projectId);
    }
  }, [projectId, fetchProject]);

  return { project, loading, error, refetch } as const;
}

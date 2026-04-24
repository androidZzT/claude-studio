'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Resource, ResourceType } from '@/types/resources';
import { apiFetch } from './api-client';

export function useResources() {
  const [resources, setResources] = useState<readonly Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResources = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/api/resources');
      const json = await res.json();
      if (json.success) {
        setResources(json.data);
      } else {
        setError(json.error ?? 'Failed to fetch resources');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  return { resources, loading, error, refetch: fetchResources } as const;
}

export function groupByType(resources: readonly Resource[]): Record<ResourceType, readonly Resource[]> {
  const groups: Record<ResourceType, Resource[]> = {
    agents: [],
    workflows: [],
    skills: [],
    rules: [],
    mcps: [],
    hooks: [],
    memories: [],
  };

  for (const r of resources) {
    groups[r.type].push(r);
  }

  return groups;
}

'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

interface CommunityLink {
  readonly name: string;
  readonly url: string;
  readonly stars?: number;
}

interface UseCommunityLinksResult {
  readonly links: readonly CommunityLink[];
  readonly loading: boolean;
}

export function useCommunityLinks(): UseCommunityLinksResult {
  const [links, setLinks] = useState<readonly CommunityLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchLinks() {
      try {
        const res = await apiFetch('/api/community');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: CommunityLink[] = await res.json();
        if (!cancelled) {
          setLinks(data);
        }
      } catch {
        // On error, links stay empty — component shows fallback
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchLinks();
    return () => { cancelled = true; };
  }, []);

  return { links, loading };
}

import { NextResponse } from 'next/server';

interface CommunityRepo {
  readonly name: string;
  readonly owner: string;
  readonly repo: string;
  readonly fallbackStars: number;
}

interface CommunityLink {
  readonly name: string;
  readonly url: string;
  readonly stars?: number;
  readonly description?: string;
}

const COMMUNITY_REPOS: readonly CommunityRepo[] = [
  { name: 'Harness-Studio', owner: 'androidZzT', repo: 'harness-studio', fallbackStars: 0 },
  { name: 'Awesome Claude Code', owner: 'hesreallyhim', repo: 'awesome-claude-code', fallbackStars: 37000 },
  { name: 'Agent Templates', owner: 'VoltAgent', repo: 'awesome-claude-code-subagents', fallbackStars: 17000 },
  { name: 'Skills Collection', owner: 'alirezarezvani', repo: 'claude-skills', fallbackStars: 10000 },
  { name: 'Official Plugins', owner: 'anthropics', repo: 'claude-plugins-official', fallbackStars: 16000 },
];

const NON_GITHUB_LINKS: readonly CommunityLink[] = [
  { name: 'Plugin Docs', url: 'https://code.claude.com/docs/en/plugins-reference' },
  { name: 'Agent Teams Docs', url: 'https://code.claude.com/docs/en/agent-teams' },
];

// In-memory cache
let cache: { data: readonly CommunityLink[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchRepoStars(owner: string, repo: string, fallbackStars: number): Promise<number> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallbackStars;
    const data = await res.json();
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : fallbackStars;
  } catch {
    return fallbackStars;
  }
}

async function fetchCommunityLinks(): Promise<readonly CommunityLink[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }

  const repoLinks: CommunityLink[] = await Promise.all(
    COMMUNITY_REPOS.map(async ({ name, owner, repo, fallbackStars }) => ({
      name,
      url: `https://github.com/${owner}/${repo}`,
      stars: await fetchRepoStars(owner, repo, fallbackStars),
    })),
  );

  const data = [...repoLinks, ...NON_GITHUB_LINKS];
  cache = { data, fetchedAt: now };
  return data;
}

export async function GET() {
  const links = await fetchCommunityLinks();
  return NextResponse.json(links);
}

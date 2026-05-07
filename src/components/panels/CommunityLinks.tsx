'use client';

import { Globe, ExternalLink, Star } from 'lucide-react';
import { useCommunityLinks } from '@/lib/use-community';

function formatStars(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

const FALLBACK_LINKS: readonly { readonly name: string; readonly url: string; readonly stars?: string }[] = [
  { name: 'Harness-Studio', url: 'https://github.com/androidZzT/harness-studio' },
  { name: 'Awesome Claude Code', url: 'https://github.com/hesreallyhim/awesome-claude-code', stars: '37K' },
  { name: 'Agent Templates', url: 'https://github.com/VoltAgent/awesome-claude-code-subagents', stars: '17K' },
  { name: 'Skills Collection', url: 'https://github.com/alirezarezvani/claude-skills', stars: '10K' },
  { name: 'Official Plugins', url: 'https://github.com/anthropics/claude-plugins-official', stars: '16K' },
  { name: 'Plugin Docs', url: 'https://code.claude.com/docs/en/plugins-reference' },
  { name: 'Agent Teams Docs', url: 'https://code.claude.com/docs/en/agent-teams' },
];

export function CommunityLinks() {
  const { links, loading } = useCommunityLinks();

  const displayLinks = links.length > 0
    ? links.map((link) => ({
        name: link.name,
        url: link.url,
        stars: link.stars != null ? formatStars(link.stars) : undefined,
      }))
    : FALLBACK_LINKS;

  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Globe size={11} className="text-muted" />
        <span className="text-[10px] font-semibold tracking-wide text-foreground/60">
          Ecosystem
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 px-1">
        {displayLinks.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] text-muted/70 transition-colors hover:bg-surface-hover hover:text-foreground/80"
            >
              <ExternalLink size={9} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="truncate">{link.name}</span>
              {link.stars != null ? (
                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[9px] text-muted/50">
                  <Star size={8} />
                  {link.stars}
                </span>
              ) : loading ? (
                <span className="ml-auto h-2.5 w-6 animate-pulse rounded bg-muted/20" />
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

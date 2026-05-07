'use client';

import { useState } from 'react';
import Image from 'next/image';
import { FolderOpen, Sparkles, Clock, ExternalLink } from 'lucide-react';
import type { RecentProject } from '@/lib/use-projects';
import { getPublicAssetUrl } from '@/lib/vscode-webview';

interface WelcomeScreenProps {
  readonly recentProjects: readonly RecentProject[];
  readonly onOpenProject: () => void;
  readonly onNewProject: () => void;
  readonly onSelectRecent: (path: string) => void;
}

export function WelcomeScreen({
  recentProjects,
  onOpenProject,
  onNewProject,
  onSelectRecent,
}: WelcomeScreenProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex w-full max-w-lg flex-col items-center px-6">
        {/* Clawd Mascot */}
        <div
          className="mb-2"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <Image
            src={isHovered ? getPublicAssetUrl('/clawd-happy.png') : getPublicAssetUrl('/clawd-idle.png')}
            alt="Clawd mascot"
            width={72}
            height={72}
            className="select-none"
            style={{
              imageRendering: 'pixelated',
            }}
            priority
            unoptimized
          />
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-accent">
          Harness-Studio
        </h1>
        <p className="mb-10 text-center text-sm leading-relaxed text-muted">
          Cross-platform Harness environments for CC, Codex, Cursor,
          <br />
          and multi-agent workflow runs
        </p>

        {/* Action buttons */}
        <div className="mb-10 flex gap-4">
          <button
            onClick={onOpenProject}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-7 py-4 text-sm font-medium text-foreground hover:border-accent/60 hover:bg-surface-hover transition-all duration-150"
          >
            <FolderOpen size={18} className="text-accent" />
            Open Project
          </button>
          <button
            onClick={onNewProject}
            className="flex items-center gap-2.5 rounded-xl bg-accent px-7 py-4 text-sm font-medium text-white hover:bg-accent-hover transition-all duration-150"
          >
            <Sparkles size={18} />
            New Project
          </button>
        </div>

        {/* Recent projects */}
        {recentProjects.length > 0 && (
          <div className="w-full max-w-sm">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted uppercase tracking-wider">
              <Clock size={11} />
              <span>Recent Projects</span>
            </div>
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              {recentProjects.map((p) => (
                <button
                  key={p.path}
                  onClick={() => onSelectRecent(p.path)}
                  className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left text-sm text-foreground/80 hover:bg-surface-hover transition-colors last:border-b-0"
                >
                  <span className="font-mono text-xs">{shortenPath(p.path)}</span>
                  <span className="text-xs text-muted">{formatRelativeTime(p.openedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer links */}
        <div className="mt-12 flex items-center gap-4 text-xs text-muted">
          <a
            href="https://github.com/androidZzT/harness-studio"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-link transition-colors"
          >
            Harness-Studio
            <ExternalLink size={10} />
          </a>
          <span className="text-border">|</span>
          <a
            href="https://github.com/androidZzT/harness-studio/blob/main/docs/product/positioning.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-link transition-colors"
          >
            Product Model
            <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
}

function shortenPath(fullPath: string): string {
  const match = fullPath.match(/^\/Users\/[^/]+\//);
  if (match) {
    return '~/' + fullPath.slice(match[0].length);
  }
  return fullPath;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

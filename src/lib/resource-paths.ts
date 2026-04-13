import path from 'node:path';
import os from 'node:os';
import type { ResourceType } from '@/types/resources';
import { getClaudeHome } from './claude-home';

const RESOURCE_DIRS: Record<ResourceType, string> = {
  agents: 'agents',
  workflows: 'workflows',
  skills: 'skills',
  rules: 'rules',
  mcps: '',      // stored in settings.json
  hooks: '',     // stored in settings.json
  memories: '',  // per-project, resolved via project scanner
};

export function getResourceDir(type: ResourceType): string {
  const claudeHome = getClaudeHome();
  const dir = RESOURCE_DIRS[type];
  if (!dir) {
    throw new Error(`Resource type "${type}" is stored in settings.json, not as files`);
  }
  return path.join(claudeHome, dir);
}

export function getSettingsPath(): string {
  return path.join(getClaudeHome(), 'settings.json');
}

export function getRootConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

export function encodeProjectPath(projectPath: string): string {
  return '-' + projectPath.replace(/[/_]/g, '-');
}

export function getProjectSharedSettingsPath(projectPath: string): string {
  return path.join(projectPath, '.claude', 'settings.json');
}

export function getProjectLocalSettingsPath(projectPath: string): string {
  const claudeHome = getClaudeHome();
  const encoded = encodeProjectPath(projectPath);
  return path.join(claudeHome, 'projects', encoded, 'settings.json');
}

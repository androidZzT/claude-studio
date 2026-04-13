import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import type { Resource, ResourceType } from '@/types/resources';
import {
  getResourceDir,
  getSettingsPath,
  getRootConfigPath,
  getProjectSharedSettingsPath,
  getProjectLocalSettingsPath,
} from './resource-paths';

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readResourceFile(filePath: string, type: ResourceType, baseDir?: string): Promise<Resource> {
  const content = await fs.readFile(filePath, 'utf-8');
  const baseName = path.basename(filePath, path.extname(filePath));
  // For skills stored as <skill-name>/SKILL.md, use the parent directory name
  const name = type === 'skills' && baseName === 'SKILL'
    ? path.basename(path.dirname(filePath))
    : baseName;
  // Use relative path from baseDir as id to avoid duplicates across subdirectories
  const idBase = baseDir
    ? path.relative(baseDir, filePath).replace(/\.(md|yaml)$/, '')
    : name;
  const id = encodeURIComponent(idBase);

  if (type === 'workflows' && filePath.endsWith('.yaml')) {
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { id, type, name, path: filePath, content };
    }
    return { id, type, name, path: filePath, content, frontmatter: parsed as Record<string, unknown> };
  }

  if (filePath.endsWith('.md')) {
    const { data, content: body } = matter(content);
    return {
      id,
      type,
      name,
      path: filePath,
      content: body,
      frontmatter: Object.keys(data).length > 0 ? data : undefined,
    };
  }

  return { id, type, name, path: filePath, content };
}

export async function listResourceFiles(type: ResourceType): Promise<Resource[]> {
  const dir = getResourceDir(type);
  if (!(await fileExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.yaml')))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));

  const resources = await Promise.all(
    files.map((f) => readResourceFile(f, type, dir).catch(() => null))
  );
  return resources.filter((r): r is Resource => r !== null);
}

export async function writeResourceFile(
  type: ResourceType,
  id: string,
  content: string,
  frontmatter?: Record<string, unknown>
): Promise<Resource> {
  const dir = getResourceDir(type);
  await fs.mkdir(dir, { recursive: true });

  const name = decodeURIComponent(id);
  const ext = type === 'workflows' ? '.yaml' : '.md';
  const filePath = path.join(dir, `${name}${ext}`);

  let fileContent: string;
  if (type === 'workflows' && frontmatter) {
    const parsedContent = yaml.load(content);
    const contentObj = (parsedContent && typeof parsedContent === 'object' && !Array.isArray(parsedContent))
      ? parsedContent as Record<string, unknown>
      : {};
    fileContent = yaml.dump({ ...frontmatter, ...contentObj });
  } else if (frontmatter && Object.keys(frontmatter).length > 0) {
    fileContent = matter.stringify(content, frontmatter);
  } else {
    fileContent = content;
  }

  await fs.writeFile(filePath, fileContent, 'utf-8');
  return readResourceFile(filePath, type, dir);
}

export async function deleteResourceFile(type: ResourceType, id: string): Promise<void> {
  const dir = getResourceDir(type);
  const name = decodeURIComponent(id);
  const ext = type === 'workflows' ? '.yaml' : '.md';
  const filePath = path.join(dir, `${name}${ext}`);

  if (!(await fileExists(filePath))) {
    throw new Error(`Resource not found: ${name}`);
  }
  await fs.unlink(filePath);
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  if (!(await fileExists(filePath))) {
    return {};
  }
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

export async function readSettings(): Promise<Record<string, unknown>> {
  const settings = await readJsonFile(getSettingsPath());
  const rootConfig = await readJsonFile(getRootConfigPath());

  const rootMcpServers = (rootConfig.mcpServers ?? {}) as Record<string, unknown>;
  const settingsMcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;

  // Merge: settings.json mcpServers override ~/.claude.json mcpServers
  const mergedMcpServers = { ...rootMcpServers, ...settingsMcpServers };

  return {
    ...settings,
    ...(Object.keys(mergedMcpServers).length > 0 ? { mcpServers: mergedMcpServers } : {}),
  };
}

export async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const settingsPath = getSettingsPath();
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export async function readProjectSettings(
  projectPath: string
): Promise<{ shared: Record<string, unknown>; local: Record<string, unknown> }> {
  const shared = await readJsonFile(getProjectSharedSettingsPath(projectPath));
  const local = await readJsonFile(getProjectLocalSettingsPath(projectPath));
  return { shared, local };
}

export async function writeProjectSharedSettings(
  projectPath: string,
  settings: Record<string, unknown>
): Promise<void> {
  const filePath = getProjectSharedSettingsPath(projectPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

export async function writeProjectLocalSettings(
  projectPath: string,
  settings: Record<string, unknown>
): Promise<void> {
  const filePath = getProjectLocalSettingsPath(projectPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

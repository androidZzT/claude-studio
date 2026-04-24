import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import type { Project, ProjectSummary, Resource } from './types';
import { getClaudeHome } from './claude-home';
import { fileExists } from './file-ops';
import { parseWorkflowDocument } from './workflow-document';

const CLAUDE_PROJECTS_META_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Known parent directories where Claude Code projects live.
 * We scan these for subdirectories containing CLAUDE.md instead of
 * trying to reverse-engineer the encoded directory names.
 * Override with CC_STUDIO_SEARCH_DIRS env var (colon-separated paths).
 */
const SEARCH_DIRS: readonly string[] = process.env.CC_STUDIO_SEARCH_DIRS
  ? process.env.CC_STUDIO_SEARCH_DIRS.split(':').map((d) => d.trim()).filter(Boolean)
  : [
      path.join(os.homedir(), 'Claude'),
      path.join(os.homedir(), 'Github'),
      path.join(os.homedir(), 'Workspace'),
    ];

async function readAgentFile(filePath: string): Promise<Resource | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const name = path.basename(filePath, '.md');
    const id = encodeURIComponent(name);
    const { data, content: body } = matter(content);
    return {
      id,
      type: 'agents',
      name,
      path: filePath,
      content: body,
      frontmatter: Object.keys(data).length > 0 ? data : undefined,
    };
  } catch {
    return null;
  }
}

async function readWorkflowFile(filePath: string): Promise<Resource | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const name = path.basename(filePath, path.extname(filePath));
    const id = encodeURIComponent(name);
    const parsed = parseWorkflowDocument(content);
    if (!parsed) {
      return { id, type: 'workflows', name, path: filePath, content };
    }
    return {
      id,
      type: 'workflows',
      name,
      path: filePath,
      content,
      frontmatter: parsed as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

async function listAgents(dir: string): Promise<readonly Resource[]> {
  if (!(await fileExists(dir))) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
    const results = await Promise.all(
      files.map((e) => readAgentFile(path.join(dir, e.name))),
    );
    return results.filter((r): r is Resource => r !== null);
  } catch {
    return [];
  }
}

async function listSkills(dir: string): Promise<readonly Resource[]> {
  if (!(await fileExists(dir))) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const results = await Promise.all(
      dirs.map(async (d): Promise<Resource | null> => {
        const skillFile = path.join(dir, d.name, 'SKILL.md');
        if (!(await fileExists(skillFile))) return null;
        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const { data, content: body } = matter(content);
          return {
            id: encodeURIComponent(d.name),
            type: 'skills',
            name: d.name,
            path: skillFile,
            content: body,
            frontmatter: Object.keys(data).length > 0 ? data : undefined,
          };
        } catch {
          return null;
        }
      }),
    );
    return results.filter((r): r is Resource => r !== null);
  } catch {
    return [];
  }
}

async function listWorkflows(dir: string): Promise<readonly Resource[]> {
  if (!(await fileExists(dir))) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter(
      (e) => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.yaml') || e.name.endsWith('.yml')),
    );
    const results = await Promise.all(
      files.map((e) => readWorkflowFile(path.join(dir, e.name))),
    );
    return results.filter((r): r is Resource => r !== null);
  } catch {
    return [];
  }
}

async function listMemories(memoryDir: string): Promise<readonly Resource[]> {
  if (!(await fileExists(memoryDir))) return [];
  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
    const results = await Promise.all(
      files.map((e) => readMemoryFile(path.join(memoryDir, e.name))),
    );
    return results.filter((r): r is Resource => r !== null);
  } catch {
    return [];
  }
}

async function readMemoryFile(filePath: string): Promise<Resource | null> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, 'utf-8'),
      fs.stat(filePath),
    ]);
    const fileName = path.basename(filePath, '.md');
    const id = `memory:${encodeURIComponent(fileName)}`;
    const { data, content: body } = matter(content);
    const displayName = typeof data.name === 'string' ? data.name : fileName;
    return {
      id,
      type: 'memories',
      name: displayName,
      path: filePath,
      content: body,
      frontmatter: Object.keys(data).length > 0 ? data : undefined,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

async function readClaudeMd(projectPath: string): Promise<string | undefined> {
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  try {
    return await fs.readFile(claudeMdPath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function scanGlobalProject(): Promise<Project> {
  const claudeHome = getClaudeHome();
  const [agents, workflows, skills] = await Promise.all([
    listAgents(path.join(claudeHome, 'agents')),
    listWorkflows(path.join(claudeHome, 'workflows')),
    listSkills(path.join(claudeHome, 'skills')),
  ]);
  return {
    id: 'global',
    name: 'Global',
    path: claudeHome,
    agents,
    workflows,
    skills,
    memories: [],
  };
}

/**
 * Build a lookup from encoded directory names to real filesystem paths.
 *
 * Instead of the previous greedy decode algorithm (which tried all possible
 * path segment combinations with fs.stat calls), we simply scan known parent
 * directories for subdirectories and build a reverse mapping.
 *
 * Claude Code encodes project paths by replacing '/' with '-' and '_' with '-'.
 * We reverse this by scanning real directories and encoding their paths the same way.
 */
async function buildProjectPathMap(): Promise<ReadonlyMap<string, string>> {
  const result = new Map<string, string>();

  // Also add the home directory itself (for projects at ~/CLAUDE.md)
  const homeDir = os.homedir();

  for (const searchDir of SEARCH_DIRS) {
    try {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(searchDir, entry.name);
        // Encode the same way Claude Code does: replace / and _ with -
        const encoded = '-' + fullPath.split('/').filter(Boolean).join('-').replace(/_/g, '-');
        result.set(encoded, fullPath);
      }
    } catch {
      // Search dir doesn't exist, skip
    }
  }

  // Also map the home directory and each search dir as potential project roots
  const extraPaths = [homeDir, ...SEARCH_DIRS];
  for (const p of extraPaths) {
    const encoded = '-' + p.split('/').filter(Boolean).join('-').replace(/_/g, '-');
    result.set(encoded, p);
  }

  return result;
}

function encodeProjectPath(projectPath: string): string {
  return '-' + projectPath.split('/').filter(Boolean).join('-').replace(/_/g, '-');
}

async function scanProjectAtPathInternal(projectPath: string, encodedName: string): Promise<Project | null> {
  const agentsDir = path.join(projectPath, '.claude', 'agents');
  const workflowsDir = path.join(projectPath, '.claude', 'workflows');
  const skillsDir = path.join(projectPath, '.claude', 'skills');
  const memoryDir = path.join(CLAUDE_PROJECTS_META_DIR, encodedName, 'memory');

  const displayName = path.basename(projectPath);

  const [agents, workflows, skills, memories, claudeMd] = await Promise.all([
    listAgents(agentsDir),
    listWorkflows(workflowsDir),
    listSkills(skillsDir),
    listMemories(memoryDir),
    readClaudeMd(projectPath),
  ]);

  return {
    id: encodeURIComponent(projectPath),
    name: displayName,
    path: projectPath,
    agents,
    workflows,
    skills,
    memories,
    claudeMd,
  };
}

/**
 * Scan a project at the given path. Creates .claude/ directory if needed.
 * This is the public API used by the open/create routes.
 */
export async function scanProjectAtPath(projectPath: string): Promise<Project> {
  const encoded = encodeProjectPath(projectPath);

  // Ensure .claude directory exists
  const claudeDir = path.join(projectPath, '.claude');
  if (!(await fileExists(claudeDir))) {
    await fs.mkdir(claudeDir, { recursive: true });
  }

  const project = await scanProjectAtPathInternal(projectPath, encoded);
  if (!project) {
    // Return a minimal project even without CLAUDE.md
    return {
      id: encodeURIComponent(projectPath),
      name: path.basename(projectPath),
      path: projectPath,
      agents: [],
      workflows: [],
      skills: [],
      memories: [],
    };
  }
  return project;
}

async function discoverProjectEntries(): Promise<readonly { readonly encoded: string; readonly projectPath: string }[]> {
  try {
    const metaEntries = await fs.readdir(CLAUDE_PROJECTS_META_DIR, { withFileTypes: true });
    const metaDirs = metaEntries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    const pathMap = await buildProjectPathMap();

    const results: { readonly encoded: string; readonly projectPath: string }[] = [];
    for (const encoded of metaDirs) {
      const projectPath = pathMap.get(encoded);
      if (projectPath) {
        results.push({ encoded, projectPath });
      }
    }

    return results;
  } catch {
    return [];
  }
}

export async function scanAllProjectSummaries(): Promise<readonly ProjectSummary[]> {
  const claudeHome = getClaudeHome();
  const globalSummary: ProjectSummary = { id: 'global', name: 'Global', path: claudeHome };

  const entries = await discoverProjectEntries();

  const summaries: ProjectSummary[] = [globalSummary];
  for (const { encoded, projectPath } of entries) {
    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
    if (await fileExists(claudeMdPath)) {
      summaries.push({
        id: encodeURIComponent(encoded),
        name: path.basename(projectPath),
        path: projectPath,
      });
    }
  }

  return summaries;
}

export async function scanAllProjects(): Promise<readonly Project[]> {
  const globalProject = await scanGlobalProject();

  const entries = await discoverProjectEntries();

  const projectResults = await Promise.all(
    entries.map(({ encoded, projectPath }) =>
      scanProjectAtPathInternal(projectPath, encoded).catch(() => null),
    ),
  );

  const projects = projectResults.filter((p): p is Project => p !== null);
  return [globalProject, ...projects];
}

export async function scanProjectById(id: string): Promise<Project | null> {
  if (id === 'global') {
    return scanGlobalProject();
  }

  const decoded = decodeURIComponent(id);

  // New path-based ID: decoded value starts with '/'
  if (decoded.startsWith('/')) {
    if (await fileExists(decoded)) {
      return scanProjectAtPath(decoded);
    }
    return null;
  }

  // Legacy encoded directory name
  const pathMap = await buildProjectPathMap();
  const projectPath = pathMap.get(decoded) ?? null;
  if (projectPath === null) return null;

  return scanProjectAtPathInternal(projectPath, decoded);
}

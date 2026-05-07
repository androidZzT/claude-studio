import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { fileExists } from './file-ops';
import { scanProjectAtPath } from './project-scanner';
import { expandHome } from './path-utils';
import { getProjectTemplateAgents, type ProjectTemplate } from './project-templates';
import type { Project } from './types';

export interface CreateProjectParams {
  readonly name: string;
  readonly parentDir?: string;
  readonly template?: ProjectTemplate;
}

function buildClaudeMd(name: string): string {
  return [
    `# ${name}`,
    '',
    '## Overview',
    'Describe your project here.',
    '',
    '## Team',
    'Define your agent team roles.',
    '',
    '## Workflows',
    'Describe your key workflows.',
    '',
  ].join('\n');
}

export async function createProject(params: CreateProjectParams): Promise<Project> {
  const name = params.name.trim();
  if (!name) {
    throw new Error('Missing required field: name');
  }

  const parentDir = expandHome(params.parentDir ?? '~/Claude');
  const projectPath = path.join(parentDir, name);

  if (await fileExists(projectPath)) {
    throw new Error(`Directory already exists: ${projectPath}`);
  }

  await fs.mkdir(path.join(projectPath, '.claude', 'agents'), { recursive: true });
  await fs.mkdir(path.join(projectPath, '.claude', 'workflows'), { recursive: true });

  await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), buildClaudeMd(name), 'utf-8');

  const template = params.template ?? 'blank';
  const agents = getProjectTemplateAgents(template);
  for (const agent of agents) {
    const fileContent =
      agent.frontmatter && Object.keys(agent.frontmatter).length > 0
        ? matter.stringify(agent.body, agent.frontmatter)
        : agent.body;

    await fs.writeFile(
      path.join(projectPath, '.claude', 'agents', `${agent.id}.md`),
      fileContent,
      'utf-8',
    );
  }

  return scanProjectAtPath(projectPath);
}

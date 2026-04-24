import { AGENT_TEMPLATES, type AgentTemplate } from './agent-templates';

export type ProjectTemplate = 'blank' | 'dev-team' | 'ops-team';

export interface ProjectTemplateInfo {
  readonly id: ProjectTemplate;
  readonly name: string;
  readonly description: string;
}

export const PROJECT_TEMPLATES: readonly ProjectTemplateInfo[] = [
  { id: 'blank', name: 'Blank', description: 'Empty project with CLAUDE.md' },
  { id: 'dev-team', name: 'Dev Team', description: 'Architect, coders, reviewer, tester' },
  { id: 'ops-team', name: 'Ops Team', description: 'Team lead and ops operator' },
];

const DEV_TEAM_IDS = ['architect', 'frontend-coder', 'backend-coder', 'code-reviewer', 'tester'] as const;
const OPS_TEAM_IDS = ['team-lead', 'ops-operator'] as const;

function pickTemplates(ids: readonly string[]): readonly AgentTemplate[] {
  return ids
    .map((id) => AGENT_TEMPLATES.find((t) => t.id === id))
    .filter((t): t is AgentTemplate => t !== undefined);
}

export function getProjectTemplateAgents(template: ProjectTemplate | string): readonly AgentTemplate[] {
  switch (template) {
    case 'dev-team':
      return pickTemplates(DEV_TEAM_IDS);
    case 'ops-team':
      return pickTemplates(OPS_TEAM_IDS);
    default:
      return [];
  }
}

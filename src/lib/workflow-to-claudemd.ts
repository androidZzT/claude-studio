import type { Workflow } from '@/types/resources';

/**
 * Generates a single-line workflow reference for CLAUDE.md.
 * Format: `- [workflow-name](.claude/workflows/filename.md) — description`
 */
export function workflowToClaudeMdLine(workflow: Workflow): string {
  const fileName = `${workflow.name}.md`;
  const relativePath = `.claude/workflows/${fileName}`;
  const description = workflow.description || '(no description)';
  return `- [${workflow.name}](${relativePath}) — ${description}`;
}

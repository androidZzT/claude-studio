import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ApiResponse } from '@/types/resources';
import { fileExists } from '@/lib/file-ops';
import { scanProjectById } from '@/lib/project-scanner';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Resolves the CLAUDE.md file path for a given project.
 */
async function getClaudeMdPath(projectId: string): Promise<string | null> {
  if (projectId === 'global') {
    return path.join(os.homedir(), '.claude', 'CLAUDE.md');
  }
  const project = await scanProjectById(projectId);
  if (!project) return null;
  return path.join(project.path, 'CLAUDE.md');
}

/**
 * Matches the `## Workflows` section from its heading to the next `## ` heading or end of file.
 */
const WORKFLOWS_SECTION_RE = /(^|\n)(## Workflows\n)([\s\S]*?)(?=\n## |\n*$)/;

/**
 * Builds a regex to match a specific workflow line within the Workflows section.
 * Matches `- [name](...) — ...` lines.
 */
function buildWorkflowLineRegex(workflowName: string): RegExp {
  const escaped = workflowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^- \\[${escaped}\\]\\(.*\\).*$`, 'm');
}

/**
 * Updates the `## Workflows` section in CLAUDE.md content.
 * - If `## Workflows` exists, finds the matching workflow line and replaces it,
 *   or appends a new line.
 * - If `## Workflows` does not exist, appends the section at the end.
 */
function updateWorkflowsSection(
  existing: string,
  workflowName: string,
  workflowLine: string
): string {
  const sectionMatch = existing.match(WORKFLOWS_SECTION_RE);

  if (sectionMatch) {
    const sectionContent = sectionMatch[3];
    const lineRegex = buildWorkflowLineRegex(workflowName);

    if (lineRegex.test(sectionContent)) {
      // Replace existing line
      const updatedContent = sectionContent.replace(lineRegex, workflowLine);
      return existing.replace(
        WORKFLOWS_SECTION_RE,
        `$1$2${updatedContent}`
      );
    }

    // Append new line to section
    const trimmedContent = sectionContent.trimEnd();
    const newContent = trimmedContent
      ? `${trimmedContent}\n${workflowLine}`
      : workflowLine;
    return existing.replace(
      WORKFLOWS_SECTION_RE,
      `$1$2${newContent}`
    );
  }

  // No ## Workflows section -- append at end
  const separator = existing.length > 0 && !existing.endsWith('\n\n')
    ? existing.endsWith('\n') ? '\n' : '\n\n'
    : '';
  return `${existing}${separator}## Workflows\n${workflowLine}\n`;
}

/**
 * POST /api/projects/:id/claudemd
 * Accepts { content: string }
 * Saves the full CLAUDE.md content for the project.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<{ updated: boolean }>>> {
  const { id } = await params;

  try {
    const body = await request.json() as {
      readonly content: string;
    };

    if (typeof body.content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: content' },
        { status: 400 }
      );
    }

    const claudeMdPath = await getClaudeMdPath(id);
    if (!claudeMdPath) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }

    await fs.mkdir(path.dirname(claudeMdPath), { recursive: true });
    await fs.writeFile(claudeMdPath, body.content, 'utf-8');

    return NextResponse.json({ success: true, data: { updated: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save CLAUDE.md';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * PUT /api/projects/:id/claudemd
 * Accepts { workflowName: string, workflowLine: string }
 * Updates or appends a workflow reference line in the `## Workflows` section.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<{ updated: boolean }>>> {
  const { id } = await params;

  try {
    const body = await request.json() as {
      readonly workflowName: string;
      readonly workflowLine: string;
    };

    if (typeof body.workflowName !== 'string' || body.workflowName.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: workflowName' },
        { status: 400 }
      );
    }

    if (typeof body.workflowLine !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: workflowLine' },
        { status: 400 }
      );
    }

    const claudeMdPath = await getClaudeMdPath(id);
    if (!claudeMdPath) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }

    // Read existing CLAUDE.md or start empty
    let existing = '';
    if (await fileExists(claudeMdPath)) {
      existing = await fs.readFile(claudeMdPath, 'utf-8');
    }

    const updated = updateWorkflowsSection(existing, body.workflowName, body.workflowLine);

    // Ensure parent directory exists (for new CLAUDE.md files)
    await fs.mkdir(path.dirname(claudeMdPath), { recursive: true });
    await fs.writeFile(claudeMdPath, updated, 'utf-8');

    return NextResponse.json({ success: true, data: { updated: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update CLAUDE.md';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

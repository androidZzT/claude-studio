import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ApiResponse, Resource } from '@/types/resources';
import { fileExists } from '@studio-core/file-ops';
import { scanProjectById } from '@studio-core/project-scanner';
import { formatWorkflowDocument, parseWorkflowDocument } from '@studio-core/workflow-document';
import { sanitizeFileName } from '@/lib/sanitize';

type RouteParams = { params: Promise<{ id: string }> };
const LEGACY_WORKFLOW_EXTS = ['.yaml', '.yml'] as const;

async function getProjectWorkflowsDir(projectId: string): Promise<string | null> {
  if (projectId === 'global') {
    return path.join(os.homedir(), '.claude', 'workflows');
  }
  const project = await scanProjectById(projectId);
  if (!project) return null;
  return path.join(project.path, '.claude', 'workflows');
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<Resource>>> {
  const { id } = await params;

  try {
    const body = await request.json() as {
      readonly name: string;
      readonly content: string;
    };

    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    if (typeof body.content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: content' },
        { status: 400 }
      );
    }

    const safeName = sanitizeFileName(body.name);
    if (!safeName) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow name: contains unsafe characters' },
        { status: 400 },
      );
    }

    const workflowsDir = await getProjectWorkflowsDir(id);
    if (!workflowsDir) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }
    await fs.mkdir(workflowsDir, { recursive: true });

    const fileName = `${safeName}.md`;
    const filePath = path.join(workflowsDir, fileName);

    const conflictCandidates = [
      filePath,
      ...LEGACY_WORKFLOW_EXTS.map((ext) => path.join(workflowsDir, `${safeName}${ext}`)),
    ];
    const existsAny = await Promise.all(conflictCandidates.map(fileExists));
    if (existsAny.some(Boolean)) {
      return NextResponse.json(
        { success: false, error: `Workflow already exists: ${safeName}` },
        { status: 409 }
      );
    }

    const parsed = parseWorkflowDocument(body.content);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow content: expected YAML or markdown with YAML block' },
        { status: 400 }
      );
    }

    const formattedContent = formatWorkflowDocument(parsed as unknown as Record<string, unknown>);
    await fs.writeFile(filePath, formattedContent, 'utf-8');

    const resource: Resource = {
      id: encodeURIComponent(body.name),
      type: 'workflows',
      name: body.name,
      path: filePath,
      content: formattedContent,
    };

    return NextResponse.json({ success: true, data: resource }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create workflow';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<null>>> {
  const { id } = await params;

  try {
    const { searchParams } = new URL(request.url);
    const workflowName = searchParams.get('name');

    if (!workflowName) {
      return NextResponse.json(
        { success: false, error: 'Missing required query param: name' },
        { status: 400 }
      );
    }

    const safeName = sanitizeFileName(workflowName);
    if (!safeName) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow name: contains unsafe characters' },
        { status: 400 },
      );
    }

    const workflowsDir = await getProjectWorkflowsDir(id);
    if (!workflowsDir) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }

    const candidates = [
      path.join(workflowsDir, `${safeName}.md`),
      ...LEGACY_WORKFLOW_EXTS.map((ext) => path.join(workflowsDir, `${safeName}${ext}`)),
    ];
    const existing = await Promise.all(candidates.map(async (p) => ((await fileExists(p)) ? p : null)));
    const targetPath = existing.find((p): p is string => p !== null);
    if (!targetPath) {
      return NextResponse.json(
        { success: false, error: `Workflow not found: ${workflowName}` },
        { status: 404 }
      );
    }

    await fs.unlink(targetPath);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete workflow';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<Resource>>> {
  const { id } = await params;

  try {
    const body = await request.json() as {
      readonly name: string;
      readonly content: string;
    };

    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    const safeNamePut = sanitizeFileName(body.name);
    if (!safeNamePut) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow name: contains unsafe characters' },
        { status: 400 },
      );
    }

    const workflowsDir = await getProjectWorkflowsDir(id);
    if (!workflowsDir) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }
    await fs.mkdir(workflowsDir, { recursive: true });

    const fileName = `${safeNamePut}.md`;
    const filePath = path.join(workflowsDir, fileName);

    const parsed = parseWorkflowDocument(body.content);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow content: expected YAML or markdown with YAML block' },
        { status: 400 }
      );
    }

    const formattedContent = formatWorkflowDocument(parsed as unknown as Record<string, unknown>);
    await fs.writeFile(filePath, formattedContent, 'utf-8');
    for (const ext of LEGACY_WORKFLOW_EXTS) {
      const legacyPath = path.join(workflowsDir, `${safeNamePut}${ext}`);
      if (await fileExists(legacyPath)) {
        await fs.unlink(legacyPath);
      }
    }

    const resource: Resource = {
      id: encodeURIComponent(body.name),
      type: 'workflows',
      name: body.name,
      path: filePath,
      content: formattedContent,
    };

    return NextResponse.json({ success: true, data: resource });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save workflow';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

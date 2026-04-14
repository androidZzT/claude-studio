import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ApiResponse, Resource } from '@/types/resources';
import { fileExists } from '@/lib/file-ops';
import { scanProjectById } from '@/lib/project-scanner';
import { sanitizeFileName } from '@/lib/sanitize';

type RouteParams = { params: Promise<{ id: string }> };

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

    const fileName = `${safeName}.yaml`;
    const filePath = path.join(workflowsDir, fileName);

    if (await fileExists(filePath)) {
      return NextResponse.json(
        { success: false, error: `Workflow already exists: ${safeName}` },
        { status: 409 }
      );
    }

    await fs.writeFile(filePath, body.content, 'utf-8');

    const resource: Resource = {
      id: encodeURIComponent(body.name),
      type: 'workflows',
      name: body.name,
      path: filePath,
      content: body.content,
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

    const filePath = path.join(workflowsDir, `${safeName}.yaml`);

    if (!(await fileExists(filePath))) {
      return NextResponse.json(
        { success: false, error: `Workflow not found: ${workflowName}` },
        { status: 404 }
      );
    }

    await fs.unlink(filePath);
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

    const fileName = `${safeNamePut}.yaml`;
    const filePath = path.join(workflowsDir, fileName);

    await fs.writeFile(filePath, body.content, 'utf-8');

    const resource: Resource = {
      id: encodeURIComponent(body.name),
      type: 'workflows',
      name: body.name,
      path: filePath,
      content: body.content,
    };

    return NextResponse.json({ success: true, data: resource });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save workflow';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

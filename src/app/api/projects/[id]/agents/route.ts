import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import type { ApiResponse, Resource } from '@/types/resources';
import { fileExists } from '@studio-core/file-ops';
import { scanProjectById } from '@studio-core/project-scanner';
import { sanitizeFileName } from '@/lib/sanitize';

type RouteParams = { params: Promise<{ id: string }> };

async function getProjectAgentsDir(projectId: string): Promise<string | null> {
  if (projectId === 'global') {
    return path.join(os.homedir(), '.claude', 'agents');
  }
  const project = await scanProjectById(projectId);
  if (!project) return null;
  return path.join(project.path, '.claude', 'agents');
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
      readonly frontmatter?: Record<string, unknown>;
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
        { success: false, error: 'Invalid agent name: contains unsafe characters' },
        { status: 400 },
      );
    }

    const agentsDir = await getProjectAgentsDir(id);
    if (!agentsDir) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }
    await fs.mkdir(agentsDir, { recursive: true });

    const fileName = `${safeName}.md`;
    const filePath = path.join(agentsDir, fileName);

    if (await fileExists(filePath)) {
      return NextResponse.json(
        { success: false, error: `Agent already exists: ${body.name}` },
        { status: 409 }
      );
    }

    const fileContent =
      body.frontmatter && Object.keys(body.frontmatter).length > 0
        ? matter.stringify(body.content, body.frontmatter)
        : body.content;

    await fs.writeFile(filePath, fileContent, 'utf-8');

    const resource: Resource = {
      id: encodeURIComponent(body.name),
      type: 'agents',
      name: body.name,
      path: filePath,
      content: body.content,
      frontmatter: body.frontmatter,
    };

    return NextResponse.json({ success: true, data: resource }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create agent';
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
    const agentName = searchParams.get('name');

    if (!agentName) {
      return NextResponse.json(
        { success: false, error: 'Missing required query param: name' },
        { status: 400 }
      );
    }

    const safeName = sanitizeFileName(agentName);
    if (!safeName) {
      return NextResponse.json(
        { success: false, error: 'Invalid agent name: contains unsafe characters' },
        { status: 400 },
      );
    }

    const agentsDir = await getProjectAgentsDir(id);
    if (!agentsDir) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }

    const filePath = path.join(agentsDir, `${safeName}.md`);

    if (!(await fileExists(filePath))) {
      return NextResponse.json(
        { success: false, error: `Agent not found: ${agentName}` },
        { status: 404 }
      );
    }

    await fs.unlink(filePath);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete agent';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

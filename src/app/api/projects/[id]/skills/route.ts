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

async function getProjectSkillsDir(projectId: string): Promise<string | null> {
  if (projectId === 'global') {
    return path.join(os.homedir(), '.claude', 'skills');
  }
  const project = await scanProjectById(projectId);
  if (!project) return null;
  return path.join(project.path, '.claude', 'skills');
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<Resource>>> {
  const { id } = await params;

  try {
    const body = await request.json() as {
      readonly name: string;
      readonly description: string;
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
        { success: false, error: 'Invalid skill name: contains unsafe characters' },
        { status: 400 },
      );
    }

    const skillsDir = await getProjectSkillsDir(id);
    if (!skillsDir) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }

    const skillDir = path.join(skillsDir, safeName);
    const filePath = path.join(skillDir, 'SKILL.md');

    if (await fileExists(filePath)) {
      return NextResponse.json(
        { success: false, error: `Skill already exists: ${safeName}` },
        { status: 409 }
      );
    }

    await fs.mkdir(skillDir, { recursive: true });

    const frontmatter: Record<string, string> = {
      name: body.name,
    };
    if (body.description) {
      frontmatter.description = body.description;
    }

    const fileContent = matter.stringify(body.content, frontmatter);
    await fs.writeFile(filePath, fileContent, 'utf-8');

    const resource: Resource = {
      id: encodeURIComponent(body.name),
      type: 'skills',
      name: body.name,
      path: filePath,
      content: body.content,
      frontmatter,
    };

    return NextResponse.json({ success: true, data: resource }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create skill';
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
    const skillName = searchParams.get('name');

    if (!skillName) {
      return NextResponse.json(
        { success: false, error: 'Missing required query param: name' },
        { status: 400 }
      );
    }

    const safeName = sanitizeFileName(skillName);
    if (!safeName) {
      return NextResponse.json(
        { success: false, error: 'Invalid skill name: contains unsafe characters' },
        { status: 400 },
      );
    }

    const skillsDir = await getProjectSkillsDir(id);
    if (!skillsDir) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }

    const skillDir = path.join(skillsDir, safeName);
    const filePath = path.join(skillDir, 'SKILL.md');

    if (!(await fileExists(filePath))) {
      return NextResponse.json(
        { success: false, error: `Skill not found: ${skillName}` },
        { status: 404 }
      );
    }

    // Remove the entire skill directory
    await fs.rm(skillDir, { recursive: true });
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete skill';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createProject } from '@studio-core/project-creation';
import type { ProjectTemplate } from '@studio-core/project-templates';
import type { ApiResponse, Project } from '@/types/resources';

interface CreateRequest {
  readonly name: string;
  readonly parentDir: string;
  readonly template: ProjectTemplate;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<Project>>> {
  try {
    const body = (await request.json()) as CreateRequest;

    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    const project = await createProject({
      name: body.name.trim(),
      parentDir: body.parentDir || '~/Claude',
      template: body.template || 'blank',
    });
    return NextResponse.json({ success: true, data: project }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create project';
    const status = message.startsWith('Directory already exists:') ? 409 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

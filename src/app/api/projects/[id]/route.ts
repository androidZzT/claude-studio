import { NextRequest, NextResponse } from 'next/server';
import { scanProjectById } from '@studio-core/project-scanner';
import type { ApiResponse, Project } from '@/types/resources';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse<Project>>> {
  const { id } = await params;

  try {
    const project = await scanProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read project';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

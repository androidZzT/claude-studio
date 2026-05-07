import { NextRequest, NextResponse } from 'next/server';
import { scanProjectById } from '@studio-core/project-scanner';
import { readVisualWorkflowRuns } from '@studio-core/visual-workflow';
import type { ApiResponse } from '@/types/resources';
import type { VisualWorkflowRunSummary } from '@studio-core/visual-workflow';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<readonly VisualWorkflowRunSummary[]>>> {
  const { id } = await params;

  try {
    const project = await scanProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 },
      );
    }

    const runs = await readVisualWorkflowRuns(project.path);
    return NextResponse.json({ success: true, data: runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read visual runs';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

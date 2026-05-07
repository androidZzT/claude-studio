import { NextRequest, NextResponse } from 'next/server';
import { scanProjectById } from '@studio-core/project-scanner';
import { readVisualWorkflowRun } from '@studio-core/visual-workflow';
import type { ApiResponse } from '@/types/resources';
import type { VisualWorkflowRun } from '@studio-core/visual-workflow';

type RouteParams = { params: Promise<{ id: string; runId: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<VisualWorkflowRun>>> {
  const { id, runId } = await params;

  try {
    const project = await scanProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 },
      );
    }

    const run = await readVisualWorkflowRun(project.path, decodeURIComponent(runId));
    return NextResponse.json({ success: true, data: run });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read visual run';
    const status = message.startsWith('Run not found:') ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

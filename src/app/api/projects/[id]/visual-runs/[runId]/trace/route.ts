import { NextRequest, NextResponse } from 'next/server';
import { scanProjectById } from '@studio-core/project-scanner';
import { readVisualRunTrace } from '@studio-core/visual-workflow';
import type { ApiResponse } from '@/types/resources';
import type { VisualTraceResult } from '@studio-core/visual-workflow';

type RouteParams = { params: Promise<{ id: string; runId: string }> };

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<VisualTraceResult>>> {
  const { id, runId } = await params;

  try {
    const project = await scanProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 },
      );
    }

    const { searchParams } = new URL(request.url);
    const phaseId = searchParams.get('phaseId');
    if (!phaseId) {
      return NextResponse.json(
        { success: false, error: 'Missing required query param: phaseId' },
        { status: 400 },
      );
    }
    const maxEventsRaw = Number(searchParams.get('maxEvents') ?? '500');
    const maxEvents = Number.isFinite(maxEventsRaw) ? Math.min(Math.max(maxEventsRaw, 50), 2000) : 500;
    const trace = await readVisualRunTrace(project.path, decodeURIComponent(runId), phaseId, maxEvents);
    return NextResponse.json({ success: true, data: trace });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read visual run trace';
    const status = message.startsWith('Run not found:') ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

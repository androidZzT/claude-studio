import { NextRequest, NextResponse } from 'next/server';
import { scanProjectById } from '@studio-core/project-scanner';
import { readVisualRunArtifact } from '@studio-core/visual-workflow';
import type { ApiResponse } from '@/types/resources';
import type { VisualRunArtifact } from '@studio-core/visual-workflow';

type RouteParams = { params: Promise<{ id: string; runId: string }> };

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<VisualRunArtifact>>> {
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
    const phaseId = searchParams.get('phaseId') ?? undefined;
    const kind = searchParams.get('kind') ?? 'prompt';
    const maxBytesRaw = Number(searchParams.get('maxBytes') ?? '96000');
    const maxBytes = Number.isFinite(maxBytesRaw) ? Math.min(Math.max(maxBytesRaw, 4096), 512000) : 96000;
    const artifact = await readVisualRunArtifact(project.path, decodeURIComponent(runId), phaseId, kind, maxBytes);
    return NextResponse.json({ success: true, data: artifact });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read visual run artifact';
    const status = message.startsWith('Run not found:') ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

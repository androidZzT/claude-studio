import { NextRequest, NextResponse } from 'next/server';
import { checkHarnessCliAvailability } from '@studio-core/harness-cli';
import { scanProjectById } from '@studio-core/project-scanner';
import type { ApiResponse } from '@/types/resources';
import type { HarnessCliAvailability } from '@studio-core/harness-cli';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<HarnessCliAvailability>>> {
  const { id } = await params;

  try {
    const project = await scanProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 },
      );
    }

    const availability = await checkHarnessCliAvailability(project.path);
    return NextResponse.json({ success: true, data: availability });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check harness-cli';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

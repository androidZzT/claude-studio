import { NextRequest, NextResponse } from 'next/server';
import { viewHarnessRun } from '@studio-core/harness-cli';
import { scanProjectById } from '@studio-core/project-scanner';
import type { ApiResponse } from '@/types/resources';
import type { HarnessCliInspectRequest, HarnessCliResult } from '@studio-core/harness-cli';

type RouteParams = { params: Promise<{ id: string }> };

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<HarnessCliResult<unknown>>>> {
  const { id } = await params;

  try {
    const project = await scanProjectById(id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${id}` },
        { status: 404 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const threadId = readOptionalString(body.threadId);
    if (!threadId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: threadId' },
        { status: 400 },
      );
    }

    const viewRequest: HarnessCliInspectRequest = {
      threadId,
      runRoot: readOptionalString(body.runRoot),
    };
    const result = await viewHarnessRun(project.path, viewRequest);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to render harness run view';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

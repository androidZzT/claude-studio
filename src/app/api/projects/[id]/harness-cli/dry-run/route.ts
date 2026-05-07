import { NextRequest, NextResponse } from 'next/server';
import { dryRunHarnessWorkflow } from '@studio-core/harness-cli';
import { scanProjectById } from '@studio-core/project-scanner';
import type { ApiResponse } from '@/types/resources';
import type { HarnessCliDryRunRequest, HarnessCliResult } from '@studio-core/harness-cli';

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
    const dryRunRequest: HarnessCliDryRunRequest = {
      compoundName: readOptionalString(body.compoundName),
      skillPath: readOptionalString(body.skillPath),
      threadId: readOptionalString(body.threadId),
      runRoot: readOptionalString(body.runRoot),
      taskCardPath: readOptionalString(body.taskCardPath),
      configPath: readOptionalString(body.configPath),
      noLocal: body.noLocal === true,
    };

    const result = await dryRunHarnessWorkflow(project.path, dryRunRequest, {
      timeoutMs: 120_000,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run harness-cli dry-run';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

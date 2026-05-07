import { NextRequest, NextResponse } from 'next/server';
import { getExecution } from '@studio-core/execution-engine';
import type { ApiResponse } from '@/types/resources';
import type { ExecutionState } from '@studio-core/execution-engine';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse<ExecutionState>>> {
  const { id } = await params;

  const runner = getExecution(id);
  if (!runner) {
    return NextResponse.json(
      { success: false, error: `Execution not found: ${id}` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: runner.getState(),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getExecution } from '@studio-core/execution-engine';
import type { ApiResponse } from '@/types/resources';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> }
): Promise<NextResponse<ApiResponse<{ approved: boolean }>>> {
  const { id, nodeId } = await params;

  const runner = getExecution(id);
  if (!runner) {
    return NextResponse.json(
      { success: false, error: `Execution not found: ${id}` },
      { status: 404 }
    );
  }

  const approved = runner.approveCheckpoint(nodeId);
  if (!approved) {
    return NextResponse.json(
      { success: false, error: `No pending checkpoint for node: ${nodeId}` },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { approved: true },
  });
}

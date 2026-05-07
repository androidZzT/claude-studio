import { NextRequest, NextResponse } from 'next/server';
import { getExecution } from '@studio-core/execution-engine';
import type { ApiResponse } from '@/types/resources';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse<{ cancelled: boolean }>>> {
  const { id } = await params;

  const runner = getExecution(id);
  if (!runner) {
    return NextResponse.json(
      { success: false, error: `Execution not found: ${id}` },
      { status: 404 }
    );
  }

  runner.cancel();

  return NextResponse.json({
    success: true,
    data: { cancelled: true },
  });
}

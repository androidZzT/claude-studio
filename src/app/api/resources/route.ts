import { NextResponse } from 'next/server';
import { listResourceFiles } from '@studio-core/file-ops';
import type { ResourceType, ApiResponse, Resource } from '@/types/resources';

const FILE_BASED_TYPES: ResourceType[] = ['agents', 'workflows', 'skills', 'rules'];

export async function GET(): Promise<NextResponse<ApiResponse<Resource[]>>> {
  try {
    const results = await Promise.all(
      FILE_BASED_TYPES.map((type) => listResourceFiles(type))
    );
    const allResources = results.flat();
    return NextResponse.json({ success: true, data: allResources });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list resources';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

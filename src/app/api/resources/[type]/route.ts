import { NextRequest, NextResponse } from 'next/server';
import { listResourceFiles, writeResourceFile } from '@studio-core/file-ops';
import type { ResourceType, ApiResponse, Resource } from '@/types/resources';

const VALID_TYPES = new Set<string>(['agents', 'workflows', 'skills', 'rules']);

function validateType(type: string): type is ResourceType {
  return VALID_TYPES.has(type);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
): Promise<NextResponse<ApiResponse<Resource[]>>> {
  const { type } = await params;
  if (!validateType(type)) {
    return NextResponse.json(
      { success: false, error: `Invalid resource type: ${type}` },
      { status: 400 }
    );
  }

  try {
    const resources = await listResourceFiles(type);
    return NextResponse.json({ success: true, data: resources });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list resources';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
): Promise<NextResponse<ApiResponse<Resource>>> {
  const { type } = await params;
  if (!validateType(type)) {
    return NextResponse.json(
      { success: false, error: `Invalid resource type: ${type}` },
      { status: 400 }
    );
  }

  try {
    const body = await request.json() as { id: string; content: string; frontmatter?: Record<string, unknown> };
    if (!body.id || typeof body.content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: id, content' },
        { status: 400 }
      );
    }

    const resource = await writeResourceFile(type, body.id, body.content, body.frontmatter);
    return NextResponse.json({ success: true, data: resource }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create resource';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

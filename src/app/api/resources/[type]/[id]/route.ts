import { NextRequest, NextResponse } from 'next/server';
import { listResourceFiles, writeResourceFile, deleteResourceFile } from '@studio-core/file-ops';
import type { ResourceType, ApiResponse, Resource } from '@/types/resources';

const VALID_TYPES = new Set<string>(['agents', 'workflows', 'skills', 'rules']);

function validateType(type: string): type is ResourceType {
  return VALID_TYPES.has(type);
}

type RouteParams = { params: Promise<{ type: string; id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<Resource>>> {
  const { type, id } = await params;
  if (!validateType(type)) {
    return NextResponse.json(
      { success: false, error: `Invalid resource type: ${type}` },
      { status: 400 }
    );
  }

  try {
    const resources = await listResourceFiles(type);
    const resource = resources.find((r) => r.id === id);
    if (!resource) {
      return NextResponse.json(
        { success: false, error: `Resource not found: ${id}` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: resource });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read resource';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<Resource>>> {
  const { type, id } = await params;
  if (!validateType(type)) {
    return NextResponse.json(
      { success: false, error: `Invalid resource type: ${type}` },
      { status: 400 }
    );
  }

  try {
    const body = await request.json() as { content: string; frontmatter?: Record<string, unknown>; path?: string };
    if (typeof body.content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: content' },
        { status: 400 }
      );
    }

    // CLAUDE.md resources carry their own filesystem path — write directly
    if (body.path && body.path.endsWith('/CLAUDE.md')) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(body.path, body.content, 'utf-8');
      const resource: Resource = {
        id,
        type,
        name: 'CLAUDE.md',
        path: body.path,
        content: body.content,
      };
      return NextResponse.json({ success: true, data: resource });
    }

    const resource = await writeResourceFile(type, id, body.content, body.frontmatter);
    return NextResponse.json({ success: true, data: resource });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update resource';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<null>>> {
  const { type, id } = await params;
  if (!validateType(type)) {
    return NextResponse.json(
      { success: false, error: `Invalid resource type: ${type}` },
      { status: 400 }
    );
  }

  try {
    await deleteResourceFile(type, id);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete resource';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

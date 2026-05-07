import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import matter from 'gray-matter';
import type { ApiResponse } from '@/types/resources';
import { fileExists } from '@studio-core/file-ops';

const CLAUDE_DIR = `${os.homedir()}/.claude/`;

function isAllowedPath(filePath: string): boolean {
  return filePath.startsWith(CLAUDE_DIR);
}

export async function DELETE(
  request: NextRequest
): Promise<NextResponse<ApiResponse<null>>> {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json(
        { success: false, error: 'Missing required query param: path' },
        { status: 400 }
      );
    }

    if (!isAllowedPath(filePath)) {
      return NextResponse.json(
        { success: false, error: 'Path must be under ~/.claude/' },
        { status: 403 }
      );
    }

    if (!(await fileExists(filePath))) {
      return NextResponse.json(
        { success: false, error: `File not found: ${filePath}` },
        { status: 404 }
      );
    }

    await fs.unlink(filePath);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to delete file';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest
): Promise<NextResponse<ApiResponse<null>>> {
  try {
    const body = (await request.json()) as {
      path: string;
      content: string;
      frontmatter?: Record<string, unknown>;
    };

    if (typeof body.path !== 'string' || typeof body.content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: path, content' },
        { status: 400 }
      );
    }

    if (!isAllowedPath(body.path)) {
      return NextResponse.json(
        { success: false, error: 'Path must be under ~/.claude/' },
        { status: 403 }
      );
    }

    if (!(await fileExists(body.path))) {
      return NextResponse.json(
        { success: false, error: `File not found: ${body.path}` },
        { status: 404 }
      );
    }

    const fileContent =
      body.frontmatter && Object.keys(body.frontmatter).length > 0
        ? matter.stringify(body.content, body.frontmatter)
        : body.content;

    await fs.writeFile(body.path, fileContent, 'utf-8');
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to write file';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

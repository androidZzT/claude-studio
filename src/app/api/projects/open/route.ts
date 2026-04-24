import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import os from 'node:os';
import { scanProjectAtPath } from '@studio-core/project-scanner';
import { fileExists } from '@studio-core/file-ops';
import { expandHome } from '@studio-core/path-utils';
import type { ApiResponse, Project } from '@/types/resources';

interface OpenRequest {
  readonly path: string;
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<Project>>> {
  try {
    const body = (await request.json()) as OpenRequest;

    if (typeof body.path !== 'string' || body.path.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: path' },
        { status: 400 }
      );
    }

    const projectPath = path.resolve(expandHome(body.path).replace(/\/+$/, ''));
    const homeDir = os.homedir();

    // Security: reject paths outside home directory and block traversal
    if (!isPathWithin(homeDir, projectPath)) {
      return NextResponse.json(
        { success: false, error: 'Path not allowed: must be within home directory' },
        { status: 403 },
      );
    }

    if (!(await fileExists(projectPath))) {
      return NextResponse.json(
        { success: false, error: `Path does not exist: ${projectPath}` },
        { status: 404 }
      );
    }

    const project = await scanProjectAtPath(projectPath);
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open project';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

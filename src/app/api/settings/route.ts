import { NextRequest, NextResponse } from 'next/server';
import {
  readSettings,
  writeSettings,
  readProjectSettings,
  writeProjectSharedSettings,
  writeProjectLocalSettings,
} from '@/lib/file-ops';
import type { ApiResponse } from '@/types/resources';

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<Record<string, unknown>>>> {
  try {
    const scope = request.nextUrl.searchParams.get('scope') ?? 'global';
    const projectPath = request.nextUrl.searchParams.get('projectPath');

    if (scope === 'project') {
      if (!projectPath) {
        return NextResponse.json(
          { success: false, error: 'projectPath is required for scope=project' },
          { status: 400 }
        );
      }
      const data = await readProjectSettings(projectPath);
      return NextResponse.json({ success: true, data: data as unknown as Record<string, unknown> });
    }

    const settings = await readSettings();
    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read settings';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest
): Promise<NextResponse<ApiResponse<Record<string, unknown>>>> {
  try {
    const scope = request.nextUrl.searchParams.get('scope') ?? 'global';
    const projectPath = request.nextUrl.searchParams.get('projectPath');
    const body = await request.json() as Record<string, unknown>;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    if (scope === 'project-shared') {
      if (!projectPath) {
        return NextResponse.json(
          { success: false, error: 'projectPath is required for scope=project-shared' },
          { status: 400 }
        );
      }
      await writeProjectSharedSettings(projectPath, body);
      const data = await readProjectSettings(projectPath);
      return NextResponse.json({ success: true, data: data as unknown as Record<string, unknown> });
    }

    if (scope === 'project-local') {
      if (!projectPath) {
        return NextResponse.json(
          { success: false, error: 'projectPath is required for scope=project-local' },
          { status: 400 }
        );
      }
      await writeProjectLocalSettings(projectPath, body);
      const data = await readProjectSettings(projectPath);
      return NextResponse.json({ success: true, data: data as unknown as Record<string, unknown> });
    }

    await writeSettings(body);
    const updated = await readSettings();
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update settings';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

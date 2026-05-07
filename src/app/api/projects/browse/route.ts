import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ApiResponse } from '@/types/resources';
import { expandHome } from '@studio-core/path-utils';

interface BrowseResult {
  readonly entries: readonly string[];
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<BrowseResult>>> {
  try {
    const prefix = request.nextUrl.searchParams.get('prefix') ?? '';
    if (prefix === '') {
      return NextResponse.json({
        success: true,
        data: { entries: [] },
      });
    }

    const expanded = expandHome(prefix);
    const resolved = path.resolve(expanded);
    const homeDir = os.homedir();

    // Security: reject paths outside home directory and block traversal
    if (!resolved.startsWith(homeDir)) {
      return NextResponse.json(
        { success: false, error: 'Path not allowed: must be within home directory' },
        { status: 403 },
      );
    }

    const parentDir = expanded.endsWith('/') ? resolved : path.dirname(resolved);
    const namePrefix = expanded.endsWith('/') ? '' : path.basename(resolved).toLowerCase();

    let entries: readonly string[];
    try {
      const dirEntries = await fs.readdir(parentDir, { withFileTypes: true });
      const dirs = dirEntries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .filter((e) => namePrefix === '' || e.name.toLowerCase().startsWith(namePrefix))
        .slice(0, 20)
        .map((e) => path.join(parentDir, e.name));
      entries = dirs;
    } catch {
      entries = [];
    }

    return NextResponse.json({
      success: true,
      data: { entries },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to browse directory';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

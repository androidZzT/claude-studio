import { NextRequest, NextResponse } from 'next/server';
import { startExecution } from '@studio-core/execution-engine';
import { parseWorkflowDocument } from '@studio-core/workflow-document';
import type { ApiResponse } from '@/types/resources';

interface WorkflowNodeParsed {
  readonly id: string;
  readonly agent: string;
  readonly task: string;
  readonly checkpoint?: boolean;
  readonly depends_on?: readonly string[];
  readonly roundtrip?: readonly string[];
  readonly skills?: readonly string[];
}

interface ExecuteRequestBody {
  readonly workflowYaml?: string;
  readonly workflow?: {
    readonly name: string;
    readonly nodes: readonly WorkflowNodeParsed[];
  };
  readonly projectPath?: string;
  readonly simulate?: boolean;
}

interface WorkflowParsed {
  readonly name: string;
  readonly nodes: readonly WorkflowNodeParsed[];
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ executionId: string }>>> {
  try {
    const body = (await request.json()) as ExecuteRequestBody;

    let workflow: WorkflowParsed | null = null;

    if (body.workflow) {
      workflow = body.workflow;
    } else if (body.workflowYaml) {
      const parsed = parseWorkflowDocument(body.workflowYaml);
      if (!parsed || !parsed.name || !parsed.nodes) {
        return NextResponse.json(
          { success: false, error: 'Invalid workflow document: missing name or nodes' },
          { status: 400 }
        );
      }
      workflow = parsed as unknown as WorkflowParsed;
    }

    if (!workflow) {
      return NextResponse.json(
        { success: false, error: 'Either workflow or workflowYaml is required' },
        { status: 400 }
      );
    }

    if (workflow.nodes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Workflow must have at least one node' },
        { status: 400 }
      );
    }

    const runner = startExecution(workflow, {
      simulate: body.simulate ?? true,
      projectPath: body.projectPath,
    });

    const state = runner.getState();

    return NextResponse.json({
      success: true,
      data: { executionId: state.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start execution';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

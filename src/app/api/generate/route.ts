import { NextRequest, NextResponse } from 'next/server';
import yaml from 'js-yaml';
import type { ApiResponse } from '@/types/resources';
import { callClaude, stripMarkdownFences } from '@/lib/claude-cli';
import { buildWorkflowPrompt, buildAgentPrompt, buildSkillPrompt } from '@/lib/generate-prompts';
import { validateWorkflow } from '@/lib/workflow-validation';
import { parseWorkflowDocument } from '@studio-core/workflow-document';

type GenerateType = 'workflow' | 'agent' | 'skill';

interface GenerateRequestBody {
  readonly type: GenerateType;
  readonly description: string;
  readonly agents?: readonly string[];
  readonly skills?: readonly string[];
}

interface WorkflowResult {
  readonly type: 'workflow';
  readonly workflow: Record<string, unknown>;
}

interface AgentResult {
  readonly type: 'agent';
  readonly name: string;
  readonly description: string;
  readonly model: string;
  readonly tools: readonly string[];
  readonly body: string;
}

interface SkillResult {
  readonly type: 'skill';
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

type GenerateResult = WorkflowResult | AgentResult | SkillResult;

function parseWorkflowOutput(raw: string): WorkflowResult {
  const cleaned = stripMarkdownFences(raw);
  const parsed = parseWorkflowDocument(cleaned);
  if (!parsed) {
    throw new Error('Failed to parse workflow output as YAML or workflow markdown');
  }

  const validation = validateWorkflow(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid workflow: ${validation.errors.join('; ')}`);
  }

  return { type: 'workflow', workflow: parsed as unknown as Record<string, unknown> };
}

function parseAgentOutput(raw: string): AgentResult {
  const cleaned = stripMarkdownFences(raw);
  const separatorIndex = cleaned.indexOf('\n---\n');

  let frontmatterStr: string;
  let body: string;

  if (separatorIndex >= 0) {
    frontmatterStr = cleaned.slice(0, separatorIndex);
    body = cleaned.slice(separatorIndex + 5).trim();
  } else {
    frontmatterStr = cleaned;
    body = '';
  }

  const frontmatter = yaml.load(frontmatterStr) as Record<string, unknown>;

  const name = typeof frontmatter.name === 'string' ? frontmatter.name : 'unnamed-agent';
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const model = typeof frontmatter.model === 'string' ? frontmatter.model : 'sonnet';
  const tools = Array.isArray(frontmatter.tools)
    ? frontmatter.tools.filter((t): t is string => typeof t === 'string')
    : ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

  return { type: 'agent', name, description, model, tools, body };
}

function parseSkillOutput(raw: string): SkillResult {
  const cleaned = stripMarkdownFences(raw);
  const separatorIndex = cleaned.indexOf('\n---\n');

  let frontmatterStr: string;
  let body: string;

  if (separatorIndex >= 0) {
    frontmatterStr = cleaned.slice(0, separatorIndex);
    body = cleaned.slice(separatorIndex + 5).trim();
  } else {
    frontmatterStr = cleaned;
    body = '';
  }

  const frontmatter = yaml.load(frontmatterStr) as Record<string, unknown>;

  const name = typeof frontmatter.name === 'string' ? frontmatter.name : 'unnamed-skill';
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';

  return { type: 'skill', name, description, body };
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse<GenerateResult>>> {
  let body: GenerateRequestBody;
  try {
    body = (await request.json()) as GenerateRequestBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, description } = body;

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return NextResponse.json({ success: false, error: 'Description is required' }, { status: 400 });
  }

  if (!type || !['workflow', 'agent', 'skill'].includes(type)) {
    return NextResponse.json(
      { success: false, error: 'Type must be "workflow", "agent", or "skill"' },
      { status: 400 },
    );
  }

  let prompt: string;
  switch (type) {
    case 'workflow':
      prompt = buildWorkflowPrompt(description, body.agents ?? [], body.skills ?? []);
      break;
    case 'agent':
      prompt = buildAgentPrompt(description);
      break;
    case 'skill':
      prompt = buildSkillPrompt(description);
      break;
  }

  const result = await callClaude(prompt);

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'Claude CLI failed' },
      { status: 502 },
    );
  }

  try {
    let parsed: GenerateResult;
    switch (type) {
      case 'workflow':
        parsed = parseWorkflowOutput(result.output);
        break;
      case 'agent':
        parsed = parseAgentOutput(result.output);
        break;
      case 'skill':
        parsed = parseSkillOutput(result.output);
        break;
    }

    return NextResponse.json({ success: true, data: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse Claude output';
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}

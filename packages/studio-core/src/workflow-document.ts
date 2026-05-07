import yaml from 'js-yaml';
import { computeLevelsFromDepsMap } from './topology';

interface WorkflowNodeRecord {
  readonly id: string;
  readonly agent: string;
  readonly task: string;
  readonly depends_on?: readonly string[];
  readonly roundtrip?: readonly string[];
  readonly checkpoint?: boolean;
  readonly skills?: readonly string[];
  readonly mcp_servers?: readonly string[];
}

interface WorkflowRecord {
  readonly name?: string;
  readonly description?: string;
  readonly version?: number;
  readonly nodes: readonly WorkflowNodeRecord[];
}

const YAML_BLOCK_RE = /```(?:yaml|yml)\s*\n([\s\S]*?)```/gi;
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function asWorkflowRecord(value: unknown): WorkflowRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const nodesRaw = record.nodes;
  if (!Array.isArray(nodesRaw)) {
    return null;
  }

  const nodes: WorkflowNodeRecord[] = [];
  for (const nodeRaw of nodesRaw) {
    if (!nodeRaw || typeof nodeRaw !== 'object' || Array.isArray(nodeRaw)) {
      return null;
    }
    const node = nodeRaw as Record<string, unknown>;
    if (typeof node.id !== 'string' || typeof node.agent !== 'string' || typeof node.task !== 'string') {
      return null;
    }

    nodes.push({
      id: node.id,
      agent: node.agent,
      task: node.task,
      depends_on: isStringArray(node.depends_on) ? node.depends_on : undefined,
      roundtrip: isStringArray(node.roundtrip) ? node.roundtrip : undefined,
      checkpoint: typeof node.checkpoint === 'boolean' ? node.checkpoint : undefined,
      skills: isStringArray(node.skills) ? node.skills : undefined,
      mcp_servers: isStringArray(node.mcp_servers) ? node.mcp_servers : undefined,
    });
  }

  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    version: typeof record.version === 'number' ? record.version : undefined,
    nodes,
  };
}

function parseYamlCandidate(content: string): WorkflowRecord | null {
  try {
    const parsed = yaml.load(content);
    return asWorkflowRecord(parsed);
  } catch {
    return null;
  }
}

function buildWorkflowYaml(workflow: WorkflowRecord): string {
  const doc = {
    name: workflow.name ?? 'unnamed-workflow',
    description: workflow.description ?? '',
    version: workflow.version ?? 1,
    nodes: workflow.nodes.map((node) => {
      const out: Record<string, unknown> = {
        id: node.id,
        agent: node.agent,
        task: node.task,
      };
      if (node.depends_on && node.depends_on.length > 0) out.depends_on = [...node.depends_on];
      if (node.roundtrip && node.roundtrip.length > 0) out.roundtrip = [...node.roundtrip];
      if (node.checkpoint) out.checkpoint = true;
      if (node.skills && node.skills.length > 0) out.skills = [...node.skills];
      if (node.mcp_servers && node.mcp_servers.length > 0) out.mcp_servers = [...node.mcp_servers];
      return out;
    }),
  };

  return yaml.dump(doc, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();
}

function computePhases(workflow: WorkflowRecord): readonly (readonly WorkflowNodeRecord[])[] {
  const nodesById = new Map<string, WorkflowNodeRecord>();
  for (const node of workflow.nodes) {
    nodesById.set(node.id, node);
  }

  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const depsMap = new Map<string, readonly string[]>();

  for (const node of workflow.nodes) {
    const deps = [
      ...(node.depends_on ?? []),
      ...(node.roundtrip ?? []),
    ].filter((dep) => nodeIds.has(dep));
    depsMap.set(node.id, deps);
  }

  const levels = computeLevelsFromDepsMap(nodeIds, depsMap);
  return levels.map((levelIds) => levelIds
    .map((id) => nodesById.get(id))
    .filter((node): node is WorkflowNodeRecord => Boolean(node)));
}

function formatList(items: readonly string[] | undefined): string {
  return items && items.length > 0 ? items.map((item) => `\`${item}\``).join(', ') : 'None';
}

export function parseWorkflowDocument(content: string): WorkflowRecord | null {
  const direct = parseYamlCandidate(content);
  if (direct) {
    return direct;
  }

  // Reset shared regex state before each parse attempt. Without this, repeated
  // calls can produce alternating pass/fail results due to stale lastIndex.
  YAML_BLOCK_RE.lastIndex = 0;
  let yamlBlockMatch: RegExpExecArray | null;
  while ((yamlBlockMatch = YAML_BLOCK_RE.exec(content)) !== null) {
    const fromBlock = parseYamlCandidate(yamlBlockMatch[1]);
    if (fromBlock) {
      YAML_BLOCK_RE.lastIndex = 0;
      return fromBlock;
    }
  }
  YAML_BLOCK_RE.lastIndex = 0;

  const fmMatch = content.match(FRONTMATTER_RE);
  if (fmMatch) {
    const fromFrontmatter = parseYamlCandidate(fmMatch[1]);
    if (fromFrontmatter) {
      return fromFrontmatter;
    }
  }

  return null;
}

export function formatWorkflowDocument(input: string | Record<string, unknown>): string {
  const workflow = typeof input === 'string'
    ? parseWorkflowDocument(input)
    : asWorkflowRecord(input);

  if (!workflow) {
    if (typeof input === 'string') {
      return input;
    }
    throw new Error('Invalid workflow object for formatting');
  }

  const workflowName = workflow.name ?? 'unnamed-workflow';
  const workflowDescription = workflow.description ?? '';
  const phases = computePhases(workflow);
  const canonicalYaml = buildWorkflowYaml(workflow);

  const lines: string[] = [];
  lines.push(`# Workflow: ${workflowName}`);
  lines.push('');
  if (workflowDescription.trim()) {
    lines.push(workflowDescription.trim());
    lines.push('');
  }
  lines.push('## Execution Plan');
  lines.push('');
  lines.push(`- Total phases: ${phases.length}`);
  lines.push(`- Total nodes: ${workflow.nodes.length}`);
  lines.push('- Parallel nodes are grouped in the same phase.');
  lines.push('');

  phases.forEach((phaseNodes, index) => {
    const phaseTitle = phaseNodes.length === 1
      ? phaseNodes[0].id
      : `${phaseNodes.length} parallel nodes`;
    lines.push(`## Phase ${index + 1}: ${phaseTitle}`);
    lines.push('');
    for (const node of phaseNodes) {
      lines.push(`- **Node**: \`${node.id}\``);
      lines.push(`  - Agent: \`${node.agent}\``);
      lines.push(`  - Task: ${node.task}`);
      lines.push(`  - Depends On: ${formatList(node.depends_on)}`);
      lines.push(`  - Checkpoint: ${node.checkpoint ? 'Yes' : 'No'}`);
      lines.push(`  - Skills: ${formatList(node.skills)}`);
      lines.push(`  - MCP Servers: ${formatList(node.mcp_servers)}`);
    }
    lines.push('');
  });

  lines.push('## Canonical Workflow YAML');
  lines.push('');
  lines.push('```yaml');
  lines.push(canonicalYaml);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

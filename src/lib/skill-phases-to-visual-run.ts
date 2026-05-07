import type { Resource } from '@/types/resources';
import type { VisualWorkflowEdge, VisualWorkflowRun } from '@/types/visual-workflow';

interface PhaseRecord {
  readonly phase_id?: unknown;
  readonly id?: unknown;
  readonly agent?: unknown;
  readonly tool?: unknown;
  readonly instructions?: unknown;
  readonly cwd_ref?: unknown;
  readonly profile?: unknown;
  readonly parallel_group?: unknown;
  readonly checkpoint_model?: unknown;
  readonly depends_on?: unknown;
  readonly dependencies?: unknown;
}

interface StaticPhase {
  readonly id: string;
  readonly agent?: string;
  readonly tool?: string;
  readonly task?: string;
  readonly cwdRef?: string;
  readonly profile?: string;
  readonly parallelGroup?: string;
  readonly checkpoint?: boolean;
  readonly dependsOn?: readonly string[];
}

export function skillResourceToVisualRun(resource: Resource | null): VisualWorkflowRun | null {
  if (!resource || resource.type !== 'skills') return null;
  const phasesRaw = resource.frontmatter?.phases;
  if (!Array.isArray(phasesRaw)) return null;

  const phases = phasesRaw
    .map((phase): StaticPhase | null => {
      if (!phase || typeof phase !== 'object' || Array.isArray(phase)) return null;
      const record = phase as PhaseRecord;
      const id = asString(record.phase_id) ?? asString(record.id);
      if (!id) return null;
      return {
        id,
        agent: asString(record.agent),
        tool: asString(record.tool),
        task: instructionsToTask(record.instructions),
        cwdRef: asString(record.cwd_ref),
        profile: asString(record.profile),
        parallelGroup: asString(record.parallel_group),
        checkpoint: typeof record.checkpoint_model === 'string' && record.checkpoint_model.length > 0,
        dependsOn: asStringArray(record.depends_on) ?? asStringArray(record.dependencies),
      };
    })
    .filter((phase): phase is StaticPhase => phase !== null);

  if (phases.length === 0) return null;

  return {
    runId: resource.name,
    runRoot: resource.path,
    source: 'skill-phases',
    status: 'pending',
    nodes: phases.map((phase) => ({
      id: phase.id,
      label: phase.id,
      agent: phase.agent,
      tool: phase.tool,
      task: phase.task,
      status: 'pending',
      cwdRef: phase.cwdRef,
      profile: phase.profile,
      parallelGroup: phase.parallelGroup,
      checkpoint: phase.checkpoint,
    })),
    edges: deriveEdges(phases),
    definitionPath: resource.path,
    updatedAt: resource.modifiedAt,
  };
}

function deriveEdges(phases: readonly StaticPhase[]): readonly VisualWorkflowEdge[] {
  const explicit = phases.flatMap((phase) =>
    (phase.dependsOn ?? []).map((dep) => ({
      id: `dispatch:${dep}->${phase.id}`,
      source: dep,
      target: phase.id,
      type: 'dispatch' as const,
    })),
  );
  if (explicit.length > 0) return explicit;

  const groups: string[][] = [];
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index];
    if (!phase.parallelGroup) {
      groups.push([phase.id]);
      continue;
    }
    const group = [phase.id];
    let cursor = index + 1;
    while (cursor < phases.length && phases[cursor].parallelGroup === phase.parallelGroup) {
      group.push(phases[cursor].id);
      cursor++;
    }
    groups.push(group);
    index = cursor - 1;
  }

  const edges: VisualWorkflowEdge[] = [];
  for (let index = 1; index < groups.length; index++) {
    for (const source of groups[index - 1]) {
      for (const target of groups[index]) {
        edges.push({ id: `dispatch:${source}->${target}`, source, target, type: 'dispatch' });
      }
    }
  }
  return edges;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function instructionsToTask(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const lines = value.filter((item): item is string => typeof item === 'string');
  return lines.length > 0 ? lines.join('\n') : undefined;
}

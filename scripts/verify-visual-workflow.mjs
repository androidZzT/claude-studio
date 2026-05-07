import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readVisualRunArtifact,
  readVisualRunTrace,
  readVisualWorkflowRun,
  readVisualWorkflowRuns,
} from '../packages/studio-core/dist/index.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-studio-visual-'));
const projectPath = path.join(root, 'project');
const skillDir = path.join(projectPath, 'skills', 'compound', 'demo-skill');
const runRoot = path.join(projectPath, '.harness', 'runs', 'demo-run');

await fs.mkdir(skillDir, { recursive: true });
await fs.mkdir(path.join(runRoot, 'phases', 'phase-a'), { recursive: true });
await fs.mkdir(path.join(runRoot, 'phases', 'phase-b'), { recursive: true });
await fs.mkdir(path.join(runRoot, 'phases', 'phase-c'), { recursive: true });
await fs.mkdir(path.join(runRoot, 'phases', 'phase-d'), { recursive: true });
await fs.mkdir(path.join(runRoot, 'trajectory', 'phase-c'), { recursive: true });
await fs.mkdir(path.join(runRoot, 'validation', 'phase-c'), { recursive: true });
await fs.mkdir(path.join(runRoot, 'rollback', 'phase-c'), { recursive: true });

const skillPath = path.join(skillDir, 'SKILL.md');
await fs.writeFile(skillPath, `---
name: demo-skill
phases:
  - phase_id: phase-a
    agent: architect
    tool: codex
    instructions:
      - design
  - phase_id: phase-b
    agent: planner
    tool: codex
    instructions:
      - plan
  - phase_id: phase-c
    agent: android-coder
    tool: codex
    parallel_group: platform
    instructions:
      - android
  - phase_id: phase-d
    agent: ios-coder
    tool: codex
    parallel_group: platform
    instructions:
      - ios
---
# Demo
`, 'utf-8');

await fs.writeFile(path.join(runRoot, 'run.json'), JSON.stringify({ run_id: 'demo-run', thread_id: 'demo-run' }, null, 2));
await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({ run_id: 'demo-run', status: 'paused', started_at_iso: '2026-01-01T00:00:00.000Z' }, null, 2));
await fs.writeFile(path.join(runRoot, 'phase_graph.json'), JSON.stringify([
  { index: 0, phase_id: 'phase-a', agent: 'architect', tool: 'codex', cwd_ref: 'target:app', mode: 'plan', required_artifacts: ['docs/design.md'] },
  { index: 1, phase_id: 'phase-b', agent: 'planner', tool: 'codex', cwd_ref: 'target:app', mode: 'auto' },
  { index: 2, phase_id: 'phase-c', agent: 'android-coder', tool: 'codex', cwd_ref: 'target:android', mode: 'auto', parallel_group: 'platform', trajectory_capture: true },
  { index: 3, phase_id: 'phase-d', agent: 'ios-coder', tool: 'codex', cwd_ref: 'target:ios', mode: 'auto', parallel_group: 'platform', trajectory_capture: false },
], null, 2));
await fs.writeFile(path.join(runRoot, 'task-card.json'), JSON.stringify({ goal: 'ship demo', risk_level: 'medium' }, null, 2));
await fs.writeFile(path.join(runRoot, 'task-card.sha256'), 'hash-demo\n', 'utf-8');
await fs.writeFile(path.join(runRoot, 'run-family.json'), JSON.stringify({
  run_id: 'demo-run',
  thread_id: 'demo-run',
  task_card_hash: 'hash-demo',
  runs: [{ run_id: 'demo-run', thread_id: 'demo-run', run_root: runRoot, status: 'paused' }],
}, null, 2));
await fs.writeFile(path.join(runRoot, 'events.jsonl'), [
  { ts: '2026-01-01T00:00:01.000Z', kind: 'phase_start', phase_id: 'phase-a', payload: { agent: 'architect', tool: 'codex' } },
  { ts: '2026-01-01T00:00:02.000Z', kind: 'phase_end', phase_id: 'phase-a', payload: { status: 'completed', exit_code: 0, duration_ms: 1000 } },
  { ts: '2026-01-01T00:00:03.000Z', kind: 'phase_start', phase_id: 'phase-b', payload: { agent: 'planner', tool: 'codex' } },
  { ts: '2026-01-01T00:00:04.000Z', kind: 'phase_end', phase_id: 'phase-b', payload: { status: 'completed', exit_code: 0, duration_ms: 1000 } },
  { ts: '2026-01-01T00:00:05.000Z', kind: 'phase_start', phase_id: 'phase-c', payload: { agent: 'android-coder', tool: 'codex' } },
  { ts: '2026-01-01T00:00:05.000Z', kind: 'phase_start', phase_id: 'phase-d', payload: { agent: 'ios-coder', tool: 'codex' } },
  { ts: '2026-01-01T00:00:06.000Z', kind: 'phase_end', phase_id: 'phase-c', payload: { status: 'failed', exit_code: 1, duration_ms: 1000, audit_blocked: true } },
  { ts: '2026-01-01T00:00:06.000Z', kind: 'phase_end', phase_id: 'phase-d', payload: { status: 'completed', exit_code: 0, duration_ms: 1000 } },
].map((event) => JSON.stringify(event)).join('\n') + '\n');

for (const phaseId of ['phase-a', 'phase-b', 'phase-c', 'phase-d']) {
  const phaseRoot = path.join(runRoot, 'phases', phaseId);
  await fs.writeFile(path.join(phaseRoot, 'prompt.md'), `prompt for ${phaseId}`, 'utf-8');
  await fs.writeFile(path.join(phaseRoot, 'stdout.log'), `stdout for ${phaseId}`, 'utf-8');
  await fs.writeFile(path.join(phaseRoot, 'stderr.log'), phaseId === 'phase-c' ? 'blocked by audit' : '', 'utf-8');
  await fs.writeFile(path.join(phaseRoot, 'exit_code.json'), JSON.stringify({
    phase_id: phaseId,
    status: phaseId === 'phase-c' ? 'failed' : 'completed',
    exit_code: phaseId === 'phase-c' ? 1 : 0,
    audit_blocked: phaseId === 'phase-c',
    duration_ms: 1000,
    ...(phaseId === 'phase-c' ? {
      prompt_sha256: 'prompt-hash-c',
      provider_stall_detail: 'reconnect exhausted',
      reason: 'provider_stalled',
    } : {}),
  }, null, 2));
}

await fs.writeFile(path.join(runRoot, 'phases', 'phase-c', 'result.json'), JSON.stringify({
  changed_files: ['app/src/main.kt'],
  commands_run: ['npm test'],
  next_action: 'stop_and_review',
  risk_flags: ['provider_stalled'],
  status: 'BLOCKED',
  summary: 'Android implementation needs review.',
  tests: [{ command: 'npm test', status: 'fail' }],
}, null, 2));
await fs.writeFile(path.join(runRoot, 'phases', 'phase-c', 'cost.json'), JSON.stringify({ dollars: 0.12, model: 'gpt-demo' }, null, 2));
await fs.writeFile(path.join(runRoot, 'validation', 'phase-c', 'result-schema.json'), JSON.stringify({ phase_id: 'phase-c', status: 'critical', critical_count: 1 }, null, 2));
await fs.writeFile(path.join(runRoot, 'validation', 'phase-c', 'budget.json'), JSON.stringify({ phase_id: 'phase-c', status: 'pass', critical_count: 0 }, null, 2));
await fs.writeFile(path.join(runRoot, 'validation', 'phase-c', 'risk.json'), JSON.stringify({ phase_id: 'phase-c', status: 'escalate', critical_count: 1 }, null, 2));
await fs.writeFile(path.join(runRoot, 'rollback', 'phase-c', 'rollback.md'), '# Rollback\nInspect baseline diff.', 'utf-8');
await fs.writeFile(path.join(runRoot, 'rollback', 'phase-c', 'baseline.diff'), 'diff --git a/demo b/demo', 'utf-8');

await fs.writeFile(path.join(runRoot, 'trajectory', 'phase-c', 'summary.json'), JSON.stringify({
  phase_id: 'phase-c',
  status: 'captured',
  event_count: 3,
  tool_call_count: 1,
  skill_use_count: 1,
}, null, 2));
await fs.writeFile(path.join(runRoot, 'trajectory', 'phase-c', 'events.jsonl'), [
  { event_id: '1', phase_id: 'phase-c', sequence: 1, kind: 'user_prompt', text: 'implement android' },
  { event_id: '2', phase_id: 'phase-c', sequence: 2, kind: 'tool_call', name: 'exec_command', input: { cmd: 'test' } },
  { event_id: '3', phase_id: 'phase-c', sequence: 3, kind: 'skill_use', name: 'android-skill' },
].map((event) => JSON.stringify(event)).join('\n') + '\n');

const runs = await readVisualWorkflowRuns(projectPath);
assert.equal(runs.length, 1);
assert.equal(runs[0].runId, 'demo-run');
assert.equal(runs[0].nodeCount, 4);
assert.equal(runs[0].status, 'blocked');

const run = await readVisualWorkflowRun(projectPath, 'demo-run');
assert.equal(run.nodes.length, 4);
assert.equal(run.edges.length, 3);
const phaseC = run.nodes.find((node) => node.id === 'phase-c');
assert.equal(phaseC?.status, 'blocked');
assert.equal(phaseC?.mode, 'auto');
assert.equal(phaseC?.reason, 'provider_stalled');
assert.equal(phaseC?.providerStallDetail, 'reconnect exhausted');
assert.equal(phaseC?.promptSha256, 'prompt-hash-c');
assert.equal(phaseC?.validation?.resultStatus, 'critical');
assert.equal(phaseC?.validation?.budgetStatus, 'pass');
assert.equal(phaseC?.validation?.riskStatus, 'escalate');
assert.ok(phaseC?.resultPath?.endsWith('result.json'));
assert.ok(phaseC?.rollbackPath?.endsWith('rollback.md'));
assert.equal(run.nodes.find((node) => node.id === 'phase-d')?.status, 'succeeded');
assert.equal(run.runFamily?.runCount, 1);
assert.equal(run.runFamily?.taskCardHash, 'hash-demo');
assert.ok(run.edges.some((edge) => edge.source === 'phase-b' && edge.target === 'phase-c'));
assert.ok(run.edges.some((edge) => edge.source === 'phase-b' && edge.target === 'phase-d'));

const artifact = await readVisualRunArtifact(projectPath, 'demo-run', 'phase-c', 'prompt');
assert.equal(artifact.content, 'prompt for phase-c');
const resultArtifact = await readVisualRunArtifact(projectPath, 'demo-run', 'phase-c', 'result');
assert.ok(resultArtifact.content.includes('Android implementation needs review.'));
const runFamilyArtifact = await readVisualRunArtifact(projectPath, 'demo-run', undefined, 'run-family');
assert.ok(runFamilyArtifact.content.includes('hash-demo'));

const trace = await readVisualRunTrace(projectPath, 'demo-run', 'phase-c');
assert.equal(trace.missing, false);
assert.equal(trace.events.length, 3);
assert.ok(trace.events.some((event) => event.kind === 'tool_call'));
assert.ok(trace.events.some((event) => event.kind === 'skill_use'));

await fs.rm(root, { recursive: true, force: true });
console.log('visual workflow verification passed');

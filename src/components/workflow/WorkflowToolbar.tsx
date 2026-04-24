'use client';

import { useCallback } from 'react';
import { FileOutput, Save, Rocket, Square, Wand2 } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import { flowToWorkflow, workflowToYaml } from '@/lib/flow-to-workflow';
import type { DagNodeData } from '@/lib/workflow-to-flow';

interface WorkflowToolbarProps {
  readonly workflowName: string;
  readonly workflowDescription: string;
  readonly onNameChange: (name: string) => void;
  readonly onDescriptionChange: (description: string) => void;
  readonly nodes: readonly Node<DagNodeData>[];
  readonly edges: readonly Edge[];
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly executing: boolean;
  readonly simulate: boolean;
  readonly onSimulateChange: (simulate: boolean) => void;
  readonly onSave: () => void;
  readonly onRun: () => void;
  readonly onCancelRun: () => void;
  readonly onGenerateOpen: () => void;
}

function downloadBlob(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]/g, '-') || 'workflow';
}

export function WorkflowToolbar({
  workflowName,
  workflowDescription,
  onNameChange,
  onDescriptionChange,
  nodes,
  edges,
  dirty,
  saving,
  executing,
  simulate,
  onSimulateChange,
  onSave,
  onRun,
  onCancelRun,
  onGenerateOpen,
}: WorkflowToolbarProps) {
  const handleExport = useCallback(() => {
    if (nodes.length === 0) return;
    const wf = flowToWorkflow(
      workflowName || 'workflow',
      workflowDescription,
      nodes,
      edges,
    );
    const yamlContent = workflowToYaml(wf);
    const filename = `${sanitizeFilename(workflowName)}.md`;
    downloadBlob(yamlContent, filename);
  }, [workflowName, workflowDescription, nodes, edges]);

  const btnBase =
    'rounded px-3 py-0.5 text-xs transition-colors bg-surface text-foreground hover:bg-surface-hover border border-border';
  const btnDisabled =
    'rounded px-3 py-0.5 text-xs bg-surface text-muted cursor-not-allowed';

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
      <input
        type="text"
        value={workflowName}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Workflow name"
        className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
      />
      <input
        type="text"
        value={workflowDescription}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="Description (optional)"
        className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
      />
      <span className="text-[10px] text-muted">
        {nodes.length} nodes
      </span>

      {/* Generate */}
      <button
        onClick={onGenerateOpen}
        disabled={executing}
        className={!executing ? btnBase : btnDisabled}
        title="Generate workflow from description"
      >
        <span className="flex items-center gap-1"><Wand2 size={12} /> Generate</span>
      </button>

      {/* Export */}
      <button
        onClick={handleExport}
        disabled={nodes.length === 0}
        className={nodes.length > 0 ? btnBase : btnDisabled}
        title="Export workflow as Markdown (YAML content)"
      >
        <span className="flex items-center gap-1"><FileOutput size={12} /> Export</span>
      </button>

      {/* Simulate / Live toggle */}
      <button
        onClick={() => onSimulateChange(!simulate)}
        disabled={executing}
        className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors border ${
          simulate
            ? 'border-border bg-surface text-muted hover:bg-surface-hover'
            : 'border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
        } ${executing ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={simulate ? 'Simulate mode: fake delays, no real execution' : 'Live mode: executes claude -p for each node'}
      >
        {simulate ? 'Simulate' : 'Live'}
      </button>

      {/* Run */}
      <button
        onClick={executing ? onCancelRun : onRun}
        disabled={nodes.length === 0}
        className={`rounded px-3 py-0.5 text-xs transition-colors ${
          executing
            ? 'bg-red-500/80 text-white hover:bg-red-500'
            : nodes.length > 0
              ? simulate
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'bg-amber-600 text-white hover:bg-amber-500'
              : 'bg-surface text-muted cursor-not-allowed'
        }`}
      >
        <span className="flex items-center gap-1">
          {executing ? <><Square size={12} /> Stop</> : <><Rocket size={12} /> {simulate ? 'Run' : 'Run Live'}</>}
        </span>
      </button>

      {/* Save */}
      <button
        onClick={onSave}
        disabled={!dirty || saving || !workflowName.trim()}
        className={`rounded px-3 py-0.5 text-xs transition-colors ${
          dirty && workflowName.trim()
            ? 'bg-accent text-white hover:bg-accent-hover'
            : 'bg-surface text-muted cursor-not-allowed'
        }`}
      >
        <span className="flex items-center gap-1">
          <Save size={12} />
          {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
        </span>
      </button>
    </div>
  );
}

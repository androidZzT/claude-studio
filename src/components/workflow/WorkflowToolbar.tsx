'use client';

import { useCallback, useRef } from 'react';
import { Play, Square, Download, Upload, LayoutGrid, Save, Rocket, Wand2 } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import { flowToWorkflow, workflowToYaml } from '@/lib/flow-to-workflow';
import { validateWorkflow } from '@/lib/workflow-validation';
import { workflowToFlow } from '@/lib/workflow-to-flow';
import type { DagNodeData } from '@/lib/workflow-to-flow';
import type { Workflow } from '@/types/resources';

interface PreviewState {
  readonly previewing: boolean;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly startPreview: () => void;
  readonly stopPreview: () => void;
}

interface WorkflowToolbarProps {
  readonly workflowName: string;
  readonly workflowDescription: string;
  readonly onNameChange: (name: string) => void;
  readonly onDescriptionChange: (description: string) => void;
  readonly nodes: readonly Node<DagNodeData>[];
  readonly edges: readonly Edge[];
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly preview: PreviewState;
  readonly executing: boolean;
  readonly onSave: () => void;
  readonly onImport: (nodes: Node<DagNodeData>[], edges: Edge[]) => void;
  readonly onAutoLayout: () => void;
  readonly onRun: () => void;
  readonly onCancelRun: () => void;
  readonly onGenerateOpen: () => void;
}

function downloadBlob(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/x-yaml' });
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
  preview,
  executing,
  onSave,
  onImport,
  onAutoLayout,
  onRun,
  onCancelRun,
  onGenerateOpen,
}: WorkflowToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    if (nodes.length === 0) return;
    const wf = flowToWorkflow(
      workflowName || 'workflow',
      workflowDescription,
      nodes,
      edges,
    );
    const yamlContent = workflowToYaml(wf);
    const filename = `${sanitizeFilename(workflowName)}.yaml`;
    downloadBlob(yamlContent, filename);
  }, [workflowName, workflowDescription, nodes, edges]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const text = reader.result as string;
        try {
          const yaml = await import('js-yaml');
          const parsed = yaml.load(text) as unknown;
          const validation = validateWorkflow(parsed);
          if (!validation.valid) {
            window.alert(
              `Invalid workflow:\n${validation.errors.join('\n')}`,
            );
            return;
          }
          const wf = parsed as Workflow;
          const flow = workflowToFlow(wf);
          onImport(flow.nodes, flow.edges);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unknown parse error';
          window.alert(`Failed to parse YAML:\n${message}`);
        }
      };
      reader.readAsText(file);

      // Reset input so the same file can be re-imported
      event.target.value = '';
    },
    [onImport],
  );

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
        {preview.previewing && (
          <span className="ml-1 text-accent">
            Step{' '}
            {Math.min(preview.currentStep + 1, preview.totalSteps)}/
            {preview.totalSteps}
          </span>
        )}
      </span>

      {/* Generate */}
      <button
        onClick={onGenerateOpen}
        disabled={preview.previewing || executing}
        className={!preview.previewing && !executing ? btnBase : btnDisabled}
        title="Generate workflow from description"
      >
        <span className="flex items-center gap-1"><Wand2 size={12} /> Generate</span>
      </button>

      {/* Export */}
      <button
        onClick={handleExport}
        disabled={nodes.length === 0 || preview.previewing}
        className={nodes.length > 0 && !preview.previewing ? btnBase : btnDisabled}
        title="Export workflow as YAML"
      >
        <span className="flex items-center gap-1"><Download size={12} /> Export</span>
      </button>

      {/* Import */}
      <button
        onClick={handleImportClick}
        disabled={preview.previewing}
        className={!preview.previewing ? btnBase : btnDisabled}
        title="Import workflow from YAML"
      >
        <span className="flex items-center gap-1"><Upload size={12} /> Import</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Auto-layout */}
      <button
        onClick={onAutoLayout}
        disabled={nodes.length === 0 || preview.previewing}
        className={nodes.length > 0 && !preview.previewing ? btnBase : btnDisabled}
        title="Auto-arrange node layout"
      >
        <span className="flex items-center gap-1"><LayoutGrid size={12} /> Layout</span>
      </button>

      {/* Run */}
      <button
        onClick={executing ? onCancelRun : onRun}
        disabled={nodes.length === 0 || preview.previewing}
        className={`rounded px-3 py-0.5 text-xs transition-colors ${
          executing
            ? 'bg-red-500/80 text-white hover:bg-red-500'
            : nodes.length > 0 && !preview.previewing
              ? 'bg-emerald-600 text-white hover:bg-emerald-500'
              : 'bg-surface text-muted cursor-not-allowed'
        }`}
      >
        <span className="flex items-center gap-1">
          {executing ? <><Square size={12} /> Stop</> : <><Rocket size={12} /> Run</>}
        </span>
      </button>

      {/* Preview */}
      <button
        onClick={preview.previewing ? preview.stopPreview : preview.startPreview}
        disabled={nodes.length === 0 || executing}
        className={`rounded px-3 py-0.5 text-xs transition-colors ${
          preview.previewing
            ? 'bg-red-500/80 text-white hover:bg-red-500'
            : nodes.length > 0 && !executing
              ? 'bg-surface text-foreground hover:bg-surface-hover border border-border'
              : 'bg-surface text-muted cursor-not-allowed'
        }`}
      >
        <span className="flex items-center gap-1">
          {preview.previewing ? <><Square size={12} /> Stop</> : <><Play size={12} /> Preview</>}
        </span>
      </button>

      {/* Save */}
      <button
        onClick={onSave}
        disabled={!dirty || saving || !workflowName.trim() || preview.previewing}
        className={`rounded px-3 py-0.5 text-xs transition-colors ${
          dirty && workflowName.trim() && !preview.previewing
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

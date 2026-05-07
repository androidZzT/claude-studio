'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Copy, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { ApiResponse } from '@/types/resources';
import type {
  VisualNodeStatus,
  VisualRunArtifact,
  VisualTraceEvent,
  VisualTraceResult,
  VisualWorkflowNode,
  VisualWorkflowRun,
} from '@/types/visual-workflow';

interface VisualRunInspectorProps {
  readonly projectId: string | null;
  readonly run: VisualWorkflowRun;
  readonly selectedNodeId: string | null;
}

type InspectorTab = 'overview' | 'prompt' | 'trace' | 'logs' | 'artifacts';
type LogKind = 'stdout' | 'stderr' | 'output';
type TraceFilter = 'all' | 'prompt' | 'assistant' | 'tool' | 'skill' | 'tokens' | 'error';

export function VisualRunInspector({ projectId, run, selectedNodeId }: VisualRunInspectorProps) {
  const selectedNode = useMemo(
    () => run.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [run.nodes, selectedNodeId],
  );
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');
  const [logKind, setLogKind] = useState<LogKind>('stdout');
  const [traceFilter, setTraceFilter] = useState<TraceFilter>('all');
  const [artifact, setArtifact] = useState<VisualRunArtifact | null>(null);
  const [trace, setTrace] = useState<VisualTraceResult | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLoadRuntimeFiles = run.source === 'harness-run' && Boolean(projectId && selectedNode);

  useEffect(() => {
    setActiveTab('overview');
    setArtifact(null);
    setTrace(null);
    setError(null);
  }, [run.runId, selectedNodeId]);

  const loadArtifact = useCallback(async (kind: string) => {
    if (!canLoadRuntimeFiles || !projectId || !selectedNode) return;
    setLoadingArtifact(true);
    setError(null);
    try {
      const params = new URLSearchParams({ phaseId: selectedNode.id, kind });
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/visual-runs/${encodeURIComponent(run.runId)}/artifact?${params}`,
      );
      const json = await res.json() as ApiResponse<VisualRunArtifact>;
      if (!json.success || !json.data) {
        setError(json.error ?? 'Failed to load artifact');
        setArtifact(null);
        return;
      }
      setArtifact(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artifact');
      setArtifact(null);
    } finally {
      setLoadingArtifact(false);
    }
  }, [canLoadRuntimeFiles, projectId, run.runId, selectedNode]);

  const loadTrace = useCallback(async () => {
    if (!canLoadRuntimeFiles || !projectId || !selectedNode) return;
    setLoadingTrace(true);
    setError(null);
    try {
      const params = new URLSearchParams({ phaseId: selectedNode.id, maxEvents: '800' });
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/visual-runs/${encodeURIComponent(run.runId)}/trace?${params}`,
      );
      const json = await res.json() as ApiResponse<VisualTraceResult>;
      if (!json.success || !json.data) {
        setError(json.error ?? 'Failed to load trace');
        setTrace(null);
        return;
      }
      setTrace(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trace');
      setTrace(null);
    } finally {
      setLoadingTrace(false);
    }
  }, [canLoadRuntimeFiles, projectId, run.runId, selectedNode]);

  useEffect(() => {
    if (activeTab === 'prompt') void loadArtifact('prompt');
  }, [activeTab, loadArtifact]);

  useEffect(() => {
    if (activeTab === 'logs') void loadArtifact(logKind);
  }, [activeTab, logKind, loadArtifact]);

  useEffect(() => {
    if (activeTab === 'trace') void loadTrace();
  }, [activeTab, loadTrace]);

  const filteredTraceEvents = useMemo(() => {
    const events = trace?.events ?? [];
    if (traceFilter === 'all') return events;
    return events.filter((event) => matchesTraceFilter(event, traceFilter));
  }, [trace?.events, traceFilter]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          {run.source === 'harness-run' ? 'Run Inspector' : 'Workflow Inspector'}
        </p>
        <h2 className="mt-1 truncate text-sm font-medium text-foreground">
          {selectedNode?.label ?? run.runId}
        </h2>
        <p className="mt-0.5 truncate text-xs text-muted">
          {selectedNode ? selectedNode.agent ?? selectedNode.tool ?? 'phase' : run.runRoot}
        </p>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2">
        {(['overview', 'prompt', 'trace', 'logs', 'artifacts'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            disabled={!selectedNode && tab !== 'overview' && tab !== 'artifacts'}
            className={`rounded px-2 py-1 text-[11px] capitalize transition-colors disabled:opacity-40 ${
              activeTab === tab ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-hover hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {activeTab === 'overview' && <OverviewTab run={run} node={selectedNode} />}
        {activeTab === 'prompt' && (
          <ArtifactBlock
            title="Prompt"
            icon="prompt"
            artifact={artifact}
            loading={loadingArtifact}
            emptyText={canLoadRuntimeFiles ? 'No prompt captured for this phase.' : 'Prompt is only available for harness runs.'}
          />
        )}
        {activeTab === 'trace' && (
          <TraceTab
            trace={trace}
            events={filteredTraceEvents}
            loading={loadingTrace}
            filter={traceFilter}
            onFilterChange={setTraceFilter}
            canLoad={canLoadRuntimeFiles}
          />
        )}
        {activeTab === 'logs' && (
          <LogsTab
            artifact={artifact}
            loading={loadingArtifact}
            logKind={logKind}
            onLogKindChange={setLogKind}
            canLoad={canLoadRuntimeFiles}
          />
        )}
        {activeTab === 'artifacts' && <ArtifactsTab run={run} node={selectedNode} />}
      </div>
    </div>
  );
}

function OverviewTab({ run, node }: { readonly run: VisualWorkflowRun; readonly node: VisualWorkflowNode | null }) {
  if (!node) {
    const counts = countStatuses(run.nodes);
    return (
      <div className="space-y-3 text-xs">
        <StatusCard status={run.status} label="Run status" />
        <KeyValue label="Source" value={run.source} />
        <KeyValue label="Started" value={formatDate(run.startedAt)} />
        <KeyValue label="Completed" value={formatDate(run.completedAt)} />
        <KeyValue label="Updated" value={formatDate(run.updatedAt)} />
        <KeyValue label="Definition" value={run.definitionPath} />
        <KeyValue label="TaskCard" value={run.taskCardPath} />
        <KeyValue label="Run family" value={formatRunFamily(run)} />
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Metric label="Succeeded" value={counts.succeeded} className="text-green-300" />
          <Metric label="Running" value={counts.running} className="text-sky-300" />
          <Metric label="Failed" value={counts.failed} className="text-red-300" />
          <Metric label="Blocked" value={counts.blocked} className="text-amber-300" />
        </div>
      </div>
    );
  }

  const summary = node.trajectorySummary;
  return (
    <div className="space-y-3 text-xs">
      <StatusCard status={node.status} label="Node status" />
      <KeyValue label="Agent" value={node.agent} />
      <KeyValue label="Tool" value={node.tool} />
      <KeyValue label="Mode" value={node.mode} />
      <KeyValue label="Profile" value={node.profile} />
      <KeyValue label="CWD" value={node.cwdRef ?? node.cwd} />
      <KeyValue label="Session" value={node.sessionId} />
      <KeyValue label="Duration" value={formatDuration(node.durationMs)} />
      <KeyValue label="Exit code" value={node.exitCode === undefined ? undefined : String(node.exitCode)} />
      <KeyValue label="Reason" value={node.reason} />
      <KeyValue label="Provider stall" value={node.providerStallDetail} />
      <KeyValue label="Prompt SHA256" value={node.promptSha256} />
      <KeyValue label="TaskCard hash" value={node.taskCardHash} />
      <KeyValue label="Required artifacts" value={formatStringList(node.requiredArtifacts)} />
      <KeyValue label="Trajectory" value={node.trajectoryStatus ?? summary?.status} />
      {node.validation && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          <Metric label="Result" value={node.validation.resultStatus ?? 'n/a'} className={validationClass(node.validation.resultStatus)} />
          <Metric label="Budget" value={node.validation.budgetStatus ?? 'n/a'} className={validationClass(node.validation.budgetStatus)} />
          <Metric label="Risk" value={node.validation.riskStatus ?? 'n/a'} className={validationClass(node.validation.riskStatus)} />
        </div>
      )}
      {node.error && (
        <pre className="max-h-40 overflow-auto rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200 whitespace-pre-wrap">
          {node.error}
        </pre>
      )}
      {summary && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Metric label="Events" value={summary.event_count ?? 0} />
          <Metric label="Tools" value={summary.tool_call_count ?? 0} className="text-sky-300" />
          <Metric label="Skills" value={summary.skill_use_count ?? 0} className="text-emerald-300" />
          <Metric label="Tokens" value={summary.total_tokens ?? 0} />
        </div>
      )}
      {summary?.final_output_preview && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Final output preview</p>
          <p className="rounded border border-border bg-background p-2 text-[11px] leading-relaxed text-foreground/80">
            {summary.final_output_preview}
          </p>
        </div>
      )}
    </div>
  );
}

function ArtifactBlock({
  title,
  artifact,
  loading,
  emptyText,
}: {
  readonly title: string;
  readonly icon: 'prompt' | 'log';
  readonly artifact: VisualRunArtifact | null;
  readonly loading: boolean;
  readonly emptyText: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
          <FileText size={12} /> {title}
        </p>
        {artifact?.truncated && <span className="text-[10px] text-amber-300">Truncated</span>}
      </div>
      {loading ? (
        <p className="text-xs text-muted">Loading...</p>
      ) : artifact?.content ? (
        <pre className="max-h-[calc(100vh-260px)] overflow-auto rounded border border-border bg-background p-2 text-[11px] leading-relaxed text-foreground/85 whitespace-pre-wrap">
          {artifact.content}
        </pre>
      ) : (
        <p className="rounded border border-border bg-background p-3 text-xs text-muted">{emptyText}</p>
      )}
      {artifact?.path && <p className="break-all text-[10px] text-muted/70">{artifact.path}</p>}
    </div>
  );
}

function TraceTab({
  trace,
  events,
  loading,
  filter,
  onFilterChange,
  canLoad,
}: {
  readonly trace: VisualTraceResult | null;
  readonly events: readonly VisualTraceEvent[];
  readonly loading: boolean;
  readonly filter: TraceFilter;
  readonly onFilterChange: (filter: TraceFilter) => void;
  readonly canLoad: boolean;
}) {
  if (!canLoad) {
    return <p className="rounded border border-border bg-background p-3 text-xs text-muted">Trace is only available for harness runs.</p>;
  }
  if (loading) return <p className="text-xs text-muted">Loading trace...</p>;
  if (trace?.missing) {
    return <p className="rounded border border-border bg-background p-3 text-xs text-muted">Trajectory not captured for this phase.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {(['all', 'prompt', 'assistant', 'tool', 'skill', 'tokens', 'error'] as const).map((item) => (
          <button
            key={item}
            onClick={() => onFilterChange(item)}
            className={`rounded px-2 py-1 text-[10px] capitalize ${filter === item ? 'bg-accent/20 text-accent' : 'bg-background text-muted hover:bg-surface-hover'}`}
          >
            {item}
          </button>
        ))}
      </div>
      {events.length === 0 ? (
        <p className="rounded border border-border bg-background p-3 text-xs text-muted">No trace events matched this filter.</p>
      ) : (
        <div className="space-y-2">
          {events.map((event, index) => <TraceEventCard key={event.event_id ?? `${event.kind}-${index}`} event={event} />)}
        </div>
      )}
      {trace?.truncated && <p className="text-[10px] text-amber-300">Only the first events are shown.</p>}
    </div>
  );
}

function LogsTab({
  artifact,
  loading,
  logKind,
  onLogKindChange,
  canLoad,
}: {
  readonly artifact: VisualRunArtifact | null;
  readonly loading: boolean;
  readonly logKind: LogKind;
  readonly onLogKindChange: (kind: LogKind) => void;
  readonly canLoad: boolean;
}) {
  if (!canLoad) {
    return <p className="rounded border border-border bg-background p-3 text-xs text-muted">Logs are only available for harness runs.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(['stdout', 'stderr', 'output'] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => onLogKindChange(kind)}
            className={`rounded px-2 py-1 text-[10px] ${logKind === kind ? 'bg-accent/20 text-accent' : 'bg-background text-muted hover:bg-surface-hover'}`}
          >
            {kind}
          </button>
        ))}
      </div>
      <ArtifactBlock
        title={logKind}
        icon="log"
        artifact={artifact}
        loading={loading}
        emptyText={`No ${logKind} artifact captured for this phase.`}
      />
    </div>
  );
}

function ArtifactsTab({ run, node }: { readonly run: VisualWorkflowRun; readonly node: VisualWorkflowNode | null }) {
  const paths = node
    ? [
        ['Prompt', node.promptPath],
        ['Stdout', node.stdoutPath],
        ['Stderr', node.stderrPath],
        ['Output', node.outputPath],
        ['Partial output', node.partialOutputPath],
        ['Result', node.resultPath],
        ['Cost', node.costPath],
        ['Session', node.sessionPath],
        ['Exit', node.exitCodePath],
        ['Validation result', node.validationResultPath],
        ['Validation budget', node.validationBudgetPath],
        ['Validation risk', node.validationRiskPath],
        ['Rollback', node.rollbackPath],
        ['Rollback baseline', node.rollbackBaselinePath],
        ['Trajectory events', node.trajectoryEventsPath],
        ['Trajectory summary', node.trajectorySummaryPath],
      ] as const
    : [
        ['Run root', run.runRoot],
        ['Definition', run.definitionPath],
        ['Summary', run.summaryPath],
        ['TaskCard', run.taskCardPath],
        ['TaskCard hash', run.taskCardHashPath],
        ['Run family', run.runFamilyPath],
      ] as const;

  return (
    <div className="space-y-2">
      {paths.filter(([, value]) => Boolean(value)).map(([label, value]) => (
        <div key={label} className="rounded border border-border bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
          <p className="mt-1 break-all text-[11px] text-foreground/80">{value}</p>
        </div>
      ))}
      {paths.every(([, value]) => !value) && (
        <p className="rounded border border-border bg-background p-3 text-xs text-muted">No artifact paths recorded.</p>
      )}
    </div>
  );
}

function TraceEventCard({ event }: { readonly event: VisualTraceEvent }) {
  return (
    <div className="rounded border border-border bg-background p-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${traceKindClass(event.kind)}`}>{event.kind}</span>
        <span className="text-[10px] text-muted">{formatDate(event.timestamp)}</span>
      </div>
      {event.name && <p className="mb-1 text-[11px] font-medium text-accent">{event.name}</p>}
      {event.text && <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/80">{event.text}</p>}
      {event.input !== undefined && <JsonPreview label="Input" value={event.input} />}
      {event.output !== undefined && <JsonPreview label="Output" value={event.output} />}
      {event.tokens !== undefined && <p className="mt-1 text-[10px] text-muted">Tokens: {event.tokens.toLocaleString()}</p>}
      {event.error && <p className="mt-1 text-[11px] text-red-300">{event.error}</p>}
    </div>
  );
}

function JsonPreview({ label, value }: { readonly label: string; readonly value: unknown }) {
  return (
    <details className="mt-2">
      <summary className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wider text-muted hover:text-foreground">
        <Copy size={10} /> {label}
      </summary>
      <pre className="mt-1 max-h-44 overflow-auto rounded bg-surface p-2 text-[10px] text-foreground/75 whitespace-pre-wrap">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function StatusCard({ status, label }: { readonly status: VisualNodeStatus; readonly label: string }) {
  const config = statusConfig(status);
  const Icon = config.icon;
  return (
    <div className={`rounded border p-2 ${config.cardClassName}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-sm font-semibold"><Icon size={14} /> {config.label}</p>
    </div>
  );
}

function Metric({ label, value, className = 'text-foreground' }: { readonly label: string; readonly value: number | string; readonly className?: string }) {
  return (
    <div className="rounded border border-border bg-background p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${className}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function KeyValue({ label, value }: { readonly label: string; readonly value: string | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 break-all text-xs text-foreground/80">{value}</p>
    </div>
  );
}

function matchesTraceFilter(event: VisualTraceEvent, filter: TraceFilter): boolean {
  if (filter === 'prompt') return event.kind === 'user_prompt';
  if (filter === 'assistant') return event.kind === 'assistant_message' || event.kind === 'final_output';
  if (filter === 'tool') return event.kind === 'tool_call' || event.kind === 'tool_result';
  if (filter === 'skill') return event.kind === 'skill_use';
  if (filter === 'tokens') return event.kind === 'tokens';
  if (filter === 'error') return event.kind === 'error' || Boolean(event.error);
  return true;
}

function traceKindClass(kind: string): string {
  if (kind === 'tool_call' || kind === 'tool_result') return 'bg-sky-500/15 text-sky-300';
  if (kind === 'skill_use') return 'bg-emerald-500/15 text-emerald-300';
  if (kind === 'error') return 'bg-red-500/15 text-red-300';
  if (kind === 'tokens') return 'bg-slate-500/15 text-slate-300';
  if (kind === 'user_prompt') return 'bg-amber-500/15 text-amber-300';
  return 'bg-accent/15 text-accent';
}

function statusConfig(status: VisualNodeStatus) {
  switch (status) {
    case 'succeeded':
      return { label: 'Succeeded', icon: CheckCircle2, cardClassName: 'border-green-500/30 bg-green-500/10 text-green-300' };
    case 'failed':
      return { label: 'Failed', icon: AlertTriangle, cardClassName: 'border-red-500/30 bg-red-500/10 text-red-300' };
    case 'blocked':
      return { label: 'Blocked', icon: AlertTriangle, cardClassName: 'border-amber-500/30 bg-amber-500/10 text-amber-300' };
    case 'running':
      return { label: 'Running', icon: Activity, cardClassName: 'border-sky-500/30 bg-sky-500/10 text-sky-300' };
    default:
      return { label: status, icon: Clock, cardClassName: 'border-border bg-background text-foreground/80' };
  }
}

function countStatuses(nodes: readonly VisualWorkflowNode[]): Record<'succeeded' | 'running' | 'failed' | 'blocked', number> {
  return {
    succeeded: nodes.filter((node) => node.status === 'succeeded').length,
    running: nodes.filter((node) => node.status === 'running' || node.status === 'queued').length,
    failed: nodes.filter((node) => node.status === 'failed').length,
    blocked: nodes.filter((node) => node.status === 'blocked').length,
  };
}

function formatRunFamily(run: VisualWorkflowRun): string | undefined {
  if (!run.runFamily) return undefined;
  const hash = run.runFamily.taskCardHash ? `, hash=${run.runFamily.taskCardHash}` : '';
  return `${run.runFamily.runCount} run(s)${hash}`;
}

function formatStringList(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(', ') : undefined;
}

function validationClass(status: string | undefined): string {
  if (status === 'pass') return 'text-green-300';
  if (status === 'critical' || status === 'escalate') return 'text-red-300';
  return 'text-foreground';
}

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString();
}

function formatDuration(durationMs: number | undefined): string | undefined {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return undefined;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

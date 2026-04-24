'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  useNodesState,
  useEdgesState,
  type OnConnect,
  addEdge,
  BackgroundVariant,
  type NodeTypes,
  type Node,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutGrid } from 'lucide-react';
import type { Resource, Workflow } from '@/types/resources';
import { apiFetch } from '@/lib/api-client';
import {
  workflowToFlow,
  type DagNodeData,
  type EdgeType,
  type ExecutionNodeStatus,
} from '@/lib/workflow-to-flow';
import {
  nextEdgeType,
  edgeStyle,
  edgeLabel,
  edgeMarkers,
  wouldCreateDispatchCycle,
  syncHandles,
  fixSyncEdgeHandles,
} from '@/lib/edge-utils';
import { flowToWorkflow, workflowToYaml } from '@/lib/flow-to-workflow';
import { workflowToClaudeMdLine } from '@/lib/workflow-to-claudemd';
import { autoLayoutNodes } from '@/lib/auto-layout';
import { isProtectedNode } from '@/lib/workflow-constants';
import { useUndoRedo } from '@/lib/use-undo-history';
import { useCanvasDragDrop } from '@/lib/use-canvas-drag-drop';
import { useContextMenuHandlers } from '@/lib/use-context-menu-handlers';
import { DagNode } from './DagNode';
import { StickyNote } from './StickyNote';
import { CanvasContextMenu } from './CanvasContextMenu';
import { WorkflowToolbar } from './WorkflowToolbar';
import { GenerateModal } from './GenerateModal';
import { generateWorkflow } from '@/lib/workflow-generator';

const nodeTypes: NodeTypes = {
  dagNode: DagNode as unknown as NodeTypes['dagNode'],
  stickyNote: StickyNote as unknown as NodeTypes['stickyNote'],
};

interface NodeUpdateRequest {
  readonly nodeId: string;
  readonly data: Partial<DagNodeData>;
  readonly timestamp: number;
}

interface NodeDeleteRequest {
  readonly nodeId: string;
  readonly timestamp: number;
}

interface AgentOption {
  readonly name: string;
  readonly id: string;
}

interface WorkflowCanvasProps {
  readonly workflow: Resource | null;
  readonly projectId: string | null;
  readonly isNewWorkflow: boolean;
  readonly agents: readonly AgentOption[];
  readonly skillNames?: readonly string[];
  readonly onNodeSelect: (nodeId: string) => void;
  readonly onSaveComplete: (savedName?: string) => void;
  readonly onNodesChange?: (nodes: readonly Node<DagNodeData>[]) => void;
  readonly onEdgesChange?: (edges: readonly Edge[]) => void;
  readonly nodeUpdateRequest?: NodeUpdateRequest | null;
  readonly nodeDeleteRequest?: NodeDeleteRequest | null;
  readonly executing?: boolean;
  readonly getNodeExecutionStatus?: (nodeId: string) => ExecutionNodeStatus | null;
  readonly onRun?: () => void;
  readonly onCancelRun?: () => void;
  readonly simulate?: boolean;
  readonly onSimulateChange?: (simulate: boolean) => void;
  readonly showCanvasGrid?: boolean;
  readonly showMinimap?: boolean;
}

export type { NodeUpdateRequest, NodeDeleteRequest };

function WorkflowCanvasInner({
  workflow,
  projectId,
  isNewWorkflow,
  agents,
  skillNames = [],
  onNodeSelect,
  onSaveComplete,
  onNodesChange: onNodesChangeExternal,
  onEdgesChange: onEdgesChangeExternal,
  nodeUpdateRequest,
  nodeDeleteRequest,
  executing = false,
  getNodeExecutionStatus,
  onRun,
  onCancelRun,
  simulate = true,
  onSimulateChange,
  showCanvasGrid = true,
  showMinimap = true,
}: WorkflowCanvasProps) {
  const reactFlowInstance = useReactFlow();
  const [saving, setSaving] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [dirty, setDirty] = useState(false);
  const undoRedo = useUndoRedo();
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const defaultNewWorkflowData = useMemo(() => ({
    nodes: [
      {
        id: 'user',
        type: 'dagNode' as const,
        position: { x: 0, y: 0 },
        data: { label: 'user', agent: 'user', task: 'Initiate task', checkpoint: true, nodeId: 'user', skills: [], mcpServers: [] },
      },
      {
        id: 'team-lead',
        type: 'dagNode' as const,
        position: { x: 0, y: 120 },
        data: { label: 'team-lead', agent: '', task: 'Coordinate and delegate tasks', checkpoint: false, nodeId: 'team-lead', skills: [], mcpServers: [] },
      },
    ] as Node<DagNodeData>[],
    edges: [
      { id: 'user->team-lead', source: 'user', target: 'team-lead', animated: true },
    ] as Edge[],
  }), []);

  const flowData = useMemo(() => {
    if (!workflow?.frontmatter) return null;
    try {
      return workflowToFlow(workflow.frontmatter as unknown as Workflow);
    } catch {
      return null;
    }
  }, [workflow]);

  const initialNodes = flowData?.nodes ?? (isNewWorkflow ? defaultNewWorkflowData.nodes : []);
  const initialEdges = flowData?.edges ?? (isNewWorkflow ? defaultNewWorkflowData.edges : []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Extracted hooks
  const dragDrop = useCanvasDragDrop({ nodes, edges, setNodes, setDirty, undoRedo });
  const ctxMenu = useContextMenuHandlers({
    nodes, edges, setNodes, setEdges, setDirty, undoRedo, onNodeSelect,
    wrapperRef: dragDrop.wrapperRef,
  });

  // Sync nodes/edges when workflow changes
  const prevFlowDataRef = useRef(flowData);
  useEffect(() => {
    const flowDataChanged = flowData !== prevFlowDataRef.current;
    prevFlowDataRef.current = flowData;
    if (!isNewWorkflow && !flowDataChanged && !flowData) return;
    const nextNodes = flowData?.nodes ?? (isNewWorkflow ? defaultNewWorkflowData.nodes : []);
    const nextEdges = flowData?.edges ?? (isNewWorkflow ? defaultNewWorkflowData.edges : []);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setDirty(false);
  }, [flowData, isNewWorkflow, defaultNewWorkflowData, setNodes, setEdges]);

  // Sync workflow metadata
  useEffect(() => {
    if (workflow?.frontmatter) {
      const wf = workflow.frontmatter as unknown as Workflow;
      setWorkflowName(wf.name ?? workflow.name ?? '');
      setWorkflowDescription(wf.description ?? '');
    } else if (isNewWorkflow) {
      setWorkflowName('');
      setWorkflowDescription('');
    }
  }, [workflow, isNewWorkflow]);

  // Apply node updates from PropertyPanel
  useEffect(() => {
    if (!nodeUpdateRequest) return;
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id !== nodeUpdateRequest.nodeId) return node;
        return { ...node, data: { ...node.data, ...nodeUpdateRequest.data } };
      })
    );
    setDirty(true);
  }, [nodeUpdateRequest, setNodes]);

  // Apply node deletions from PropertyPanel
  useEffect(() => {
    if (!nodeDeleteRequest) return;
    const targetId = nodeDeleteRequest.nodeId;
    const targetAgent = nodes.find((n) => n.id === targetId)?.data?.agent;
    if (isProtectedNode(targetId, targetAgent)) return;
    undoRedo.pushSnapshot(nodes, edges);
    setNodes((nds) => nds.filter((n) => n.id !== targetId));
    setEdges((eds) => eds.filter((e) => e.source !== targetId && e.target !== targetId));
    setDirty(true);
  }, [nodeDeleteRequest, setNodes, setEdges, nodes, edges, undoRedo]);

  // Notify parent of node/edge changes (debounced to avoid excessive re-renders during drags)
  const nodesChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgesChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (nodesChangeTimerRef.current) clearTimeout(nodesChangeTimerRef.current);
    nodesChangeTimerRef.current = setTimeout(() => { onNodesChangeExternal?.(nodes); }, 50);
    return () => { if (nodesChangeTimerRef.current) clearTimeout(nodesChangeTimerRef.current); };
  }, [nodes, onNodesChangeExternal]);
  useEffect(() => {
    if (edgesChangeTimerRef.current) clearTimeout(edgesChangeTimerRef.current);
    edgesChangeTimerRef.current = setTimeout(() => { onEdgesChangeExternal?.(edges); }, 50);
    return () => { if (edgesChangeTimerRef.current) clearTimeout(edgesChangeTimerRef.current); };
  }, [edges, onEdgesChangeExternal]);

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      const safeChanges = changes.filter((c) => {
        if (c.type === 'remove') {
          const agent = nodesRef.current.find((n) => n.id === c.id)?.data?.agent;
          if (isProtectedNode(c.id, agent)) return false;
        }
        return true;
      });
      if (safeChanges.length === 0) return;
      const hasRemoval = safeChanges.some((c) => c.type === 'remove');
      if (hasRemoval) undoRedoRef.current.pushSnapshot(nodesRef.current, edgesRef.current);
      onNodesChange(safeChanges);
      setDirty(true);
    },
    [onNodesChange]
  );

  const handleEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      const hasRemoval = changes.some((c) => c.type === 'remove');
      if (hasRemoval) undoRedoRef.current.pushSnapshot(nodesRef.current, edgesRef.current);
      onEdgesChange(changes);
      setDirty(true);
    },
    [onEdgesChange]
  );

  const onConnect: OnConnect = useCallback(
    (params) => {
      if (!params.source || !params.target) return;
      const isHorizontal =
        (params.sourceHandle === 'left' || params.sourceHandle === 'right') &&
        (params.targetHandle === 'left' || params.targetHandle === 'right');
      const defaultType: EdgeType = isHorizontal ? 'sync' : 'dispatch';
      if (defaultType === 'dispatch' && wouldCreateDispatchCycle(params.source, params.target, edges)) return;
      undoRedo.pushSnapshot(nodes, edges);
      const newEdge: Edge = {
        ...params,
        id: `${defaultType}:${params.source}->${params.target}`,
        animated: true,
        style: edgeStyle(defaultType),
        label: edgeLabel(defaultType),
        ...edgeMarkers(defaultType),
        data: { edgeType: defaultType },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      setDirty(true);
    },
    [setEdges, edges, nodes, undoRedo]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => { onNodeSelect(node.id); },
    [onNodeSelect]
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const currentType: EdgeType = (edge.data?.edgeType as EdgeType) ?? 'dispatch';
      let next = nextEdgeType(currentType);
      if ((next === 'dispatch' || next === 'roundtrip') && wouldCreateDispatchCycle(edge.source, edge.target, edges)) {
        next = nextEdgeType(next);
        if ((next === 'dispatch' || next === 'roundtrip') && wouldCreateDispatchCycle(edge.source, edge.target, edges)) {
          next = nextEdgeType(next);
        }
      }
      undoRedo.pushSnapshot(nodes, edges);
      const markers = edgeMarkers(next);
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== edge.id) return e;
          const handles = next === 'sync'
            ? syncHandles(e.source, e.target, nodes)
            : { sourceHandle: 'bottom', targetHandle: 'top' };
          return {
            ...e,
            id: `${next}:${e.source}->${e.target}`,
            sourceHandle: handles.sourceHandle,
            targetHandle: handles.targetHandle,
            style: edgeStyle(next),
            label: edgeLabel(next),
            markerStart: markers.markerStart,
            markerEnd: markers.markerEnd,
            data: { edgeType: next },
          };
        })
      );
      setDirty(true);
    },
    [setEdges, edges, nodes, undoRedo]
  );

  // Listen for sticky note text updates
  useEffect(() => {
    function handleStickyUpdate(e: Event) {
      const { nodeId, text } = (e as CustomEvent<{ nodeId: string; text: string }>).detail;
      setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, text } } : n));
    }
    window.addEventListener('stickyNoteUpdate', handleStickyUpdate);
    return () => window.removeEventListener('stickyNoteUpdate', handleStickyUpdate);
  }, [setNodes]);

  // Listen for skill/MCP bind events from DagNode drop
  useEffect(() => {
    function handleBindSkill(e: Event) {
      const { nodeId, skillName } = (e as CustomEvent<{ nodeId: string; skillName: string }>).detail;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId && !n.data.skills.includes(skillName)
            ? { ...n, data: { ...n.data, skills: [...n.data.skills, skillName] } }
            : n
        )
      );
      setDirty(true);
    }
    function handleBindMcp(e: Event) {
      const { nodeId, mcpName } = (e as CustomEvent<{ nodeId: string; mcpName: string }>).detail;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId && !n.data.mcpServers.includes(mcpName)
            ? { ...n, data: { ...n.data, mcpServers: [...n.data.mcpServers, mcpName] } }
            : n
        )
      );
      setDirty(true);
    }
    window.addEventListener('claude-studio:bind-skill', handleBindSkill);
    window.addEventListener('claude-studio:bind-mcp', handleBindMcp);
    return () => {
      window.removeEventListener('claude-studio:bind-skill', handleBindSkill);
      window.removeEventListener('claude-studio:bind-mcp', handleBindMcp);
    };
  }, [setNodes]);

  // Undo/redo refs
  const undoRedoRef = useRef(undoRedo);
  useEffect(() => { undoRedoRef.current = undoRedo; }, [undoRedo]);
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const edgesRef = useRef(edges);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  const handleSaveRef = useRef(() => {});

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (!workflowName.trim()) return;
    setSaving(true);
    try {
      const wf = flowToWorkflow(workflowName, workflowDescription, nodes, edges);
      const yamlContent = workflowToYaml(wf);
      const pid = projectId ?? 'global';
      const method = isNewWorkflow ? 'POST' : 'PUT';
      const res = await apiFetch(`/api/projects/${pid}/workflows`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workflowName, content: yamlContent }),
      });
      const json = await res.json();
      if (json.success) {
        setDirty(false);
        onSaveComplete(isNewWorkflow ? workflowName : undefined);

        // Non-blocking: sync workflow reference line to CLAUDE.md
        const workflowLine = workflowToClaudeMdLine(wf);
        apiFetch(`/api/projects/${pid}/claudemd`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowName: wf.name, workflowLine }),
        }).catch(() => {
          // CLAUDE.md sync is best-effort; YAML is the source of truth
        });
      }
    } catch (error) {
      console.error('Failed to save workflow:', error);
    } finally {
      setSaving(false);
    }
  }, [saving, workflowName, workflowDescription, nodes, edges, projectId, isNewWorkflow, onSaveComplete]);

  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) return;
    undoRedo.pushSnapshot(nodes, edges);
    const layouted = autoLayoutNodes(nodes, edges);
    setNodes(layouted);
    setEdges((eds) => fixSyncEdgeHandles(eds, layouted));
    setDirty(true);
    setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 50);
  }, [nodes, edges, setNodes, setEdges, undoRedo, reactFlowInstance]);

  const handleNameChange = useCallback((name: string) => { setWorkflowName(name); setDirty(true); }, []);
  const handleDescriptionChange = useCallback((desc: string) => { setWorkflowDescription(desc); setDirty(true); }, []);

  // Generate workflow
  const applyGeneratedResult = useCallback(
    (resultNodes: Node<DagNodeData>[], resultEdges: Edge[], name: string, desc: string) => {
      undoRedo.pushSnapshot(nodes, edges);
      setNodes(resultNodes);
      setEdges(resultEdges);
      setWorkflowName(name);
      setWorkflowDescription(desc);
      setDirty(true);
      setGenerateModalOpen(false);
      setGenerating(false);
      setGenerateError(null);
      setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 50);
    },
    [nodes, edges, undoRedo, setNodes, setEdges, reactFlowInstance],
  );

  const fallbackGenerate = useCallback(
    (description: string) => {
      const availableAgents = agents.map((a) => a.name);
      const result = generateWorkflow({ description, availableAgents });
      applyGeneratedResult(result.nodes, result.edges, result.name, result.suggestedDescription);
    },
    [agents, applyGeneratedResult],
  );

  const handleGenerate = useCallback(
    async (description: string) => {
      setGenerating(true);
      setGenerateError(null);
      try {
        const availableAgents = agents.map((a) => a.name);
        const res = await apiFetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'workflow', description, agents: availableAgents, skills: [...skillNames] }),
          signal: AbortSignal.timeout(65_000),
        });
        const json = await res.json();
        if (!json.success || !json.data?.workflow) {
          setGenerateError('AI generation unavailable, using template-based generation');
          fallbackGenerate(description);
          return;
        }
        const generatedWorkflow = json.data.workflow as Workflow;
        const generatedFlowData = workflowToFlow(generatedWorkflow);
        applyGeneratedResult(
          generatedFlowData.nodes, generatedFlowData.edges,
          generatedWorkflow.name ?? 'generated-workflow',
          generatedWorkflow.description ?? `AI-generated workflow: ${description.slice(0, 80)}`,
        );
      } catch {
        setGenerateError('AI generation unavailable, using template-based generation');
        fallbackGenerate(description);
      }
    },
    [agents, skillNames, applyGeneratedResult, fallbackGenerate],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        const result = undoRedoRef.current.performRedo(nodesRef.current, edgesRef.current);
        if (result) { setNodes(result.nodes as Node<DagNodeData>[]); setEdges(result.edges as Edge[]); setDirty(true); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const result = undoRedoRef.current.performUndo(nodesRef.current, edgesRef.current);
        if (result) { setNodes(result.nodes as Node<DagNodeData>[]); setEdges(result.edges as Edge[]); setDirty(true); }
        return;
      }
      if (e.key === 'Escape') { ctxMenu.handleCloseContextMenu(); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setNodes, setEdges, ctxMenu]);

  // Pre-compute connection counts for all nodes to avoid O(N*E) in DagNode
  const connectionCounts = useMemo(() => {
    const counts = new Map<string, { inCount: number; outCount: number }>();
    for (const node of nodes) {
      counts.set(node.id, { inCount: 0, outCount: 0 });
    }
    for (const edge of edges) {
      const src = counts.get(edge.source);
      if (src) counts.set(edge.source, { ...src, outCount: src.outCount + 1 });
      const tgt = counts.get(edge.target);
      if (tgt) counts.set(edge.target, { ...tgt, inCount: tgt.inCount + 1 });
    }
    return counts;
  }, [nodes, edges]);

  const displayNodes = useMemo(() => {
    const withCounts = nodes.map((node) => {
      const cc = connectionCounts.get(node.id) ?? { inCount: 0, outCount: 0 };
      return { ...node, data: { ...node.data, inCount: cc.inCount, outCount: cc.outCount } };
    });
    if (executing && getNodeExecutionStatus) {
      return withCounts.map((node) => ({ ...node, data: { ...node.data, executionStatus: getNodeExecutionStatus(node.id) } }));
    }
    return withCounts;
  }, [nodes, connectionCounts, executing, getNodeExecutionStatus]);

  if (!workflow && !isNewWorkflow) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        <div className="text-center">
          <p className="mb-1">No workflow selected</p>
          <p className="text-xs text-muted/60">Select a workflow or create a new one</p>
        </div>
      </div>
    );
  }

  if (workflow && !flowData && !isNewWorkflow) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Failed to parse workflow
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WorkflowToolbar
        workflowName={workflowName}
        workflowDescription={workflowDescription}
        onNameChange={handleNameChange}
        onDescriptionChange={handleDescriptionChange}
        nodes={nodes}
        edges={edges}
        dirty={dirty}
        saving={saving}
        executing={executing}
        simulate={simulate}
        onSimulateChange={onSimulateChange ?? (() => {})}
        onSave={handleSave}
        onRun={onRun ?? (() => {})}
        onCancelRun={onCancelRun ?? (() => {})}
        onGenerateOpen={() => setGenerateModalOpen(true)}
      />
      <GenerateModal
        open={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        onGenerate={handleGenerate}
        generating={generating}
        error={generateError}
      />
      <div ref={dragDrop.wrapperRef} className="flex-1">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onDragOver={dragDrop.handleDragOver}
          onDrop={dragDrop.handleDrop}
          onPaneContextMenu={ctxMenu.handlePaneContextMenu}
          onNodeContextMenu={ctxMenu.handleNodeContextMenu}
          onPaneClick={ctxMenu.handleCloseContextMenu}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-background"
          deleteKeyCode={['Backspace', 'Delete']}
        >
          {showCanvasGrid && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />}
          <Controls className="!bg-surface !border-border !shadow-lg [&>button]:!bg-surface [&>button]:!border-border [&>button]:!text-muted [&>button:hover]:!bg-surface-hover">
            <ControlButton
              onClick={handleAutoLayout}
              title="Auto-arrange node layout"
              disabled={nodes.length === 0}
            >
              <LayoutGrid size={14} />
            </ControlButton>
          </Controls>
          {showMinimap && (
            <MiniMap
              nodeColor={(node) => (node.data as DagNodeData)?.checkpoint ? '#f59e0b' : '#666'}
              maskColor="rgba(0,0,0,0.7)"
              className="!bg-surface !border-border"
              pannable
              zoomable
            />
          )}
        </ReactFlow>
        <CanvasContextMenu
          state={ctxMenu.contextMenu}
          agents={agents}
          onClose={ctxMenu.handleCloseContextMenu}
          onAddNode={ctxMenu.handleContextAddNode}
          onAddNote={ctxMenu.handleContextAddNote}
          onEditTask={ctxMenu.handleContextEditTask}
          onToggleCheckpoint={ctxMenu.handleContextToggleCheckpoint}
          onDeleteNode={ctxMenu.handleContextDeleteNode}
        />
      </div>
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { Resource, Project, Workflow } from '@/types/resources';
import type { DagNodeData } from '@/lib/workflow-to-flow';
import type { NodeUpdateRequest, NodeDeleteRequest } from '@/components/workflow/WorkflowCanvas';

interface UseWorkflowStateResult {
  readonly selectedResource: Resource | null;
  readonly selectedNodeId: string | null;
  readonly isNewWorkflow: boolean;
  readonly workflowProjectId: string | null;
  readonly canvasNodes: readonly Node<DagNodeData>[];
  readonly canvasEdges: readonly Edge[];
  readonly nodeUpdateRequest: NodeUpdateRequest | null;
  readonly nodeDeleteRequest: NodeDeleteRequest | null;
  readonly activeWorkflow: Resource | null;
  readonly computedWorkflowProjectId: string;
  readonly setSelectedResource: (resource: Resource | null) => void;
  readonly handleSelectResource: (resource: Resource) => void;
  readonly handleSelectClaudeMd: (project: Project) => void;
  readonly handleCreateWorkflow: (project: Project, template?: Workflow) => void;
  readonly handleNodeSelect: (nodeId: string) => void;
  readonly handleSaveComplete: (savedName?: string, refetchFns?: { refetchProject: () => void; refetchResources: () => void }) => void;
  readonly handleCanvasNodesChange: (nodes: readonly Node<DagNodeData>[]) => void;
  readonly handleCanvasEdgesChange: (edges: readonly Edge[]) => void;
  readonly handleUpdateNode: (nodeId: string, data: Partial<DagNodeData>) => void;
  readonly handleDeleteNode: (nodeId: string) => void;
  readonly resetSelection: () => void;
}

function makeClaudeMdResource(project: Project): Resource {
  return {
    id: `${project.id}:CLAUDE.md`,
    type: 'rules',
    name: `${project.name}/CLAUDE.md`,
    path: `${project.path}/CLAUDE.md`,
    content: project.claudeMd ?? '',
  };
}

function makeNewWorkflowResource(project: Project, template?: Workflow): Resource {
  if (template) {
    return {
      id: `${project.id}:new-workflow`,
      type: 'workflows',
      name: template.name,
      path: '',
      content: '',
      frontmatter: template as unknown as Record<string, unknown>,
    };
  }
  return {
    id: `${project.id}:new-workflow`,
    type: 'workflows',
    name: 'New Workflow',
    path: '',
    content: '',
  };
}

export function useWorkflowState(
  activeProject: Project | null,
  activeProjectId: string | null,
): UseWorkflowStateResult {
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isNewWorkflow, setIsNewWorkflow] = useState(false);
  const [workflowProjectId, setWorkflowProjectId] = useState<string | null>(null);
  const [canvasNodes, setCanvasNodes] = useState<readonly Node<DagNodeData>[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<readonly Edge[]>([]);
  const [nodeUpdateRequest, setNodeUpdateRequest] = useState<NodeUpdateRequest | null>(null);
  const [nodeDeleteRequest, setNodeDeleteRequest] = useState<NodeDeleteRequest | null>(null);

  const handleSelectResource = useCallback((resource: Resource) => {
    setSelectedResource(resource);
    setSelectedNodeId(null);
    setIsNewWorkflow(false);
  }, []);

  const handleSelectClaudeMd = useCallback((project: Project) => {
    setSelectedResource(makeClaudeMdResource(project));
    setSelectedNodeId(null);
    setIsNewWorkflow(false);
  }, []);

  const handleCreateWorkflow = useCallback((project: Project, template?: Workflow) => {
    setSelectedResource(makeNewWorkflowResource(project, template));
    setWorkflowProjectId(project.id);
    setSelectedNodeId(null);
    setIsNewWorkflow(true);
  }, []);

  const handleNodeSelect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleSaveComplete = useCallback((
    savedName?: string,
    refetchFns?: { refetchProject: () => void; refetchResources: () => void },
  ) => {
    setIsNewWorkflow(false);
    if (savedName) {
      setSelectedResource(null);
    }
    refetchFns?.refetchProject();
    refetchFns?.refetchResources();
  }, []);

  const handleCanvasNodesChange = useCallback((nodes: readonly Node<DagNodeData>[]) => {
    setCanvasNodes(nodes);
  }, []);

  const handleCanvasEdgesChange = useCallback((edges: readonly Edge[]) => {
    setCanvasEdges(edges);
  }, []);

  const handleUpdateNode = useCallback((nodeId: string, data: Partial<DagNodeData>) => {
    setNodeUpdateRequest({ nodeId, data, timestamp: Date.now() });
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodeDeleteRequest({ nodeId, timestamp: Date.now() });
    setSelectedNodeId(null);
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedResource(null);
    setSelectedNodeId(null);
    setIsNewWorkflow(false);
  }, []);

  // When project refreshes (e.g. file watcher or save), update selectedResource
  // with the latest version from project to pick up content AND frontmatter changes.
  // Canvas reads from frontmatter (parsed object), so comparing only content is
  // insufficient — a YAML edit changes both content and frontmatter.
  const prevProjectRef = useRef(activeProject);
  useEffect(() => {
    if (activeProject === prevProjectRef.current) return;
    prevProjectRef.current = activeProject;
    if (!selectedResource || selectedResource.type !== 'workflows' || !activeProject) return;
    const updated = activeProject.workflows.find((w) => w.id === selectedResource.id);
    if (!updated) return;
    const contentChanged = updated.content !== selectedResource.content;
    const frontmatterChanged =
      JSON.stringify(updated.frontmatter) !== JSON.stringify(selectedResource.frontmatter);
    if (contentChanged || frontmatterChanged) {
      setSelectedResource(updated);
    }
  }, [activeProject, selectedResource]);

  const activeWorkflow = useMemo(() => {
    if (selectedResource?.type === 'workflows') return selectedResource;
    if (activeProject) {
      if (activeProject.workflows.length > 0) return activeProject.workflows[0];
    }
    return null;
  }, [selectedResource, activeProject]);

  const computedWorkflowProjectId = useMemo(() => {
    if (workflowProjectId) return workflowProjectId;
    if (activeProjectId) return activeProjectId;
    return 'global';
  }, [workflowProjectId, activeProjectId]);

  return {
    selectedResource,
    selectedNodeId,
    isNewWorkflow,
    workflowProjectId,
    canvasNodes,
    canvasEdges,
    nodeUpdateRequest,
    nodeDeleteRequest,
    activeWorkflow,
    computedWorkflowProjectId,
    setSelectedResource,
    handleSelectResource,
    handleSelectClaudeMd,
    handleCreateWorkflow,
    handleNodeSelect,
    handleSaveComplete,
    handleCanvasNodesChange,
    handleCanvasEdgesChange,
    handleUpdateNode,
    handleDeleteNode,
    resetSelection,
  };
}

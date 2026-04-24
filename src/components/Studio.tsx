'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import type { Resource } from '@/types/resources';
import type { DagNodeData } from '@/lib/workflow-to-flow';
import { apiFetch } from '@/lib/api-client';
import { useProjectManagement } from '@/lib/use-project-management';
import { useWorkflowState } from '@/lib/use-workflow-state';
import { useResources } from '@/lib/use-resources';
import { useSettings } from '@/lib/use-settings';
import { useFileWatcher } from '@/lib/use-file-watcher';
import { useExecution } from '@/lib/use-execution';
import { flowToWorkflow } from '@/lib/flow-to-workflow';
import { ProjectPanel } from './panels/ProjectPanel';
import { PropertyPanel } from './panels/PropertyPanel';
import { ExecutionPanel } from './panels/ExecutionPanel';
import { WorkflowCanvas } from './workflow/WorkflowCanvas';
import { WelcomeScreen } from './WelcomeScreen';
import { SettingsModal } from './settings/SettingsModal';
import { StudioSettingsModal } from './settings/StudioSettingsModal';
import { useStudioSettings } from '@/lib/use-studio-settings';
import { AgentCreateModal, type AgentFormData } from './agents/AgentCreateModal';
import { SkillCreateModal, type SkillFormData } from './skills/SkillCreateModal';
import { OpenProjectModal } from './projects/OpenProjectModal';
import { NewProjectModal } from './projects/NewProjectModal';
import { getClaudeHomePath } from '@/lib/client-utils';
import { ResizeHandle } from './panels/ResizeHandle';
import { getVscodeWebviewBootstrap } from '@/lib/vscode-webview';

export function Studio() {
  const pm = useProjectManagement();
  const { resources: allResources, refetch: refetchResources } = useResources();
  const { settings } = useSettings();
  const studioSettings = useStudioSettings();
  const execution = useExecution();
  const [simulate, setSimulate] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const rightPanelRef = useRef<HTMLElement>(null);

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((prev) => Math.min(Math.max(prev + delta, 240), 800));
  }, []);

  const wfs = useWorkflowState(pm.activeProject, pm.activeProjectId);
  const autoOpenBootstrappedRef = useRef(false);
  const [pendingWorkflowAutoSelect, setPendingWorkflowAutoSelect] = useState<string | null>(null);

  // Reset selection when project opens/closes
  const handleOpenProjectFromPath = useCallback(async (projectPath: string) => {
    wfs.resetSelection();
    await pm.handleOpenProjectFromPath(projectPath);
  }, [pm, wfs]);

  useEffect(() => {
    if (autoOpenBootstrappedRef.current) return;
    autoOpenBootstrappedRef.current = true;

    const bootstrap = getVscodeWebviewBootstrap();
    const params = new URLSearchParams(window.location.search);
    const openProjectPath = bootstrap?.openProjectPath ?? params.get('openProjectPath');
    const openWorkflowName = bootstrap?.openWorkflowName ?? params.get('openWorkflowName');
    if (!openProjectPath) return;

    void (async () => {
      await handleOpenProjectFromPath(openProjectPath);
      if (openWorkflowName) {
        setPendingWorkflowAutoSelect(openWorkflowName);
      }
    })();
  }, [handleOpenProjectFromPath]);

  useEffect(() => {
    if (!pendingWorkflowAutoSelect || !pm.activeProject) return;

    const target = pendingWorkflowAutoSelect.trim();
    const matched = pm.activeProject.workflows.find(
      (wf) => wf.name === target || decodeURIComponent(wf.id) === target,
    );
    if (!matched) return;

    wfs.handleSelectResource(matched);
    setPendingWorkflowAutoSelect(null);
  }, [pendingWorkflowAutoSelect, pm.activeProject, wfs]);

  const handleCloseProject = useCallback(() => {
    wfs.resetSelection();
    pm.handleCloseProject();
  }, [pm, wfs]);

  // --- File watcher ---
  const handleFileChange = useCallback(() => {
    pm.projectOpen.refetch();
    refetchResources();
  }, [pm.projectOpen, refetchResources]);

  const { connected } = useFileWatcher(handleFileChange);

  // --- Agent CRUD ---
  const [agentCreateOpen, setAgentCreateOpen] = useState(false);
  const [agentCreateSaving, setAgentCreateSaving] = useState(false);
  const [skillCreateOpen, setSkillCreateOpen] = useState(false);
  const [skillCreateSaving, setSkillCreateSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectConfigOpen, setProjectConfigOpen] = useState(false);
  const [globalConfigOpen, setGlobalConfigOpen] = useState(false);

  const handleCreateAgent = useCallback(async (data: AgentFormData) => {
    if (!pm.activeProjectId) return;
    setAgentCreateSaving(true);
    try {
      const frontmatter: Record<string, unknown> = {
        model: data.model,
        tools: [...data.tools],
      };
      if (data.description) {
        frontmatter.description = data.description;
      }
      const res = await apiFetch(`/api/projects/${encodeURIComponent(pm.activeProjectId)}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, content: data.body, frontmatter }),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        setAgentCreateOpen(false);
        pm.projectOpen.refetch();
      }
    } catch (error) {
      console.error('Failed to create agent:', error);
    } finally {
      setAgentCreateSaving(false);
    }
  }, [pm.activeProjectId, pm.projectOpen]);

  const handleDeleteAgent = useCallback(async (agent: Resource) => {
    if (!pm.activeProjectId) return;
    try {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(pm.activeProjectId)}/agents?name=${encodeURIComponent(agent.name)}`,
        { method: 'DELETE' },
      );
      const json = await res.json() as { success: boolean };
      if (json.success) {
        if (wfs.selectedResource?.id === agent.id) {
          wfs.setSelectedResource(null);
        }
        pm.projectOpen.refetch();
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  }, [pm.activeProjectId, wfs, pm.projectOpen]);

  const handleCreateSkill = useCallback(async (data: SkillFormData) => {
    if (!pm.activeProjectId) return;
    setSkillCreateSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(pm.activeProjectId)}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, description: data.description, content: data.body }),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        setSkillCreateOpen(false);
        pm.projectOpen.refetch();
        refetchResources();
      }
    } catch (error) {
      console.error('Failed to create skill:', error);
    } finally {
      setSkillCreateSaving(false);
    }
  }, [pm.activeProjectId, pm.projectOpen, refetchResources]);

  const handleDeleteSkill = useCallback(async (skill: Resource) => {
    if (!pm.activeProjectId) return;
    try {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(pm.activeProjectId)}/skills?name=${encodeURIComponent(skill.name)}`,
        { method: 'DELETE' },
      );
      const json = await res.json() as { success: boolean };
      if (json.success) {
        if (wfs.selectedResource?.id === skill.id) {
          wfs.setSelectedResource(null);
        }
        pm.projectOpen.refetch();
        refetchResources();
      }
    } catch (error) {
      console.error('Failed to delete skill:', error);
    }
  }, [pm.activeProjectId, wfs, pm.projectOpen, refetchResources]);

  const handleDeleteWorkflow = useCallback(async (workflow: Resource) => {
    if (!pm.activeProjectId) return;
    try {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(pm.activeProjectId)}/workflows?name=${encodeURIComponent(workflow.name)}`,
        { method: 'DELETE' },
      );
      const json = await res.json() as { success: boolean };
      if (json.success) {
        if (wfs.selectedResource?.id === workflow.id) {
          wfs.setSelectedResource(null);
        }
        pm.projectOpen.refetch();
      }
    } catch (error) {
      console.error('Failed to delete workflow:', error);
    }
  }, [pm.activeProjectId, wfs, pm.projectOpen]);

  const handleImportAgent = useCallback(async (name: string, content: string) => {
    if (!pm.activeProjectId) return;
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(pm.activeProjectId)}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        pm.projectOpen.refetch();
      } else {
        window.alert(`Failed to import agent: ${json.error ?? 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to import agent:', error);
    }
  }, [pm.activeProjectId, pm.projectOpen]);

  const handleImportSkill = useCallback(async (name: string, rawContent: string) => {
    if (!pm.activeProjectId) return;
    try {
      // Strip frontmatter if present — the API rebuilds it from name/description
      let body = rawContent;
      let description = '';
      const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (fmMatch) {
        const fmBlock = fmMatch[1];
        body = fmMatch[2];
        const descLine = fmBlock.match(/^description:\s*(.+)$/m);
        if (descLine) {
          description = descLine[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }
      const res = await apiFetch(`/api/projects/${encodeURIComponent(pm.activeProjectId)}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, content: body }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        pm.projectOpen.refetch();
        refetchResources();
      } else {
        window.alert(`Failed to import skill: ${json.error ?? 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to import skill:', error);
    }
  }, [pm.activeProjectId, pm.projectOpen, refetchResources]);

  const handleDeleteMemory = useCallback(async (memory: Resource) => {
    if (!memory.path) return;
    try {
      const res = await apiFetch(
        `/api/files?path=${encodeURIComponent(memory.path)}`,
        { method: 'DELETE' },
      );
      const json = await res.json() as { success: boolean };
      if (json.success) {
        pm.projectOpen.refetch();
      }
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  }, [pm.projectOpen]);

  // --- Derived data ---
  const auxiliaryResources = useMemo(
    () => allResources.filter((r) => r.type === 'skills' || r.type === 'rules'),
    [allResources]
  );

  const availableSkillNames = useMemo(() => {
    const globalSkills = allResources.filter((r) => r.type === 'skills').map((r) => r.name);
    const projectSkills = (pm.activeProject?.skills ?? []).map((r) => r.name);
    return [...new Set([...projectSkills, ...globalSkills])];
  }, [allResources, pm.activeProject]);

  const availableMcpServerNames = useMemo(
    () => (settings ? Object.keys(settings.mcpServers) : []),
    [settings]
  );

  const canvasAgents = useMemo(
    () => (pm.activeProject?.agents ?? []).map((a) => ({ name: a.name, id: a.id })),
    [pm.activeProject]
  );

  const handleResourceUpdate = useCallback(() => {
    pm.projectOpen.refetch();
    refetchResources();
  }, [pm.projectOpen, refetchResources]);

  const handleSaveComplete = useCallback((savedName?: string) => {
    wfs.handleSaveComplete(savedName, {
      refetchProject: pm.projectOpen.refetch,
      refetchResources,
    });
  }, [wfs, pm.projectOpen, refetchResources]);

  const handleRun = useCallback(() => {
    if (wfs.canvasNodes.length === 0) return;
    const wf = flowToWorkflow(
      wfs.activeWorkflow?.name ?? 'Untitled',
      '',
      wfs.canvasNodes as Node<DagNodeData>[],
      wfs.canvasEdges as Edge[],
    );
    const projectPath = pm.activeProject?.path;
    execution.startExecution(wf, projectPath, simulate);
  }, [wfs.canvasNodes, wfs.canvasEdges, wfs.activeWorkflow, pm.activeProject, execution, simulate]);

  const handleCancelRun = useCallback(() => {
    execution.cancelExecution();
  }, [execution]);

  const handleApproveCheckpoint = useCallback((nodeId: string) => {
    execution.approveCheckpoint(nodeId);
  }, [execution]);

  const showWelcome = !pm.activeProject && !pm.projectOpen.loading;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-semibold tracking-tight">harness-studio</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
        >
          <span className="flex items-center gap-1"><Settings size={12} /> Settings</span>
        </button>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface p-3">
          <ProjectPanel
            activeProject={pm.activeProject}
            activeProjectLoading={pm.projectOpen.loading}
            recentProjects={pm.recentProjects}
            auxiliaryResources={auxiliaryResources}
            mcpServerNames={availableMcpServerNames}
            selectedId={wfs.selectedResource?.id ?? null}
            onOpenProject={() => pm.setOpenModalOpen(true)}
            onNewProject={() => pm.setNewModalOpen(true)}
            onCloseProject={handleCloseProject}
            onSelectRecent={pm.handleSelectRecent}
            onRemoveRecent={pm.handleRemoveRecent}
            onSelectResource={wfs.handleSelectResource}
            onSelectClaudeMd={wfs.handleSelectClaudeMd}
            onCreateWorkflow={wfs.handleCreateWorkflow}
            onDeleteWorkflow={handleDeleteWorkflow}
            onCreateAgent={() => setAgentCreateOpen(true)}
            onImportAgent={handleImportAgent}
            onDeleteAgent={handleDeleteAgent}
            onCreateSkill={() => setSkillCreateOpen(true)}
            onImportSkill={handleImportSkill}
            onDeleteSkill={handleDeleteSkill}
            onOpenClaudeConfig={() => setProjectConfigOpen(true)}
            onOpenGlobalConfig={() => setGlobalConfigOpen(true)}
          />
        </aside>

        <section className="flex-1 overflow-hidden bg-background">
          {showWelcome ? (
            <WelcomeScreen
              recentProjects={pm.recentProjects}
              onOpenProject={() => pm.setOpenModalOpen(true)}
              onNewProject={() => pm.setNewModalOpen(true)}
              onSelectRecent={pm.handleSelectRecent}
            />
          ) : (
            <WorkflowCanvas
              workflow={wfs.activeWorkflow}
              projectId={wfs.computedWorkflowProjectId}
              isNewWorkflow={wfs.isNewWorkflow}
              agents={canvasAgents}
              skillNames={availableSkillNames}
              onNodeSelect={wfs.handleNodeSelect}
              onSaveComplete={handleSaveComplete}
              onNodesChange={wfs.handleCanvasNodesChange}
              onEdgesChange={wfs.handleCanvasEdgesChange}
              nodeUpdateRequest={wfs.nodeUpdateRequest}
              nodeDeleteRequest={wfs.nodeDeleteRequest}
              executing={execution.executing}
              getNodeExecutionStatus={execution.getNodeExecutionStatus}
              onRun={handleRun}
              onCancelRun={handleCancelRun}
              simulate={simulate}
              onSimulateChange={setSimulate}
              showCanvasGrid={studioSettings.settings.showCanvasGrid}
              showMinimap={studioSettings.settings.showMinimap}
            />
          )}
        </section>

        <ResizeHandle side="left" onResize={handleRightPanelResize} />
        <aside
          ref={rightPanelRef}
          style={{ width: rightPanelWidth }}
          className="shrink-0 overflow-y-auto border-l border-border bg-surface"
        >
          {execution.executionState ? (
            <ExecutionPanel
              executionState={execution.executionState}
              logs={execution.logs}
              onCancel={handleCancelRun}
              onApproveCheckpoint={handleApproveCheckpoint}
            />
          ) : (
            <PropertyPanel
              resource={wfs.selectedResource}
              selectedNodeId={wfs.selectedNodeId}
              onUpdate={handleResourceUpdate}
              canvasNodes={wfs.canvasNodes}
              canvasEdges={wfs.canvasEdges}
              onUpdateNode={wfs.handleUpdateNode}
              onDeleteNode={wfs.handleDeleteNode}
              availableSkills={availableSkillNames}
              availableMcpServers={availableMcpServerNames}
              memories={pm.activeProject?.memories ?? []}
              onDeleteMemory={handleDeleteMemory}
              editorFontSize={studioSettings.settings.editorFontSize}
              projectId={pm.activeProjectId ?? undefined}
            />
          )}
        </aside>
      </main>

      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-surface px-4 text-xs text-muted">
        <span>{getClaudeHomePath()}</span>
        <span className="flex items-center gap-1">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          {connected ? 'Watching' : 'Disconnected'}
        </span>
        {pm.activeProject && <span className="truncate">{pm.activeProject.path}</span>}
      </footer>

      <StudioSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={studioSettings.settings}
        onUpdateSetting={studioSettings.updateSetting}
      />
      <SettingsModal
        open={projectConfigOpen}
        onClose={() => setProjectConfigOpen(false)}
        settingsPath={pm.activeProject ? `${pm.activeProject.path}/.claude/settings.json` : ''}
        projectPath={pm.activeProject?.path}
        projectName={pm.activeProject?.name}
        projectAgents={pm.activeProject?.agents}
        projectSkills={pm.activeProject?.skills}
      />
      <SettingsModal
        open={globalConfigOpen}
        onClose={() => setGlobalConfigOpen(false)}
        settingsPath={`${getClaudeHomePath()}settings.json`}
        projectName={pm.activeProject?.name}
        projectAgents={pm.activeProject?.agents}
        projectSkills={pm.activeProject?.skills}
      />
      <AgentCreateModal
        open={agentCreateOpen}
        onClose={() => setAgentCreateOpen(false)}
        onCreate={handleCreateAgent}
        saving={agentCreateSaving}
      />
      <SkillCreateModal
        open={skillCreateOpen}
        onClose={() => setSkillCreateOpen(false)}
        onCreate={handleCreateSkill}
        saving={skillCreateSaving}
      />
      <OpenProjectModal
        open={pm.openModalOpen}
        onClose={() => { pm.setOpenModalOpen(false); pm.clearOpenError(); }}
        onOpen={handleOpenProjectFromPath}
        loading={pm.projectOpen.loading}
        error={pm.openError}
      />
      <NewProjectModal
        open={pm.newModalOpen}
        onClose={() => pm.setNewModalOpen(false)}
        onCreate={pm.handleCreateProject}
        loading={pm.projectCreateLoading}
        error={pm.projectCreateError}
      />
    </div>
  );
}

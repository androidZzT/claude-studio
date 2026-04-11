'use client';

import { useState, useCallback, useMemo } from 'react';
import { Settings } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import type { Resource } from '@/types/resources';
import type { DagNodeData } from '@/lib/workflow-to-flow';
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

export function Studio() {
  const pm = useProjectManagement();
  const { resources: allResources, refetch: refetchResources } = useResources();
  const { settings } = useSettings();
  const studioSettings = useStudioSettings();
  const execution = useExecution();

  const wfs = useWorkflowState(pm.activeProject, pm.activeProjectId);

  // Reset selection when project opens/closes
  const handleOpenProjectFromPath = useCallback(async (projectPath: string) => {
    wfs.resetSelection();
    await pm.handleOpenProjectFromPath(projectPath);
  }, [pm, wfs]);

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
  const [claudeConfigOpen, setClaudeConfigOpen] = useState(false);

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
      const res = await fetch(`/api/projects/${encodeURIComponent(pm.activeProjectId)}/agents`, {
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
      const res = await fetch(
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
      const res = await fetch(`/api/projects/${encodeURIComponent(pm.activeProjectId)}/skills`, {
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
      const res = await fetch(
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

  const handleDeleteMemory = useCallback(async (memory: Resource) => {
    if (!memory.path) return;
    try {
      const res = await fetch(
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
    execution.startExecution(wf, projectPath);
  }, [wfs.canvasNodes, wfs.canvasEdges, wfs.activeWorkflow, pm.activeProject, execution]);

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
        <h1 className="text-sm font-semibold tracking-tight">claude-studio</h1>
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
            onCreateAgent={() => setAgentCreateOpen(true)}
            onDeleteAgent={handleDeleteAgent}
            onCreateSkill={() => setSkillCreateOpen(true)}
            onDeleteSkill={handleDeleteSkill}
            onOpenClaudeConfig={() => setClaudeConfigOpen(true)}
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
              showCanvasGrid={studioSettings.settings.showCanvasGrid}
              showMinimap={studioSettings.settings.showMinimap}
            />
          )}
        </section>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-surface">
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
        open={claudeConfigOpen}
        onClose={() => setClaudeConfigOpen(false)}
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

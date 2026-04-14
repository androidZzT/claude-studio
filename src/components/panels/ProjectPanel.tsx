'use client';

import { useState, useCallback, useRef } from 'react';
import { GripVertical, Plus, Trash2, FileInput } from 'lucide-react';
import type { Project, Resource, Workflow } from '@/types/resources';
import { validateWorkflow } from '@/lib/workflow-validation';
import type { RecentProject } from '@/lib/use-projects';
import { ProjectSelector } from './ProjectSelector';
import { AuxiliarySection } from './AuxiliarySection';
import { CommunityLinks } from './CommunityLinks';
import { CollapsibleSection, StaticSectionHeader } from './SectionHeader';
import { WORKFLOW_TEMPLATES } from '@/lib/workflow-templates';

interface ProjectPanelProps {
  readonly activeProject: Project | null;
  readonly activeProjectLoading: boolean;
  readonly recentProjects: readonly RecentProject[];
  readonly auxiliaryResources: readonly Resource[];
  readonly mcpServerNames?: readonly string[];
  readonly selectedId: string | null;
  readonly onOpenProject: () => void;
  readonly onNewProject: () => void;
  readonly onCloseProject: () => void;
  readonly onSelectRecent: (path: string) => void;
  readonly onRemoveRecent: (path: string) => void;
  readonly onSelectResource: (resource: Resource) => void;
  readonly onSelectClaudeMd: (project: Project) => void;
  readonly onCreateWorkflow: (project: Project, template?: Workflow) => void;
  readonly onDeleteWorkflow?: (workflow: Resource) => void;
  readonly onCreateAgent?: () => void;
  readonly onImportAgent?: (name: string, content: string) => void;
  readonly onDeleteAgent?: (agent: Resource) => void;
  readonly onCreateSkill?: () => void;
  readonly onImportSkill?: (name: string, content: string) => void;
  readonly onDeleteSkill?: (skill: Resource) => void;
  readonly onOpenClaudeConfig?: () => void;
  readonly onOpenGlobalConfig?: () => void;
}

export function ProjectPanel({
  activeProject,
  activeProjectLoading,
  recentProjects,
  auxiliaryResources,
  mcpServerNames = [],
  selectedId,
  onOpenProject,
  onNewProject,
  onCloseProject,
  onSelectRecent,
  onRemoveRecent,
  onSelectResource,
  onSelectClaudeMd,
  onCreateWorkflow,
  onDeleteWorkflow,
  onCreateAgent,
  onImportAgent,
  onDeleteAgent,
  onCreateSkill,
  onImportSkill,
  onDeleteSkill,
  onOpenClaudeConfig,
  onOpenGlobalConfig,
}: ProjectPanelProps) {
  return (
    <nav className="flex h-full flex-col">
      {/* Project selector */}
      <ProjectSelector
        activeProject={activeProject}
        recentProjects={recentProjects}
        onOpenProject={onOpenProject}
        onNewProject={onNewProject}
        onCloseProject={onCloseProject}
        onSelectRecent={onSelectRecent}
        onRemoveRecent={onRemoveRecent}
        loading={activeProjectLoading}
      />

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        {activeProjectLoading && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-muted">Loading project...</span>
          </div>
        )}

        {!activeProjectLoading && !activeProject && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-xs text-muted">
              Open a project to get started
            </span>
          </div>
        )}

        {/* Claude Config */}
        {!activeProjectLoading && activeProject && onOpenClaudeConfig && (
          <ClaudeConfigSection onOpen={onOpenClaudeConfig} />
        )}

        {/* CLAUDE.md */}
        {!activeProjectLoading && activeProject && activeProject.claudeMd !== undefined && (
          <ClaudeMdSection
            project={activeProject}
            selectedId={selectedId}
            onSelectClaudeMd={onSelectClaudeMd}
          />
        )}

        {!activeProjectLoading && activeProject && (
          <ActiveProjectContent
            project={activeProject}
            selectedId={selectedId}
            onSelectResource={onSelectResource}
            onCreateWorkflow={onCreateWorkflow}
            onDeleteWorkflow={onDeleteWorkflow}
            onCreateAgent={onCreateAgent}
            onImportAgent={onImportAgent}
            onDeleteAgent={onDeleteAgent}
            onCreateSkill={onCreateSkill}
            onImportSkill={onImportSkill}
            onDeleteSkill={onDeleteSkill}
          />
        )}

        {/* Auxiliary sections */}
        <AuxiliarySection
          resources={auxiliaryResources}
          selectedId={selectedId}
          onSelect={onSelectResource}
          mcpServerNames={mcpServerNames}
          onOpenGlobalConfig={onOpenGlobalConfig}
        />

        {/* Community links */}
        <CommunityLinks />
      </div>
    </nav>
  );
}

interface ActiveProjectContentProps {
  readonly project: Project;
  readonly selectedId: string | null;
  readonly onSelectResource: (resource: Resource) => void;
  readonly onCreateWorkflow: (project: Project, template?: Workflow) => void;
  readonly onDeleteWorkflow?: (workflow: Resource) => void;
  readonly onCreateAgent?: () => void;
  readonly onImportAgent?: (name: string, content: string) => void;
  readonly onDeleteAgent?: (agent: Resource) => void;
  readonly onCreateSkill?: () => void;
  readonly onImportSkill?: (name: string, content: string) => void;
  readonly onDeleteSkill?: (skill: Resource) => void;
}

function ActiveProjectContent({
  project,
  selectedId,
  onSelectResource,
  onCreateWorkflow,
  onDeleteWorkflow,
  onCreateAgent,
  onImportAgent,
  onDeleteAgent,
  onCreateSkill,
  onImportSkill,
  onDeleteSkill,
}: ActiveProjectContentProps) {
  return (
    <div>
      {/* Agents section */}
      <AgentsSection
        agents={project.agents}
        selectedId={selectedId}
        onSelectResource={onSelectResource}
        onCreateAgent={onCreateAgent}
        onImportAgent={onImportAgent}
        onDeleteAgent={onDeleteAgent}
      />

      {/* Skills section */}
      <SkillsSection
        skills={project.skills}
        selectedId={selectedId}
        onSelectResource={onSelectResource}
        onCreateSkill={onCreateSkill}
        onImportSkill={onImportSkill}
        onDeleteSkill={onDeleteSkill}
      />

      {/* Workflows section */}
      <WorkflowsSection
        project={project}
        workflows={project.workflows}
        selectedId={selectedId}
        onSelectResource={onSelectResource}
        onCreateWorkflow={onCreateWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
      />
    </div>
  );
}

interface ClaudeMdSectionProps {
  readonly project: Project;
  readonly selectedId: string | null;
  readonly onSelectClaudeMd: (project: Project) => void;
}

function ClaudeMdSection({ project, selectedId, onSelectClaudeMd }: ClaudeMdSectionProps) {
  const claudeMdId = `${project.id}:CLAUDE.md`;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => onSelectClaudeMd(project)}
        className={`w-full text-left transition-colors ${
          selectedId === claudeMdId
            ? 'bg-accent/15'
            : 'hover:bg-surface-hover'
        }`}
      >
        <StaticSectionHeader label="CLAUDE.md" />
      </button>
    </div>
  );
}

interface AgentsSectionProps {
  readonly agents: readonly Resource[];
  readonly selectedId: string | null;
  readonly onSelectResource: (resource: Resource) => void;
  readonly onCreateAgent?: () => void;
  readonly onImportAgent?: (name: string, content: string) => void;
  readonly onDeleteAgent?: (agent: Resource) => void;
}

function AgentsSection({ agents, selectedId, onSelectResource, onCreateAgent, onImportAgent, onDeleteAgent }: AgentsSectionProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, item: Resource) => {
      event.dataTransfer.setData(
        'application/cc-agent',
        JSON.stringify({ agent: item.name, agentId: item.id })
      );
      event.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, agent: Resource) => {
      e.stopPropagation();
      setConfirmDeleteId(agent.id);
    },
    [],
  );

  const handleConfirmDelete = useCallback(
    (e: React.MouseEvent, agent: Resource) => {
      e.stopPropagation();
      onDeleteAgent?.(agent);
      setConfirmDeleteId(null);
    },
    [onDeleteAgent],
  );

  const handleCancelDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirmDeleteId(null);
    },
    [],
  );

  return (
    <CollapsibleSection label="Agents" count={agents.length}>
      {agents.length > 0 ? (
        <ul className="flex flex-col">
          {agents.map((agent) => (
            <li key={agent.id}>
              {confirmDeleteId === agent.id ? (
                <div className="flex items-center gap-1 px-3 py-0.5">
                  <span className="text-[10px] text-red-400">Delete?</span>
                  <button
                    onClick={(e) => handleConfirmDelete(e, agent)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/20"
                  >
                    Yes
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  draggable="true"
                  onDragStart={(e) => handleDragStart(e, agent)}
                  onClick={() => onSelectResource(agent)}
                  className={`group w-full rounded px-3 py-0.5 text-left text-xs transition-colors cursor-grab active:cursor-grabbing ${
                    selectedId === agent.id
                      ? 'bg-accent/20 text-accent font-medium'
                      : 'text-foreground/70 hover:bg-surface-hover'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <GripVertical size={10} className="text-muted/0 group-hover:text-muted/50 transition-colors" />
                    <span className="flex-1 truncate">{agent.name}</span>
                    {onDeleteAgent && (
                      <Trash2
                        size={10}
                        className="shrink-0 text-muted/0 group-hover:text-muted/50 hover:!text-red-400 transition-colors"
                        onClick={(e) => handleDeleteClick(e, agent)}
                      />
                    )}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-1 text-[10px] text-muted/60">No agents</p>
      )}
      {(onCreateAgent || onImportAgent) && (
        <div className="mt-0.5 flex items-center">
          {onCreateAgent && (
            <button
              onClick={onCreateAgent}
              className="flex-1 rounded px-3 py-0.5 text-left text-xs text-accent/70 hover:bg-surface-hover hover:text-accent transition-colors"
            >
              <span className="flex items-center gap-1"><Plus size={12} /> New</span>
            </button>
          )}
          {onImportAgent && (
            <>
              <button
                onClick={() => importInputRef.current?.click()}
                className="flex-1 rounded px-3 py-0.5 text-left text-xs text-accent/70 hover:bg-surface-hover hover:text-accent transition-colors"
                title="Import agent from Markdown file"
              >
                <span className="flex items-center gap-1"><FileInput size={12} /> Import</span>
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".md"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const name = file.name.replace(/\.md$/i, '');
                  const reader = new FileReader();
                  reader.onload = () => {
                    onImportAgent(name, reader.result as string);
                  };
                  reader.readAsText(file);
                  event.target.value = '';
                }}
                className="hidden"
              />
            </>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

interface SkillsSectionProps {
  readonly skills: readonly Resource[];
  readonly selectedId: string | null;
  readonly onSelectResource: (resource: Resource) => void;
  readonly onCreateSkill?: () => void;
  readonly onImportSkill?: (name: string, content: string) => void;
  readonly onDeleteSkill?: (skill: Resource) => void;
}

function SkillsSection({ skills, selectedId, onSelectResource, onCreateSkill, onImportSkill, onDeleteSkill }: SkillsSectionProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, item: Resource) => {
      event.dataTransfer.setData(
        'application/cc-skill',
        JSON.stringify({ name: item.name }),
      );
      event.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, skill: Resource) => {
      e.stopPropagation();
      setConfirmDeleteId(skill.id);
    },
    [],
  );

  const handleConfirmDelete = useCallback(
    (e: React.MouseEvent, skill: Resource) => {
      e.stopPropagation();
      onDeleteSkill?.(skill);
      setConfirmDeleteId(null);
    },
    [onDeleteSkill],
  );

  const handleCancelDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirmDeleteId(null);
    },
    [],
  );

  return (
    <CollapsibleSection label="Skills" count={skills.length}>
      {skills.length > 0 ? (
        <ul className="flex flex-col">
          {skills.map((skill) => (
            <li key={skill.id}>
              {confirmDeleteId === skill.id ? (
                <div className="flex items-center gap-1 px-3 py-0.5">
                  <span className="text-[10px] text-red-400">Delete?</span>
                  <button
                    onClick={(e) => handleConfirmDelete(e, skill)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/20"
                  >
                    Yes
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  draggable="true"
                  onDragStart={(e) => handleDragStart(e, skill)}
                  onClick={() => onSelectResource(skill)}
                  className={`group w-full rounded px-3 py-0.5 text-left text-xs transition-colors cursor-grab active:cursor-grabbing ${
                    selectedId === skill.id
                      ? 'bg-accent/20 text-accent font-medium'
                      : 'text-foreground/70 hover:bg-surface-hover'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <GripVertical size={10} className="text-muted/0 group-hover:text-muted/50 transition-colors" />
                    <span className="flex-1 truncate">{skill.name}</span>
                    {onDeleteSkill && (
                      <Trash2
                        size={10}
                        className="shrink-0 text-muted/0 group-hover:text-muted/50 hover:!text-red-400 transition-colors"
                        onClick={(e) => handleDeleteClick(e, skill)}
                      />
                    )}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-1 text-[10px] text-muted/60">No skills</p>
      )}
      {(onCreateSkill || onImportSkill) && (
        <div className="mt-0.5 flex items-center">
          {onCreateSkill && (
            <button
              onClick={onCreateSkill}
              className="flex-1 rounded px-3 py-0.5 text-left text-xs text-accent/70 hover:bg-surface-hover hover:text-accent transition-colors"
            >
              <span className="flex items-center gap-1"><Plus size={12} /> New</span>
            </button>
          )}
          {onImportSkill && (
            <>
              <button
                onClick={() => importInputRef.current?.click()}
                className="flex-1 rounded px-3 py-0.5 text-left text-xs text-accent/70 hover:bg-surface-hover hover:text-accent transition-colors"
                title="Import skill from Markdown file"
              >
                <span className="flex items-center gap-1"><FileInput size={12} /> Import</span>
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".md"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const name = file.name.replace(/\.md$/i, '');
                  const reader = new FileReader();
                  reader.onload = () => {
                    onImportSkill(name, reader.result as string);
                  };
                  reader.readAsText(file);
                  event.target.value = '';
                }}
                className="hidden"
              />
            </>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

interface WorkflowsSectionProps {
  readonly project: Project;
  readonly workflows: readonly Resource[];
  readonly selectedId: string | null;
  readonly onSelectResource: (resource: Resource) => void;
  readonly onCreateWorkflow: (project: Project, template?: Workflow) => void;
  readonly onDeleteWorkflow?: (workflow: Resource) => void;
}

function WorkflowsSection({
  project,
  workflows,
  selectedId,
  onSelectResource,
  onCreateWorkflow,
  onDeleteWorkflow,
}: WorkflowsSectionProps) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleNewBlank = useCallback(() => {
    onCreateWorkflow(project);
    setShowTemplates(false);
  }, [project, onCreateWorkflow]);

  const handleNewFromTemplate = useCallback((template: Workflow) => {
    onCreateWorkflow(project, template);
    setShowTemplates(false);
  }, [project, onCreateWorkflow]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, workflow: Resource) => {
      e.stopPropagation();
      setConfirmDeleteId(workflow.id);
    },
    [],
  );

  const handleConfirmDelete = useCallback(
    (e: React.MouseEvent, workflow: Resource) => {
      e.stopPropagation();
      onDeleteWorkflow?.(workflow);
      setConfirmDeleteId(null);
    },
    [onDeleteWorkflow],
  );

  const handleCancelDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirmDeleteId(null);
    },
    [],
  );

  const handleImportFile = useCallback(
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
          onCreateWorkflow(project, parsed as Workflow);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unknown parse error';
          window.alert(`Failed to parse YAML:\n${message}`);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },
    [project, onCreateWorkflow],
  );

  return (
    <CollapsibleSection label="Workflows" count={workflows.length}>
      {workflows.length > 0 && (
        <ul className="flex flex-col">
          {workflows.map((wf) => (
            <li key={wf.id}>
              {confirmDeleteId === wf.id ? (
                <div className="flex items-center gap-1 px-3 py-0.5">
                  <span className="text-[10px] text-red-400">Delete?</span>
                  <button
                    onClick={(e) => handleConfirmDelete(e, wf)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/20"
                  >
                    Yes
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => onSelectResource(wf)}
                  className={`group w-full rounded px-3 py-0.5 text-left text-xs transition-colors ${
                    selectedId === wf.id
                      ? 'bg-accent/20 text-accent font-medium'
                      : 'text-foreground/70 hover:bg-surface-hover'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-[10px]" />
                    <span className="flex-1 truncate">{wf.name}</span>
                    {onDeleteWorkflow && (
                      <Trash2
                        size={10}
                        className="shrink-0 text-muted/0 group-hover:text-muted/50 hover:!text-red-400 transition-colors"
                        onClick={(e) => handleDeleteClick(e, wf)}
                      />
                    )}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="relative mt-0.5 flex items-center">
        <button
          onClick={() => setShowTemplates((prev) => !prev)}
          className="flex-1 rounded px-3 py-0.5 text-left text-xs text-accent/70 hover:bg-surface-hover hover:text-accent transition-colors"
        >
          <span className="flex items-center gap-1"><Plus size={12} /> New</span>
        </button>
        <button
          onClick={handleImportClick}
          className="flex-1 rounded px-3 py-0.5 text-left text-xs text-accent/70 hover:bg-surface-hover hover:text-accent transition-colors"
          title="Import workflow from YAML file"
        >
          <span className="flex items-center gap-1"><FileInput size={12} /> Import</span>
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".yaml,.yml"
          onChange={handleImportFile}
          className="hidden"
        />
        {showTemplates && (
          <div className="absolute left-0 top-full z-10 mt-0.5 w-full rounded border border-border bg-surface shadow-lg">
            <button
              onClick={handleNewBlank}
              className="w-full px-3 py-1.5 text-left text-xs text-foreground/70 hover:bg-surface-hover"
            >
              Blank
            </button>
            <div className="border-t border-border">
              <p className="px-3 py-1 text-[9px] uppercase tracking-wider text-muted">Templates</p>
              {WORKFLOW_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => handleNewFromTemplate(tpl.workflow)}
                  className="w-full px-3 py-1 text-left hover:bg-surface-hover"
                >
                  <span className="block text-xs text-foreground/70">{tpl.name}</span>
                  <span className="block text-[10px] text-muted/60">{tpl.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

interface ClaudeConfigSectionProps {
  readonly onOpen: () => void;
}

function ClaudeConfigSection({ onOpen }: ClaudeConfigSectionProps) {
  return (
    <div className="mt-1.5">
      <button
        onClick={onOpen}
        className="w-full text-left transition-colors hover:bg-surface-hover"
      >
        <StaticSectionHeader label="Claude Config" />
      </button>
    </div>
  );
}

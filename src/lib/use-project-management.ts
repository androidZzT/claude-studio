'use client';

import { useState, useCallback, useEffect } from 'react';
import type { Project } from '@/types/resources';
import type { NewProjectFormData } from '@/components/projects/NewProjectModal';
import {
  useProjectOpen,
  useCreateProject,
  loadStoredProjectId,
  storeProjectId,
  loadRecentProjects,
  addRecentProject,
  removeRecentProject,
  type RecentProject,
} from '@/lib/use-projects';

interface UseProjectManagementResult {
  readonly projectOpen: ReturnType<typeof useProjectOpen>;
  readonly activeProject: Project | null;
  readonly activeProjectId: string | null;
  readonly recentProjects: readonly RecentProject[];
  readonly openError: string | null;
  readonly openModalOpen: boolean;
  readonly newModalOpen: boolean;
  readonly projectCreateLoading: boolean;
  readonly projectCreateError: string | null;
  readonly setOpenModalOpen: (open: boolean) => void;
  readonly setNewModalOpen: (open: boolean) => void;
  readonly handleOpenProjectFromPath: (projectPath: string) => Promise<void>;
  readonly handleCloseProject: () => void;
  readonly handleSelectRecent: (projectPath: string) => void;
  readonly handleRemoveRecent: (projectPath: string) => void;
  readonly handleCreateProject: (data: NewProjectFormData) => Promise<void>;
  readonly clearOpenError: () => void;
}

export function useProjectManagement(): UseProjectManagementResult {
  const projectOpen = useProjectOpen();
  const projectCreate = useCreateProject();

  const [recentProjects, setRecentProjects] = useState<readonly RecentProject[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [newModalOpen, setNewModalOpen] = useState(false);

  const activeProject = projectOpen.project;
  const activeProjectId = activeProject?.id ?? null;

  const handleOpenProjectFromPath = useCallback(async (projectPath: string) => {
    setOpenError(null);
    const project = await projectOpen.openProject(projectPath);
    if (project) {
      storeProjectId(project.id);
      const updated = addRecentProject(project.path, project.name);
      setRecentProjects(updated);
      setOpenModalOpen(false);
    } else {
      setOpenError(projectOpen.error ?? 'Failed to open project');
    }
  }, [projectOpen]);

  const handleCloseProject = useCallback(() => {
    projectOpen.closeProject();
    storeProjectId(null);
  }, [projectOpen]);

  const handleSelectRecent = useCallback((projectPath: string) => {
    handleOpenProjectFromPath(projectPath);
  }, [handleOpenProjectFromPath]);

  const handleRemoveRecent = useCallback((projectPath: string) => {
    const updated = removeRecentProject(projectPath);
    setRecentProjects(updated);
  }, []);

  const handleCreateProject = useCallback(async (data: NewProjectFormData) => {
    const project = await projectCreate.createProject({
      name: data.name,
      parentDir: data.parentDir,
      template: data.template,
    });
    if (project) {
      const opened = await projectOpen.openProject(project.path);
      if (opened) {
        storeProjectId(opened.id);
        const updated = addRecentProject(opened.path, opened.name);
        setRecentProjects(updated);
        setNewModalOpen(false);
      }
    }
  }, [projectCreate, projectOpen]);

  const clearOpenError = useCallback(() => {
    setOpenError(null);
  }, []);

  // Restore last project and recent projects on mount
  useEffect(() => {
    setRecentProjects(loadRecentProjects());
    const storedId = loadStoredProjectId();
    if (storedId) {
      const decoded = decodeURIComponent(storedId);
      if (decoded.startsWith('/')) {
        projectOpen.openProject(decoded);
      }
    }
    // Intentionally run only once on mount to restore the last-opened project.
    // projectOpen.openProject is stable (useCallback with no deps) but the
    // exhaustive-deps rule cannot verify that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    projectOpen,
    activeProject,
    activeProjectId,
    recentProjects,
    openError,
    openModalOpen,
    newModalOpen,
    projectCreateLoading: projectCreate.loading,
    projectCreateError: projectCreate.error,
    setOpenModalOpen,
    setNewModalOpen,
    handleOpenProjectFromPath,
    handleCloseProject,
    handleSelectRecent,
    handleRemoveRecent,
    handleCreateProject,
    clearOpenError,
  };
}

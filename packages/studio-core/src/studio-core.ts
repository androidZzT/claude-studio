import type { Project, ProjectSummary, Resource, ResourceType } from './types';
import {
  fileExists,
  readProjectSettings,
  readSettings,
  writeProjectLocalSettings,
  writeProjectSharedSettings,
  writeSettings,
  readResourceFile,
  listResourceFiles,
  writeResourceFile,
  deleteResourceFile,
} from './file-ops';
import {
  scanAllProjects,
  scanAllProjectSummaries,
  scanProjectAtPath,
  scanProjectById,
} from './project-scanner';
import { createProject, type CreateProjectParams } from './project-creation';
import {
  getExecution,
  removeExecution,
  startExecution,
  type ExecutionRunner,
  type ExecutionOptions,
  type WorkflowInput,
} from './execution-engine';
import { validateWorkflow, type ValidationResult } from './workflow-validation';

export interface StudioCore {
  readonly resources: {
    readonly readResourceFile: (filePath: string, type: ResourceType, baseDir?: string) => Promise<Resource>;
    readonly listResourceFiles: (type: ResourceType) => Promise<Resource[]>;
    readonly writeResourceFile: (
      type: ResourceType,
      id: string,
      content: string,
      frontmatter?: Record<string, unknown>,
    ) => Promise<Resource>;
    readonly deleteResourceFile: (type: ResourceType, id: string) => Promise<void>;
  };
  readonly settings: {
    readonly readSettings: () => Promise<Record<string, unknown>>;
    readonly writeSettings: (settings: Record<string, unknown>) => Promise<void>;
    readonly readProjectSettings: (
      projectPath: string,
    ) => Promise<{ shared: Record<string, unknown>; local: Record<string, unknown> }>;
    readonly writeProjectSharedSettings: (
      projectPath: string,
      settings: Record<string, unknown>,
    ) => Promise<void>;
    readonly writeProjectLocalSettings: (
      projectPath: string,
      settings: Record<string, unknown>,
    ) => Promise<void>;
  };
  readonly projects: {
    readonly scanProjectAtPath: (projectPath: string) => Promise<Project>;
    readonly scanProjectById: (id: string) => Promise<Project | null>;
    readonly scanAllProjectSummaries: () => Promise<readonly ProjectSummary[]>;
    readonly scanAllProjects: () => Promise<readonly Project[]>;
    readonly createProject: (params: CreateProjectParams) => Promise<Project>;
  };
  readonly workflows: {
    readonly validateWorkflow: (workflow: unknown) => ValidationResult;
  };
  readonly files: {
    readonly fileExists: (filePath: string) => Promise<boolean>;
  };
  readonly executions: {
    readonly startExecution: (workflow: WorkflowInput, options?: ExecutionOptions) => ExecutionRunner;
    readonly getExecution: (id: string) => ExecutionRunner | undefined;
    readonly removeExecution: (id: string) => boolean;
  };
}

export function createStudioCore(): StudioCore {
  return {
    resources: {
      readResourceFile,
      listResourceFiles,
      writeResourceFile,
      deleteResourceFile,
    },
    settings: {
      readSettings,
      writeSettings,
      readProjectSettings,
      writeProjectSharedSettings,
      writeProjectLocalSettings,
    },
    projects: {
      scanProjectAtPath,
      scanProjectById,
      scanAllProjectSummaries,
      scanAllProjects,
      createProject,
    },
    workflows: {
      validateWorkflow,
    },
    files: {
      fileExists,
    },
    executions: {
      startExecution,
      getExecution,
      removeExecution,
    },
  };
}

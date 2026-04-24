import type { Project, ProjectSummary } from '@/types/resources';
import {
  scanAllProjects as coreScanAllProjects,
  scanAllProjectSummaries as coreScanAllProjectSummaries,
  scanProjectAtPath as coreScanProjectAtPath,
  scanProjectById as coreScanProjectById,
} from '@studio-core/project-scanner';

export async function scanProjectAtPath(projectPath: string): Promise<Project> {
  return coreScanProjectAtPath(projectPath) as Promise<Project>;
}

export async function scanAllProjectSummaries(): Promise<readonly ProjectSummary[]> {
  return coreScanAllProjectSummaries() as Promise<readonly ProjectSummary[]>;
}

export async function scanAllProjects(): Promise<readonly Project[]> {
  return coreScanAllProjects() as Promise<readonly Project[]>;
}

export async function scanProjectById(id: string): Promise<Project | null> {
  return coreScanProjectById(id) as Promise<Project | null>;
}


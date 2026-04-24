import type { Project, ProjectSummary } from './types';
/**
 * Scan a project at the given path. Creates .claude/ directory if needed.
 * This is the public API used by the open/create routes.
 */
export declare function scanProjectAtPath(projectPath: string): Promise<Project>;
export declare function scanAllProjectSummaries(): Promise<readonly ProjectSummary[]>;
export declare function scanAllProjects(): Promise<readonly Project[]>;
export declare function scanProjectById(id: string): Promise<Project | null>;

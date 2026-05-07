import { type ProjectTemplate } from './project-templates';
import type { Project } from './types';
export interface CreateProjectParams {
    readonly name: string;
    readonly parentDir?: string;
    readonly template?: ProjectTemplate;
}
export declare function createProject(params: CreateProjectParams): Promise<Project>;

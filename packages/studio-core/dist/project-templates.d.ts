import { type AgentTemplate } from './agent-templates';
export type ProjectTemplate = 'blank' | 'dev-team' | 'ops-team';
export interface ProjectTemplateInfo {
    readonly id: ProjectTemplate;
    readonly name: string;
    readonly description: string;
}
export declare const PROJECT_TEMPLATES: readonly ProjectTemplateInfo[];
export declare function getProjectTemplateAgents(template: ProjectTemplate | string): readonly AgentTemplate[];

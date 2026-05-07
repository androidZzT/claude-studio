import type { ResourceType } from './types';
export declare function getResourceDir(type: ResourceType): string;
export declare function getSettingsPath(): string;
export declare function getRootConfigPath(): string;
export declare function encodeProjectPath(projectPath: string): string;
export declare function getProjectSharedSettingsPath(projectPath: string): string;
export declare function getProjectLocalSettingsPath(projectPath: string): string;

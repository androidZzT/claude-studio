import type { Resource, ResourceType } from './types';
export declare function fileExists(filePath: string): Promise<boolean>;
export declare function readResourceFile(filePath: string, type: ResourceType, baseDir?: string): Promise<Resource>;
export declare function listResourceFiles(type: ResourceType): Promise<Resource[]>;
export declare function writeResourceFile(type: ResourceType, id: string, content: string, frontmatter?: Record<string, unknown>): Promise<Resource>;
export declare function deleteResourceFile(type: ResourceType, id: string): Promise<void>;
export declare function readSettings(): Promise<Record<string, unknown>>;
export declare function writeSettings(settings: Record<string, unknown>): Promise<void>;
export declare function readProjectSettings(projectPath: string): Promise<{
    shared: Record<string, unknown>;
    local: Record<string, unknown>;
}>;
export declare function writeProjectSharedSettings(projectPath: string, settings: Record<string, unknown>): Promise<void>;
export declare function writeProjectLocalSettings(projectPath: string, settings: Record<string, unknown>): Promise<void>;

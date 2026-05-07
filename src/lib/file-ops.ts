import type { Resource, ResourceType } from '@/types/resources';
import type { ResourceType as CoreResourceType } from '@studio-core/types';
import {
  deleteResourceFile as coreDeleteResourceFile,
  fileExists as coreFileExists,
  listResourceFiles as coreListResourceFiles,
  readProjectSettings as coreReadProjectSettings,
  readResourceFile as coreReadResourceFile,
  readSettings as coreReadSettings,
  writeProjectLocalSettings as coreWriteProjectLocalSettings,
  writeProjectSharedSettings as coreWriteProjectSharedSettings,
  writeResourceFile as coreWriteResourceFile,
  writeSettings as coreWriteSettings,
} from '@studio-core/file-ops';

function toCoreType(type: ResourceType): CoreResourceType {
  return type as CoreResourceType;
}

export const fileExists = coreFileExists;

export async function readResourceFile(
  filePath: string,
  type: ResourceType,
  baseDir?: string,
): Promise<Resource> {
  return coreReadResourceFile(filePath, toCoreType(type), baseDir) as Promise<Resource>;
}

export async function listResourceFiles(type: ResourceType): Promise<Resource[]> {
  return coreListResourceFiles(toCoreType(type)) as Promise<Resource[]>;
}

export async function writeResourceFile(
  type: ResourceType,
  id: string,
  content: string,
  frontmatter?: Record<string, unknown>,
): Promise<Resource> {
  return coreWriteResourceFile(
    toCoreType(type),
    id,
    content,
    frontmatter,
  ) as Promise<Resource>;
}

export async function deleteResourceFile(type: ResourceType, id: string): Promise<void> {
  return coreDeleteResourceFile(toCoreType(type), id);
}

export const readSettings = coreReadSettings;
export const writeSettings = coreWriteSettings;
export const readProjectSettings = coreReadProjectSettings;
export const writeProjectSharedSettings = coreWriteProjectSharedSettings;
export const writeProjectLocalSettings = coreWriteProjectLocalSettings;


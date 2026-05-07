import { z } from "zod";

import type { HarnessConfig } from "./harness-config.js";

const nonEmptyStringSchema = z.string().trim().min(1);

export const referenceProjectEntrySchema = z
  .object({
    path: nonEmptyStringSchema,
    git_url: nonEmptyStringSchema.optional(),
    description: nonEmptyStringSchema.optional()
  })
  .strict();

export const referenceProjectsConfigSchema = z
  .object({
    description: nonEmptyStringSchema.optional(),
    projects: z
      .record(nonEmptyStringSchema, referenceProjectEntrySchema)
      .refine((projects) => Object.keys(projects).length > 0, "reference_projects.projects must contain at least one project.")
  })
  .strict();

export type ReferenceProjectEntry = z.infer<typeof referenceProjectEntrySchema>;
export type ReferenceProjectsConfig = z.infer<typeof referenceProjectsConfigSchema>;

export function hasDeclaredReferenceProjects(config: HarnessConfig): boolean {
  return config.reference_projects !== undefined || Object.keys(config.projects?.references ?? {}).length > 0;
}

export function renderReferenceProjectsDocument(config: HarnessConfig): string | undefined {
  const projectReferences = config.projects?.references ?? {};
  const hasProjectReferences = Object.keys(projectReferences).length > 0;
  const referenceProjects = hasProjectReferences
    ? {
        description: config.reference_projects?.description,
        projects: projectReferences
      }
    : config.reference_projects;

  if (!referenceProjects) {
    return undefined;
  }

  const sortedProjects = Object.fromEntries(
    Object.keys(referenceProjects.projects)
      .sort((left, right) => left.localeCompare(right))
      .map((projectId) => {
        const project = referenceProjects.projects[projectId]!;

        return [
          projectId,
          {
            path: project.path,
            ...(project.git_url ? { git_url: project.git_url } : {}),
            ...(project.description ? { description: project.description } : {})
          }
        ];
      })
  );

  return `${JSON.stringify(
    {
      ...(referenceProjects.description ? { description: referenceProjects.description } : {}),
      projects: sortedProjects
    },
    null,
    2
  )}\n`;
}

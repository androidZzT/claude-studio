import { z } from "zod";

import { BOOTSTRAP_STAGE, DEFAULT_NEXT_COMMAND, DEFAULT_PROJECT_NAME } from "./constants.js";

const workspaceInputSchema = z
  .object({
    name: z.string().trim().min(1).optional()
  })
  .default({});

export interface WorkspaceSummary {
  readonly name: string;
  readonly stage: typeof BOOTSTRAP_STAGE;
  readonly ready: boolean;
  readonly nextCommand: string;
}

export function createWorkspaceSummary(input: unknown): WorkspaceSummary {
  const { name } = workspaceInputSchema.parse(input);

  return Object.freeze({
    name: name ?? DEFAULT_PROJECT_NAME,
    stage: BOOTSTRAP_STAGE,
    ready: false,
    nextCommand: DEFAULT_NEXT_COMMAND
  });
}

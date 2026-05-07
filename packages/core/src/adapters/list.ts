import { z } from "zod";

import type { HarnessConfig } from "../harness-config.js";
import { toolNameSchema } from "../harness-config.js";

import type { Adapter } from "./types.js";

export const adapterListEntrySchema = z
  .object({
    id: toolNameSchema,
    registered: z.literal(true),
    enabled_in_config: z.boolean(),
    target: z.string().trim().min(1).nullable()
  })
  .strict();

export const adaptersListReportSchema = z
  .object({
    adapters: z.array(adapterListEntrySchema)
  })
  .strict();

export type AdapterListEntry = z.infer<typeof adapterListEntrySchema>;
export type AdaptersListReport = z.infer<typeof adaptersListReportSchema>;

function isEnabledInConfig(config: HarnessConfig, adapterId: Adapter["id"]): boolean {
  return config.tools.includes(adapterId) && config.adapters[adapterId]?.enabled !== false;
}

export function describeConfiguredAdapters(config: HarnessConfig, registeredAdapters: readonly Adapter[]): AdaptersListReport {
  return adaptersListReportSchema.parse({
    adapters: [...registeredAdapters]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((adapter) => ({
        id: adapter.id,
        registered: true,
        enabled_in_config: isEnabledInConfig(config, adapter.id),
        target: config.adapters[adapter.id]?.target ?? null
      }))
  });
}

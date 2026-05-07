import type { HarnessConfig, ToolName } from "../harness-config.js";
import type { PlannedFile } from "../sync-types.js";

export interface AdapterCapabilities {
  readonly features: readonly string[];
}

export interface AdapterPlanOptions {
  readonly onWarning?: (message: string) => void;
}

export interface Adapter {
  readonly id: ToolName;
  plan(config: HarnessConfig, cwd: string, options?: AdapterPlanOptions): Promise<PlannedFile[]>;
  capabilities(): AdapterCapabilities;
}

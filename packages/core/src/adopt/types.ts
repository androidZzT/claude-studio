import type { ClaudeCodeCapability, HarnessConfig, McpConfig, PluginsConfig } from "../harness-config.js";

export interface AdoptFile {
  readonly targetPath: string;
  readonly sourcePath?: string;
  readonly content?: string | Uint8Array;
  readonly mode: number;
}

export interface CapabilityExtraction {
  readonly capability: ClaudeCodeCapability;
  readonly files: readonly AdoptFile[];
  readonly warnings?: readonly string[];
}

export interface SettingsExtraction {
  readonly hooks?: HarnessConfig["hooks"];
  readonly mcp?: McpConfig;
  readonly plugins?: PluginsConfig;
  readonly warnings: readonly string[];
}

export interface AdoptBuildInput {
  readonly description: string;
  readonly hooks?: HarnessConfig["hooks"];
  readonly mcp?: McpConfig;
  readonly name: string;
  readonly plugins?: PluginsConfig;
  readonly capabilities: readonly ClaudeCodeCapability[];
}

export interface AdoptOptions {
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly interactive?: boolean;
  readonly name?: string;
  readonly outputDir?: string;
  readonly skipCapabilities?: readonly string[];
  readonly tools?: readonly string[];
}

export interface AdoptResult {
  readonly targetDir: string;
  readonly createdFiles: readonly string[];
  readonly detectedCapabilities: readonly ClaudeCodeCapability[];
  readonly skippedCapabilities: readonly string[];
  readonly warnings: readonly string[];
  readonly dryRun: boolean;
}

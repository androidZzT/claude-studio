import * as TOML from "@iarna/toml";
import { z } from "zod";

import type { HarnessConfig } from "./harness-config.js";

const mcpServerNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export const mcpServerNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(mcpServerNamePattern, "MCP server names must be legal identifiers.");

export const mcpServerSchema = z
  .object({
    command: z.string().trim().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string().trim().min(1), z.string()).default({})
  })
  .strict();

export const mcpConfigSchema = z
  .object({
    servers: z.record(mcpServerNameSchema, mcpServerSchema).default({})
  })
  .strict();

export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;

function sortObjectKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(record).sort((left, right) => left.localeCompare(right)).map((key) => [key, record[key]!]));
}

function sortServer(server: McpServer): McpServer {
  return {
    command: server.command,
    args: [...server.args],
    env: sortObjectKeys(server.env)
  };
}

export function hasDeclaredMcp(config: HarnessConfig): boolean {
  return config.mcp !== undefined;
}

export function hasNonEmptyMcpServers(config: HarnessConfig): boolean {
  return Object.keys(config.mcp?.servers ?? {}).length > 0;
}

export function getSortedMcpServers(config: HarnessConfig): Record<string, McpServer> {
  const servers = config.mcp?.servers ?? {};

  return Object.fromEntries(
    Object.keys(servers)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => [name, sortServer(servers[name]!)])
  );
}

export function renderCursorMcpDocument(config: HarnessConfig): string | undefined {
  if (!hasDeclaredMcp(config)) {
    return undefined;
  }

  return `${JSON.stringify({ mcpServers: getSortedMcpServers(config) }, null, 2)}\n`;
}

export function renderCodexMcpFragment(config: HarnessConfig): string {
  const servers = getSortedMcpServers(config);
  const serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    return "";
  }

  return (
    serverNames
      .map((name) => {
        const server = servers[name]!;

        return [
          `[mcp_servers.${name}]`,
          `command = ${TOML.stringify.value(server.command)}`,
          `args = ${TOML.stringify.value(server.args)}`,
          `env = ${TOML.stringify.value(server.env)}`
        ].join("\n");
      })
      .join("\n\n") + "\n"
  );
}

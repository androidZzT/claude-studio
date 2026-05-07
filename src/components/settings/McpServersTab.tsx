'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { McpServerConfig } from '@/types/settings';
import { createEmptyMcpServer } from '@/types/settings';

interface McpServersTabProps {
  readonly servers: Readonly<Record<string, McpServerConfig>>;
  readonly onChange: (servers: Readonly<Record<string, McpServerConfig>>) => void;
}

export function McpServersTab({ servers, onChange }: McpServersTabProps) {
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState('');

  const serverEntries = Object.entries(servers);

  const handleAddServer = useCallback(() => {
    const name = newServerName.trim();
    if (!name || name in servers) return;
    onChange({ ...servers, [name]: createEmptyMcpServer() });
    setNewServerName('');
    setExpandedServer(name);
  }, [newServerName, servers, onChange]);

  const handleRemoveServer = useCallback((name: string) => {
    const rest = { ...servers };
    delete rest[name];
    onChange(rest);
    if (expandedServer === name) setExpandedServer(null);
  }, [servers, onChange, expandedServer]);

  const handleUpdateServer = useCallback((name: string, updated: McpServerConfig) => {
    onChange({ ...servers, [name]: updated });
  }, [servers, onChange]);

  const handleToggleExpand = useCallback((name: string) => {
    setExpandedServer((prev) => (prev === name ? null : name));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {serverEntries.length === 0 && (
        <p className="py-4 text-center text-xs text-muted">No MCP servers configured</p>
      )}

      {serverEntries.map(([name, config]) => (
        <McpServerItem
          key={name}
          name={name}
          config={config}
          expanded={expandedServer === name}
          onToggle={() => handleToggleExpand(name)}
          onUpdate={(updated) => handleUpdateServer(name, updated)}
          onRemove={() => handleRemoveServer(name)}
        />
      ))}

      {/* Add server */}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <input
          type="text"
          value={newServerName}
          onChange={(e) => setNewServerName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddServer()}
          placeholder="Server name"
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
        />
        <button
          onClick={handleAddServer}
          disabled={!newServerName.trim() || newServerName.trim() in servers}
          className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

interface McpServerItemProps {
  readonly name: string;
  readonly config: McpServerConfig;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onUpdate: (config: McpServerConfig) => void;
  readonly onRemove: () => void;
}

function McpServerItem({ name, config, expanded, onToggle, onUpdate, onRemove }: McpServerItemProps) {
  const handleCommandChange = useCallback((command: string) => {
    onUpdate({ ...config, command });
  }, [config, onUpdate]);

  const handleArgsChange = useCallback((argsStr: string) => {
    const args = argsStr.split('\n').filter((a) => a.trim() !== '');
    onUpdate({ ...config, args });
  }, [config, onUpdate]);

  const handleEnvChange = useCallback((key: string, value: string, oldKey?: string) => {
    const newEnv = { ...config.env };
    if (oldKey && oldKey !== key) {
      delete newEnv[oldKey];
    }
    newEnv[key] = value;
    onUpdate({ ...config, env: newEnv });
  }, [config, onUpdate]);

  const handleEnvRemove = useCallback((key: string) => {
    const rest = { ...config.env };
    delete rest[key];
    onUpdate({ ...config, env: rest });
  }, [config, onUpdate]);

  const handleEnvAdd = useCallback(() => {
    onUpdate({ ...config, env: { ...config.env, '': '' } });
  }, [config, onUpdate]);

  return (
    <div className="rounded border border-border bg-background">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-xs font-medium text-foreground"
        >
          <span className="text-muted">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
          {name}
        </button>
        <button
          onClick={onRemove}
          className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-400/10"
        >
          Remove
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {/* Command */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Command</span>
            <input
              type="text"
              value={config.command}
              onChange={(e) => handleCommandChange(e.target.value)}
              placeholder="e.g. node, npx, python"
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
          </label>

          {/* Args */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Args (one per line)</span>
            <textarea
              value={config.args.join('\n')}
              onChange={(e) => handleArgsChange(e.target.value)}
              placeholder="path/to/server.js"
              rows={2}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none font-mono"
            />
          </label>

          {/* Env vars */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Environment</span>
              <button
                onClick={handleEnvAdd}
                className="text-[10px] text-accent hover:text-accent-hover flex items-center gap-0.5"
              >
                <span>Add</span>
              </button>
            </div>
            {Object.entries(config.env).map(([key, value], idx) => (
              <EnvVarRow
                key={`${idx}-${key}`}
                envKey={key}
                envValue={value}
                onChange={(k, v) => handleEnvChange(k, v, key)}
                onRemove={() => handleEnvRemove(key)}
              />
            ))}
            {Object.keys(config.env).length === 0 && (
              <p className="text-[10px] text-muted/60">No environment variables</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface EnvVarRowProps {
  readonly envKey: string;
  readonly envValue: string;
  readonly onChange: (key: string, value: string) => void;
  readonly onRemove: () => void;
}

function EnvVarRow({ envKey, envValue, onChange, onRemove }: EnvVarRowProps) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={envKey}
        onChange={(e) => onChange(e.target.value, envValue)}
        placeholder="KEY"
        className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-mono text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
      />
      <span className="text-muted">=</span>
      <input
        type="text"
        value={envValue}
        onChange={(e) => onChange(envKey, e.target.value)}
        placeholder="value"
        className="flex-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-mono text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
      />
      <button
        onClick={onRemove}
        className="text-red-400 hover:text-red-300"
      >
        <X size={10} />
      </button>
    </div>
  );
}

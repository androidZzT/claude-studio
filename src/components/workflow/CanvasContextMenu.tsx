'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isProtectedNode } from '@/lib/workflow-constants';

interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

interface CanvasMenuState {
  readonly kind: 'canvas';
  readonly position: MenuPosition;
  readonly flowPosition: MenuPosition;
}

interface NodeMenuState {
  readonly kind: 'node';
  readonly position: MenuPosition;
  readonly nodeId: string;
  readonly agent?: string;
}

export type ContextMenuState = CanvasMenuState | NodeMenuState | null;

interface AgentOption {
  readonly name: string;
  readonly id: string;
}

interface CanvasContextMenuProps {
  readonly state: ContextMenuState;
  readonly agents: readonly AgentOption[];
  readonly onClose: () => void;
  readonly onAddNode: (agent: AgentOption, position: MenuPosition) => void;
  readonly onAddNote: (position: MenuPosition) => void;
  readonly onEditTask: (nodeId: string) => void;
  readonly onToggleCheckpoint: (nodeId: string) => void;
  readonly onDeleteNode: (nodeId: string) => void;
}

interface MenuItemProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly variant?: 'default' | 'danger';
}

function MenuItem({ label, onClick, variant = 'default' }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded px-3 py-1 text-left text-xs transition-colors ${
        variant === 'danger'
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-foreground/80 hover:bg-surface-hover'
      }`}
    >
      {label}
    </button>
  );
}

function AgentSubmenu({
  agents,
  onSelect,
}: {
  readonly agents: readonly AgentOption[];
  readonly onSelect: (agent: AgentOption) => void;
}) {
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = agents.filter((a) =>
    a.name.toLowerCase().includes(filter.toLowerCase())
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && filtered.length === 1) {
        e.preventDefault();
        onSelect(filtered[0]);
      }
    },
    [filtered, onSelect]
  );

  return (
    <div className="flex flex-col gap-0.5">
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search agents..."
        className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
      />
      <div className="max-h-32 overflow-y-auto">
        {filtered.length === 0 ? (
          <span className="block px-2 py-1 text-[10px] text-muted/60">No agents found</span>
        ) : (
          filtered.map((agent) => (
            <MenuItem
              key={agent.id}
              label={agent.name}
              onClick={() => onSelect(agent)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function CanvasContextMenu({
  state,
  agents,
  onClose,
  onAddNode,
  onAddNote,
  onEditTask,
  onToggleCheckpoint,
  onDeleteNode,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showAgentList, setShowAgentList] = useState(false);

  // Close on click outside
  useEffect(() => {
    if (!state) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [state, onClose]);

  // Reset submenu on state change
  useEffect(() => {
    setShowAgentList(false);
  }, [state]);

  const handleAddNodeClick = useCallback(() => {
    setShowAgentList(true);
  }, []);

  const handleAgentSelect = useCallback(
    (agent: AgentOption) => {
      if (state && state.kind === 'canvas') {
        onAddNode(agent, state.flowPosition);
      }
      onClose();
    },
    [state, onAddNode, onClose]
  );

  if (!state) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-md border border-border bg-surface p-1 shadow-xl"
      style={{ left: state.position.x, top: state.position.y }}
    >
      {state.kind === 'canvas' && (
        <>
          {showAgentList ? (
            <AgentSubmenu agents={agents} onSelect={handleAgentSelect} />
          ) : (
            <>
              <MenuItem label="Add Node" onClick={handleAddNodeClick} />
              <MenuItem
                label="Add Note"
                onClick={() => {
                  if (state.kind === 'canvas') {
                    onAddNote(state.flowPosition);
                  }
                  onClose();
                }}
              />
            </>
          )}
        </>
      )}

      {state.kind === 'node' && (
        <>
          <MenuItem label="Edit Task" onClick={() => { onEditTask(state.nodeId); onClose(); }} />
          <MenuItem label="Toggle Checkpoint" onClick={() => { onToggleCheckpoint(state.nodeId); onClose(); }} />
          {!isProtectedNode(state.nodeId, state.agent) && (
            <MenuItem label="Delete Node" onClick={() => { onDeleteNode(state.nodeId); onClose(); }} variant="danger" />
          )}
        </>
      )}
    </div>
  );
}

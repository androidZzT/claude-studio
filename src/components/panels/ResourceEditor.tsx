'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { Resource, Workflow } from '@/types/resources';
import { apiFetch, isVscodeBridgeEnabled } from '@/lib/api-client';
import { validateWorkflow } from '@/lib/workflow-validation';
import { workflowToClaudeMdLine } from '@/lib/workflow-to-claudemd';
import { parseWorkflowDocument } from '@/lib/workflow-document';

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted">
      Loading editor...
    </div>
  ),
});

interface ResourceEditorProps {
  readonly resource: Resource;
  readonly onSave: () => void;
  readonly fontSize?: number;
  readonly projectId?: string;
}

function useMonacoTheme(): string {
  const [theme, setTheme] = useState('vs-dark');

  useEffect(() => {
    const resolve = () => {
      const dt = document.documentElement.getAttribute('data-theme');
      setTheme(dt === 'claude-light' ? 'light' : 'vs-dark');
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function ResourceEditor({ resource, onSave, fontSize = 12, projectId }: ResourceEditorProps) {
  const monacoTheme = useMonacoTheme();
  const usePlainTextEditor = isVscodeBridgeEnabled();
  const [value, setValue] = useState(resource.content);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState<readonly string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setValue(resource.content);
    setDirty(false);
  }, [resource.content, resource.id]);

  const handleChange = useCallback(
    (newValue: string | undefined) => {
      if (newValue !== undefined) {
        setValue(newValue);
        setDirty(newValue !== resource.content);
      }
    },
    [resource.content]
  );

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;

    // Validate workflow YAML before saving
    if (resource.type === 'workflows') {
      const parsed = parseWorkflowDocument(value);
      if (!parsed) {
        setValidationErrors(['Invalid workflow document: expected YAML or markdown with a YAML code block']);
        return;
      }
      const result = validateWorkflow(parsed);
      if (!result.valid) {
        setValidationErrors(result.errors);
        return;
      }
    }

    setValidationErrors([]);
    setSaveError(null);
    setSaving(true);
    try {
      const isPathBased = resource.type === 'memories';
      const isClaudeMd = resource.path.endsWith('/CLAUDE.md') && projectId;
      const isProjectWorkflow = resource.type === 'workflows' && projectId;

      let url: string;
      let method: string;
      let payload: Record<string, unknown>;

      if (isPathBased) {
        url = '/api/files';
        method = 'PUT';
        payload = { path: resource.path, content: value, frontmatter: resource.frontmatter };
      } else if (isClaudeMd) {
        url = `/api/projects/${encodeURIComponent(projectId)}/claudemd`;
        method = 'POST';
        payload = { content: value };
      } else if (isProjectWorkflow) {
        url = `/api/projects/${encodeURIComponent(projectId)}/workflows`;
        method = 'PUT';
        payload = { name: resource.name, content: value };
      } else {
        url = `/api/resources/${resource.type}/${encodeURIComponent(resource.id)}`;
        method = 'PUT';
        payload = { content: value, frontmatter: resource.frontmatter };
      }

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        setDirty(false);
        setSaveError(null);
        onSave();

        // Sync workflow reference to CLAUDE.md (best-effort)
        if (resource.type === 'workflows' && projectId) {
          try {
            const parsed = parseWorkflowDocument(value);
            if (parsed) {
              const wf = parsed as Workflow;
              const workflowLine = workflowToClaudeMdLine(wf);
              apiFetch(`/api/projects/${projectId}/claudemd`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflowName: wf.name, workflowLine }),
              }).catch(() => {
                // CLAUDE.md sync is best-effort
              });
            }
          } catch {
            // Workflow parse error during sync — skip silently
          }
        }
      } else {
        const errorMsg = (json as { error?: string }).error ?? 'Failed to save';
        setSaveError(errorMsg);
        console.error('Save failed:', errorMsg);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save resource';
      setSaveError(message);
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, value, resource, onSave, projectId]);

  const language = 'markdown';

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {language}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            dirty
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-surface text-muted cursor-not-allowed'
          }`}
        >
          {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {/* Save Error */}
      {saveError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-300">{saveError}</p>
        </div>
      )}

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-400">
            Validation Errors
          </p>
          <ul className="flex flex-col gap-0.5">
            {validationErrors.map((err, i) => (
              <li key={i} className="text-xs text-red-300">{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Monaco Editor */}
      <div className="flex-1">
        {usePlainTextEditor ? (
          <textarea
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none border-0 bg-background px-3 py-2 font-mono text-foreground outline-none"
            style={{ fontSize, lineHeight: 1.6 }}
          />
        ) : (
          <MonacoEditor
            height="100%"
            language={language}
            theme={monacoTheme}
            value={value}
            onChange={handleChange}
            options={{
              minimap: { enabled: false },
              fontSize,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
              padding: { top: 8 },
            }}
          />
        )}
      </div>
    </div>
  );
}

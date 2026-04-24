'use client';

import { useCallback, useState } from 'react';
import { X, FileText, LayoutTemplate, Wand2, Loader2 } from 'lucide-react';
import { SKILL_TEMPLATES, type SkillTemplate } from '@/lib/skill-templates';
import { apiFetch } from '@/lib/api-client';
import { SkillTemplateCard } from './SkillTemplateCard';
import { SkillForm } from './SkillForm';

type ModalView = 'picker' | 'form';

export interface SkillFormData {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

interface SkillCreateModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (data: SkillFormData) => void;
  readonly saving: boolean;
}

const EMPTY_FORM: SkillFormData = {
  name: '',
  description: '',
  body: '',
};

function formFromTemplate(template: SkillTemplate): SkillFormData {
  return {
    name: template.name,
    description: template.description,
    body: template.body,
  };
}

export function SkillCreateModal({ open, onClose, onCreate, saving }: SkillCreateModalProps) {
  if (!open) return null;
  return (
    <SkillCreateModalInner onClose={onClose} onCreate={onCreate} saving={saving} />
  );
}

interface SkillCreateModalInnerProps {
  readonly onClose: () => void;
  readonly onCreate: (data: SkillFormData) => void;
  readonly saving: boolean;
}

function SkillCreateModalInner({ onClose, onCreate, saving }: SkillCreateModalInnerProps) {
  const [view, setView] = useState<ModalView>('picker');
  const [formData, setFormData] = useState<SkillFormData>(EMPTY_FORM);
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && !aiGenerating) onClose();
    },
    [onClose, aiGenerating],
  );

  const handleBlank = useCallback(() => {
    setFormData(EMPTY_FORM);
    setView('form');
  }, []);

  const handleSelectTemplate = useCallback((template: SkillTemplate) => {
    setFormData(formFromTemplate(template));
    setView('form');
  }, []);

  const handleBack = useCallback(() => {
    setView('picker');
    setAiError(null);
  }, []);

  const handleCreate = useCallback(() => {
    if (!formData.name.trim()) return;
    onCreate(formData);
  }, [formData, onCreate]);

  const handleAiGenerate = useCallback(async () => {
    const trimmed = aiDescription.trim();
    if (trimmed.length === 0 || aiGenerating) return;

    setAiGenerating(true);
    setAiError(null);

    try {
      const res = await apiFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'skill', description: trimmed }),
        signal: AbortSignal.timeout(65_000),
      });

      const json = await res.json();

      if (!json.success || json.data?.type !== 'skill') {
        setAiError(json.error ?? 'AI generation failed');
        setAiGenerating(false);
        return;
      }

      const { name, description, body } = json.data as {
        name: string;
        description: string;
        body: string;
      };

      setFormData({ name, description, body });
      setView('form');
      setAiGenerating(false);
      setAiError(null);
    } catch {
      setAiError('AI generation unavailable. Check that Claude CLI is installed.');
      setAiGenerating(false);
    }
  }, [aiDescription, aiGenerating]);

  const handleAiKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleAiGenerate();
      }
    },
    [handleAiGenerate],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={handleOverlayMouseDown}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {view === 'picker' ? 'New Skill' : 'Configure Skill'}
          </h2>
          <button
            onClick={onClose}
            disabled={aiGenerating}
            className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {view === 'picker' ? (
            <SkillTemplatePicker
              onBlank={handleBlank}
              onSelectTemplate={handleSelectTemplate}
              aiDescription={aiDescription}
              onAiDescriptionChange={setAiDescription}
              onAiGenerate={handleAiGenerate}
              onAiKeyDown={handleAiKeyDown}
              aiGenerating={aiGenerating}
              aiError={aiError}
            />
          ) : (
            <SkillForm data={formData} onChange={setFormData} />
          )}
        </div>

        {/* Footer */}
        {view === 'form' && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
            <button
              onClick={handleBack}
              className="rounded px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
            >
              Back
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!formData.name.trim() || saving}
                className={`rounded px-4 py-1.5 text-xs transition-colors ${
                  formData.name.trim() && !saving
                    ? 'bg-accent text-white hover:bg-accent-hover'
                    : 'cursor-not-allowed bg-surface text-muted'
                }`}
              >
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SkillTemplatePickerProps {
  readonly onBlank: () => void;
  readonly onSelectTemplate: (template: SkillTemplate) => void;
  readonly aiDescription: string;
  readonly onAiDescriptionChange: (value: string) => void;
  readonly onAiGenerate: () => void;
  readonly onAiKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly aiGenerating: boolean;
  readonly aiError: string | null;
}

function SkillTemplatePicker({
  onBlank,
  onSelectTemplate,
  aiDescription,
  onAiDescriptionChange,
  onAiGenerate,
  onAiKeyDown,
  aiGenerating,
  aiError,
}: SkillTemplatePickerProps) {
  return (
    <div className="space-y-4">
      {/* AI Generate option */}
      <div className="rounded border border-accent/30 bg-accent/5 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Wand2 size={14} className="text-accent" />
          <span className="text-[11px] font-semibold text-foreground/80">AI Generate</span>
        </div>
        <textarea
          value={aiDescription}
          onChange={(e) => onAiDescriptionChange(e.target.value)}
          onKeyDown={onAiKeyDown}
          placeholder="Describe the skill you need... e.g. A deployment skill that runs tests, builds, and deploys to production"
          className="mb-2 h-16 w-full resize-none rounded border border-border bg-background p-2 text-xs text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none disabled:opacity-50"
          disabled={aiGenerating}
        />
        {aiGenerating && (
          <div className="mb-2 flex items-center gap-2 text-[10px] text-accent">
            <Loader2 size={10} className="animate-spin" />
            Generating with Claude... this may take 10-30 seconds
          </div>
        )}
        {aiError && !aiGenerating && (
          <div className="mb-2 text-[10px] text-red-400">{aiError}</div>
        )}
        <button
          onClick={onAiGenerate}
          disabled={aiDescription.trim().length === 0 || aiGenerating}
          className={`flex items-center gap-1 rounded px-3 py-1 text-[11px] transition-colors ${
            aiDescription.trim().length > 0 && !aiGenerating
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'cursor-not-allowed bg-surface text-muted'
          }`}
        >
          {aiGenerating ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
          {aiGenerating ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {/* Blank option */}
      <button
        onClick={onBlank}
        className="flex w-full items-center gap-3 rounded border border-dashed border-border bg-background p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
      >
        <FileText size={20} className="shrink-0 text-muted" />
        <div>
          <span className="block text-xs font-medium text-foreground">Blank Skill</span>
          <span className="block text-[10px] text-muted/70">Start from scratch with an empty configuration</span>
        </div>
      </button>

      {/* Templates */}
      <div className="flex items-center gap-2">
        <LayoutTemplate size={14} className="text-muted" />
        <span className="text-[11px] font-semibold text-foreground/80">From Template</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SKILL_TEMPLATES.map((tpl) => (
          <SkillTemplateCard key={tpl.id} template={tpl} onSelect={onSelectTemplate} />
        ))}
      </div>
    </div>
  );
}

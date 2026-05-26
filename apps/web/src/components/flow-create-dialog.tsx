import type { CreateFlowBody, MutateFlowResult } from '@/lib/api';
import { slugify } from '@/lib/slugify';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@seeflow/canvas';
import { useEffect, useState } from 'react';

/**
 * US-025: client-side mirror of FlowIdPattern from apps/studio/src/schema.ts.
 * Exported so tests + the rename dialog can share the same constraint.
 */
export const FLOW_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// US-038: override the upstream DialogContent's bundled zoom + slide animations
// (baked into @seeflow/canvas DialogContent via cn() so the className can't
// simply be overridden — twMerge doesn't know tw-animate-css conflict groups).
// Setting the CSS variables that drive the enter/exit keyframes (see canvas
// dist/style.css `@keyframes enter|exit`) to the static centered transform
// neutralizes scale + slide while still letting `fade-in-0` / `fade-out-0`
// animate opacity. Result: opacity 0 ↔ 1 with the dialog held centered.
const FADE_ONLY_STYLE = {
  '--tw-enter-translate-x': '-50%',
  '--tw-enter-translate-y': '-50%',
  '--tw-exit-translate-x': '-50%',
  '--tw-exit-translate-y': '-50%',
  '--tw-enter-scale': '1',
  '--tw-exit-scale': '1',
} as React.CSSProperties;

export interface FlowCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Invoked with the validated request body. The caller drives the HTTP
   * call (typically `useProjectFlows().createFlow`) so the dialog stays
   * agnostic to where the mutation lives.
   */
  onCreate: (body: CreateFlowBody) => Promise<MutateFlowResult>;
  /**
   * Optional post-success callback. Receives the new entry so callers can
   * navigate to the just-created flow.
   */
  onCreated?: (result: MutateFlowResult) => void;
}

export function FlowCreateDialog({
  open,
  onOpenChange,
  onCreate,
  onCreated,
}: FlowCreateDialogProps) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idDirty, setIdDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setId('');
      setIdDirty(false);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleNameChange = (next: string) => {
    setName(next);
    if (!idDirty) {
      setId(slugify(next));
    }
  };

  const handleIdChange = (next: string) => {
    setId(next);
    if (!idDirty) setIdDirty(true);
  };

  const trimmedId = id.trim();
  const trimmedName = name.trim();
  const idValid = trimmedId.length > 0 && FLOW_ID_PATTERN.test(trimmedId);
  const canSubmit = idValid && trimmedName.length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      if (!idValid && trimmedId.length > 0) {
        setError('Flow id must match /^[a-z0-9][a-z0-9-]*$/');
      }
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateFlowBody = { id: trimmedId, name: trimmedName };
      const result = await onCreate(body);
      onCreated?.(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        style={FADE_ONLY_STYLE}
        data-testid="flow-create-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="flow-create-name-input"]',
          );
          input?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Create new flow</DialogTitle>
          <DialogDescription>
            A new flow folder is scaffolded under flows/&lt;id&gt;/ in your project.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Display name</span>
            <input
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              data-testid="flow-create-name-input"
              className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Flow id</span>
            <input
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="my-retry-flow"
              value={id}
              onChange={(e) => handleIdChange(e.target.value)}
              data-testid="flow-create-id-input"
              className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <span className="text-xs text-muted-foreground">
              Auto-filled from the display name. Lowercase letters, digits, and dashes; must start
              with a letter or digit.
            </span>
          </label>
          {error ? (
            <div
              role="alert"
              data-testid="flow-create-error"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="flow-create-submit">
              {submitting ? 'Creating…' : 'Create flow'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

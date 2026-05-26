import type { CreateFlowBody, MutateFlowResult } from '@/lib/api';
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
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setId('');
      setName('');
      setIcon('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const trimmedId = id.trim();
  const trimmedName = name.trim();
  const trimmedIcon = icon.trim();
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
      const body: CreateFlowBody = {
        id: trimmedId,
        name: trimmedName,
        ...(trimmedIcon.length > 0 ? { icon: trimmedIcon } : {}),
      };
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
        data-testid="flow-create-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="flow-create-id-input"]',
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
            <span className="font-medium">Flow id</span>
            <input
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="retry"
              value={id}
              onChange={(e) => setId(e.target.value)}
              data-testid="flow-create-id-input"
              className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <span className="text-xs text-muted-foreground">
              Lowercase letters, digits, and dashes. Must start with a letter or digit.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Display name</span>
            <input
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="flow-create-name-input"
              className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              Icon <span className="text-muted-foreground">(optional)</span>
            </span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="↩"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              data-testid="flow-create-icon-input"
              className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
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

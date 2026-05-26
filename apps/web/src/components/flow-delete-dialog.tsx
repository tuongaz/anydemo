import type { ProjectFlowSummary } from '@/lib/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@seeflow/canvas';
import { useEffect, useMemo, useState } from 'react';

export interface FlowDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The flow being deleted. */
  flow: { flowSlug: string; name: string; isDefault: boolean } | null;
  /** All flows in the project — used to populate the newDefault picker. */
  flows: readonly ProjectFlowSummary[];
  onDelete: (flowSlug: string, opts?: { newDefault?: string }) => Promise<{ ok: true }>;
  onDeleted?: (deletedFlowSlug: string, newDefault: string | undefined) => void;
}

export function FlowDeleteDialog({
  open,
  onOpenChange,
  flow,
  flows,
  onDelete,
  onDeleted,
}: FlowDeleteDialogProps) {
  const replacementOptions = useMemo<readonly ProjectFlowSummary[]>(
    () => flows.filter((f) => f.flowSlug !== flow?.flowSlug),
    [flows, flow?.flowSlug],
  );
  const initialReplacement = replacementOptions[0]?.flowSlug ?? '';
  const [newDefault, setNewDefault] = useState(initialReplacement);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNewDefault(initialReplacement);
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialReplacement]);

  if (!flow) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const requiresNewDefault = flow.isDefault;
  const hasReplacement = newDefault.length > 0;
  const canSubmit = (!requiresNewDefault || hasReplacement) && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const opts = requiresNewDefault ? { newDefault } : undefined;
      await onDelete(flow.flowSlug, opts);
      onDeleted?.(flow.flowSlug, opts?.newDefault);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="flow-delete-dialog">
        <DialogHeader>
          <DialogTitle>Delete flow</DialogTitle>
          <DialogDescription>
            This removes flows/{flow.flowSlug}/ from disk and updates seeflow.json. The action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm">
            Delete <span className="font-medium">{flow.name}</span>{' '}
            <span className="font-mono text-muted-foreground">({flow.flowSlug})</span>?
          </p>
          {requiresNewDefault ? (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">New default flow</span>
              <select
                value={newDefault}
                onChange={(e) => setNewDefault(e.target.value)}
                data-testid="flow-delete-new-default-select"
                className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {replacementOptions.map((opt) => (
                  <option key={opt.flowSlug} value={opt.flowSlug}>
                    {opt.name} ({opt.flowSlug})
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {flow.name} is the project default — pick a replacement before deleting.
              </span>
            </label>
          ) : null}
          {error ? (
            <div
              role="alert"
              data-testid="flow-delete-error"
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
            <Button
              type="submit"
              variant="destructive"
              disabled={!canSubmit}
              data-testid="flow-delete-submit"
            >
              {submitting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { FLOW_ID_PATTERN } from '@/components/flow-create-dialog';
import type { MutateFlowResult, PatchFlowBody } from '@/lib/api';
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

export interface FlowRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The flow being edited. Pre-fills the form so the user sees the current
   * values and only the changed fields land in the PATCH body.
   */
  flow: { flowSlug: string; name: string; icon?: string } | null;
  /**
   * Invoked with the validated patch body (only fields that actually changed).
   * Resolves with the updated registry entry.
   */
  onRename: (flowSlug: string, body: PatchFlowBody) => Promise<MutateFlowResult>;
  /**
   * Optional post-success callback — typically used to navigate to the new
   * flow URL when the id changed.
   */
  onRenamed?: (result: MutateFlowResult, previousFlowSlug: string) => void;
}

export function FlowRenameDialog({
  open,
  onOpenChange,
  flow,
  onRename,
  onRenamed,
}: FlowRenameDialogProps) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && flow) {
      setId(flow.flowSlug);
      setName(flow.name);
      setIcon(flow.icon ?? '');
      setError(null);
      setSubmitting(false);
    }
  }, [open, flow]);

  if (!flow) {
    // Render an empty Dialog with `open=false` semantics — keeps the hook
    // contract stable even if the caller renders the dialog before the
    // target flow resolves.
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const trimmedId = id.trim();
  const trimmedName = name.trim();
  const trimmedIcon = icon.trim();
  const idChanging = trimmedId !== flow.flowSlug;
  const nameChanging = trimmedName !== flow.name;
  const iconChanging = trimmedIcon !== (flow.icon ?? '');
  const idValid = trimmedId.length > 0 && FLOW_ID_PATTERN.test(trimmedId);
  const hasChange = idChanging || nameChanging || iconChanging;
  const canSubmit = idValid && trimmedName.length > 0 && hasChange && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      if (idChanging && !idValid) {
        setError('Flow id must match /^[a-z0-9][a-z0-9-]*$/');
      }
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: PatchFlowBody = {
        ...(idChanging ? { id: trimmedId } : {}),
        ...(nameChanging ? { name: trimmedName } : {}),
        ...(iconChanging ? { icon: trimmedIcon || undefined } : {}),
      };
      const result = await onRename(flow.flowSlug, body);
      onRenamed?.(result, flow.flowSlug);
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
        data-testid="flow-rename-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="flow-rename-name-input"]',
          );
          input?.focus();
          input?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename flow</DialogTitle>
          <DialogDescription>
            Renaming the id renames the flow folder on disk. The display name and icon are
            metadata-only.
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
              value={id}
              onChange={(e) => setId(e.target.value)}
              data-testid="flow-rename-id-input"
              className="rounded-md border bg-background px-3 py-2 font-mono text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <span className="text-xs text-muted-foreground">
              Renaming the id moves flows/{flow.flowSlug}/ on disk.
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
              data-testid="flow-rename-name-input"
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
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              data-testid="flow-rename-icon-input"
              className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>
          {error ? (
            <div
              role="alert"
              data-testid="flow-rename-error"
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
            <Button type="submit" disabled={!canSubmit} data-testid="flow-rename-submit">
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

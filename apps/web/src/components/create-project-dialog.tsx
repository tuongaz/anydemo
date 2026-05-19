import { type CreateProjectResult, createProject } from '@/lib/api';
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

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateProjectResult) => void;
}

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createProject({ name: trimmedName });
      onCreated(result);
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
        data-testid="create-project-dialog"
        onOpenAutoFocus={(e) => {
          // Default Radix behaviour focuses the close button; let our first
          // input grab focus instead.
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="create-project-name-input"]',
          );
          input?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Create new project</DialogTitle>
          <DialogDescription>
            The project will be created at <code>~/.seeflow/&lt;slug&gt;</code>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Project name</span>
            <input
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="create-project-name-input"
              className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>
          {error ? (
            <div
              role="alert"
              data-testid="create-project-error"
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
            <Button type="submit" disabled={!canSubmit} data-testid="create-project-submit">
              {submitting ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

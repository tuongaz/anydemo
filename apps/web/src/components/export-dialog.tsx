import { type Visibility, useExportToCloud } from '@/hooks/use-export-to-cloud';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@seeflow/canvas';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const EMAIL_STORAGE_KEY = 'seeflow.export.email';
const NAME_STORAGE_KEY = 'seeflow.export.name';
const VISIBILITY_STORAGE_KEY = 'seeflow.export.visibility';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; shareUrl: string }
  | { kind: 'error'; message: string };

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCapturePreview?: () => Promise<string | undefined>;
}

export function ExportDialog({
  open,
  onOpenChange,
  projectId,
  onCapturePreview,
}: ExportDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const exportToCloud = useExportToCloud(projectId);

  useEffect(() => {
    if (open) {
      setEmail(localStorage.getItem(EMAIL_STORAGE_KEY) ?? '');
      setName(localStorage.getItem(NAME_STORAGE_KEY) ?? '');
      setVisibility((localStorage.getItem(VISIBILITY_STORAGE_KEY) as Visibility) ?? 'public');
      setState({ kind: 'idle' });
      setCopied(false);
    }
  }, [open]);

  const handleExport = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const previewDataUrl = await onCapturePreview?.();
      if (!previewDataUrl) {
        setState({
          kind: 'error',
          message:
            "Couldn't capture the canvas. Make sure the diagram is visible and try again.",
        });
        return;
      }
      const { shareUrl } = await exportToCloud(
        email.trim(),
        name.trim(),
        visibility,
        previewDataUrl,
      );
      localStorage.setItem(EMAIL_STORAGE_KEY, email.trim());
      localStorage.setItem(NAME_STORAGE_KEY, name.trim());
      localStorage.setItem(VISIBILITY_STORAGE_KEY, visibility);
      setState({ kind: 'done', shareUrl });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [exportToCloud, email, name, visibility, onCapturePreview]);

  const handleCopy = useCallback(async () => {
    if (state.kind !== 'done') return;
    try {
      await navigator.clipboard.writeText(state.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [state]);

  const isLoading = state.kind === 'loading';
  const canExport = email.trim().length > 0 && name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="export-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="export-email-input"]',
          );
          input?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Export to seeflow.dev</DialogTitle>
          <DialogDescription>
            Upload this diagram to the cloud and get a shareable link.
          </DialogDescription>
        </DialogHeader>

        {state.kind !== 'done' ? (
          <>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  data-testid="export-email-input"
                  className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground">
                  We'll use this to let you manage your flows in the future.
                </span>
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Flow Name</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  data-testid="export-name-input"
                  className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Visibility</span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as Visibility)}
                  disabled={isLoading}
                  data-testid="export-visibility-select"
                  className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="public">Public — anyone can discover it</option>
                  <option value="link">Anyone with the link</option>
                </select>
              </label>

              {state.kind === 'error' ? (
                <div
                  role="alert"
                  data-testid="export-error"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {state.message}
                </div>
              ) : null}
            </div>

            <DialogFooter>
              {state.kind === 'error' ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    data-testid="export-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setState({ kind: 'idle' })}
                    data-testid="export-retry"
                  >
                    Try again
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={isLoading}
                    data-testid="export-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleExport}
                    disabled={isLoading || !canExport}
                    data-testid="export-submit"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>Uploading…</span>
                      </>
                    ) : (
                      'Export'
                    )}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Your diagram is live. Share this link:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={state.shareUrl}
                  data-testid="export-share-url"
                  className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 text-sm outline-hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label="Copy link"
                  data-testid="export-copy"
                >
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(state.shareUrl, '_blank')}
                  aria-label="View in new tab"
                  data-testid="export-view"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)} data-testid="export-done">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

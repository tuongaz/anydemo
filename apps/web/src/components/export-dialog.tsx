import { type Visibility, useExportToCloud } from '@/hooks/use-export-to-cloud';
import { useProjectFlows } from '@/hooks/use-project-flows';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@seeflow/canvas';
import { Check, Copy, ExternalLink, Loader2, Star } from 'lucide-react';
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
  /** Project slug — drives the manifest + per-flow fetches inside the bundle. */
  project: string;
  /** Initial value for the "Project name" field, if you want to preseed it. */
  flowName?: string;
  onCapturePreview?: () => Promise<string | undefined>;
}

export function ExportDialog({
  open,
  onOpenChange,
  project,
  flowName,
  onCapturePreview,
}: ExportDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const [selectedFlows, setSelectedFlows] = useState<Set<string>>(new Set());
  const exportToCloud = useExportToCloud(project);
  // Load the project's flow list so users can pick which flows to ship.
  // Pass `null` (idle) when the dialog is closed — no fetch.
  const projectFlowsApi = useProjectFlows(open ? project : null);
  const availableFlows = projectFlowsApi.flows;

  useEffect(() => {
    if (open) {
      setEmail(localStorage.getItem(EMAIL_STORAGE_KEY) ?? '');
      setName(flowName ?? localStorage.getItem(NAME_STORAGE_KEY) ?? '');
      setVisibility((localStorage.getItem(VISIBILITY_STORAGE_KEY) as Visibility) ?? 'public');
      setState({ kind: 'idle' });
      setCopied(false);
    }
  }, [open, flowName]);

  useEffect(() => {
    if (open && availableFlows) {
      setSelectedFlows(new Set(availableFlows.map((f) => f.flowSlug)));
    }
  }, [open, availableFlows]);

  const handleExport = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const previewDataUrl = await onCapturePreview?.();
      const { shareUrl } = await exportToCloud(
        email.trim(),
        name.trim(),
        visibility,
        previewDataUrl,
        Array.from(selectedFlows),
      );
      localStorage.setItem(EMAIL_STORAGE_KEY, email.trim());
      localStorage.setItem(NAME_STORAGE_KEY, name.trim());
      localStorage.setItem(VISIBILITY_STORAGE_KEY, visibility);
      setState({ kind: 'done', shareUrl });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [exportToCloud, email, name, visibility, onCapturePreview, selectedFlows]);

  const toggleFlow = useCallback((slug: string) => {
    setSelectedFlows((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const selectAllOrClear = useCallback(() => {
    if (!availableFlows) return;
    setSelectedFlows((prev) =>
      prev.size === availableFlows.length
        ? new Set()
        : new Set(availableFlows.map((f) => f.flowSlug)),
    );
  }, [availableFlows]);

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
  // The export needs the flow list AND at least one pick before it can fire.
  const canExport =
    email.trim().length > 0 &&
    name.trim().length > 0 &&
    availableFlows !== null &&
    projectFlowsApi.error === null &&
    selectedFlows.size > 0;
  const showFlowPicker = (availableFlows?.length ?? 0) >= 2;
  const showFlowsLoading = projectFlowsApi.loading;
  const showFlowsError = projectFlowsApi.error !== null;
  const allSelected = availableFlows !== null && selectedFlows.size === availableFlows.length;

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
          <DialogTitle>Export project to seeflow.dev</DialogTitle>
          <DialogDescription>
            Upload this project to the cloud and get a shareable link.
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

              {showFlowsLoading ? (
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  data-testid="export-flows-loading"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Loading flows…</span>
                </div>
              ) : null}

              {showFlowsError ? (
                <div
                  role="alert"
                  data-testid="export-flows-error"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  Couldn't load flows. Try closing and reopening the dialog.
                </div>
              ) : null}

              {showFlowPicker && availableFlows ? (
                <div className="flex flex-col gap-1.5 text-sm" data-testid="export-flows-section">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Flows</span>
                    <button
                      type="button"
                      onClick={selectAllOrClear}
                      disabled={isLoading}
                      data-testid="export-flows-toggle-all"
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {allSelected ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                  <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border bg-background p-2">
                    {availableFlows.map((f) => (
                      <li key={f.flowSlug}>
                        <label className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={selectedFlows.has(f.flowSlug)}
                            onChange={() => toggleFlow(f.flowSlug)}
                            disabled={isLoading}
                            data-testid={`export-flow-checkbox-${f.flowSlug}`}
                          />
                          <span className="flex-1 truncate">{f.name}</span>
                          {f.isDefault ? (
                            <Star
                              className="h-3.5 w-3.5 text-muted-foreground"
                              aria-label="default flow"
                              data-testid={`export-flow-default-${f.flowSlug}`}
                            />
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

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

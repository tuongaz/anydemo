import { type AuditEntry, type AuditKind, useLiveShareAudit } from '@/hooks/use-live-share-audit';
import type { ShareStatePeerSummary } from '@/hooks/use-share-state';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@seeflow/canvas';
import { Check, ChevronDown, ChevronRight, Copy, Loader2, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export type LiveShareDialogStatus = 'idle' | 'starting' | 'active' | 'stopping' | 'error';

export interface LiveShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active-state peers (host-supplied via useShareState). Empty if idle. */
  peers: ShareStatePeerSummary[];
  /** Host display name, surfaced at the top of the dialog. */
  hostDisplayName?: string;
  /**
   * Current share status from useShareState(). Drives whether the dialog
   * shows the "Start sharing" CTA or the active-session controls (URL,
   * peer list, End session). Defaults to 'idle' when omitted.
   */
  status?: LiveShareDialogStatus;
  /**
   * The peer-joinable URL, set when `status === 'active'`. Surfaced in a
   * read-only field with a copy button.
   */
  shareUrl?: string;
  /**
   * Start-share implementation override for tests. Defaults to a
   * `fetch('/api/share/start', {method:'POST'})` POST. The dialog does not
   * read the response — the studio's SSE state stream drives the transition
   * to `status === 'active'`.
   */
  onStart?: () => Promise<void>;
  /**
   * Stop-share implementation override for tests. Defaults to a
   * `fetch('/api/share/stop', {method:'POST'})` POST. Like `onStart`, the
   * status transition is driven by the SSE state stream.
   */
  onStop?: () => Promise<void>;
  /**
   * US-082: number of sessions the studio is currently tracking in
   * `active.json`. Drives the kill-switch button: disabled when 0, with the
   * "Active sessions: N" subtitle reflecting this value. Defaults to 0.
   */
  recentSessionCount?: number;
  /**
   * Audit-hook override for tests. Defaults to `useLiveShareAudit(open)`.
   * Splitting it out keeps the dialog testable without faking globals.
   */
  auditApi?: {
    entries: AuditEntry[];
    refresh: () => Promise<void> | void;
    loading: boolean;
  };
  /**
   * Kick implementation override for tests. Defaults to a `fetch('/api/share/kick',
   * {method:'POST', body:{peerId}})` POST.
   */
  onKick?: (peer: ShareStatePeerSummary) => Promise<void>;
  /**
   * Kill-switch implementation override for tests. Defaults to a
   * `fetch('/api/share/kill-all', {method:'POST'})` POST returning
   * `{ revoked, failed }`. Errors are surfaced inline in the confirm dialog.
   */
  onKillAll?: () => Promise<{ revoked: number; failed: number }>;
  /**
   * Notified with the `revoked` count after a successful kill-all. The host
   * wires this up to its top-level toast stack so the dialog can close while
   * the toast remains visible.
   */
  onKillAllSuccess?: (revoked: number) => void;
}

interface ToastItem {
  id: number;
  displayName: string;
}

const TOAST_DURATION_MS = 3000;

async function defaultStart(): Promise<void> {
  const res = await fetch('/api/share/start', { method: 'POST' });
  if (!res.ok) throw new Error(`share/start failed: ${res.status}`);
}

async function defaultStop(): Promise<void> {
  const res = await fetch('/api/share/stop', { method: 'POST' });
  if (!res.ok && res.status !== 204) throw new Error(`share/stop failed: ${res.status}`);
}

async function defaultKick(peer: ShareStatePeerSummary): Promise<void> {
  const res = await fetch('/api/share/kick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ peerId: peer.peerId }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`kick failed: ${res.status}`);
  }
}

async function defaultKillAll(): Promise<{ revoked: number; failed: number }> {
  const res = await fetch('/api/share/kill-all', { method: 'POST' });
  if (!res.ok) throw new Error(`kill-all failed: ${res.status}`);
  const body = (await res.json()) as { revoked?: number; failed?: number };
  return {
    revoked: typeof body.revoked === 'number' ? body.revoked : 0,
    failed: typeof body.failed === 'number' ? body.failed : 0,
  };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const SYSTEM_KINDS: ReadonlySet<AuditKind> = new Set([
  'host-start',
  'host-stop',
  'rotate',
  'kill-switch',
]);

function kindLabel(entry: AuditEntry): string {
  switch (entry.kind) {
    case 'peer-join':
      return 'joined';
    case 'peer-leave':
      return 'left';
    case 'kick':
      return 'kicked';
    case 'rotate':
      return 'rotated URL';
    case 'kill-switch':
      return 'kill switch';
    case 'host-start':
      return 'host started';
    case 'host-stop':
      return 'host stopped';
    case 'rpc-reject':
      return `rejected${entry.op ? ` ${entry.op}` : ''}`;
    case 'rpc-accept': {
      const op = entry.op ?? '';
      const nodeId =
        entry.details && typeof entry.details.nodeId === 'string' ? entry.details.nodeId : null;
      if (op === 'node-move' && nodeId) return `moved Node ${nodeId}`;
      if (op === 'node-patch' && nodeId) return `edited Node ${nodeId}`;
      if (op === 'add-node' && nodeId) return `added Node ${nodeId}`;
      if (op === 'remove-node' && nodeId) return `removed Node ${nodeId}`;
      if (op) return op;
      return 'updated';
    }
    default:
      return entry.kind;
  }
}

export function LiveShareDialog({
  open,
  onOpenChange,
  peers,
  hostDisplayName,
  recentSessionCount = 0,
  status = 'idle',
  shareUrl,
  onStart,
  onStop,
  auditApi,
  onKick,
  onKillAll,
  onKillAllSuccess,
}: LiveShareDialogProps) {
  const defaultAudit = useLiveShareAudit(auditApi ? false : open);
  const audit = auditApi ?? defaultAudit;

  const [activityOpen, setActivityOpen] = useState(false);
  const [pendingKick, setPendingKick] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Slots 5/6/7 — appended at the end so existing test slot constants
  // (SLOT_ACTIVITY_OPEN=2, SLOT_PENDING_KICK=3) stay valid.
  const [killAllConfirmOpen, setKillAllConfirmOpen] = useState(false);
  const [killAllPending, setKillAllPending] = useState(false);
  const [killAllError, setKillAllError] = useState<string | null>(null);
  // Slots 8/9/10 — start/stop CTA state + copy-to-clipboard feedback.
  // Appended at the end per the hook-shim slot rule.
  const [startError, setStartError] = useState<string | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const expireToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const handleStart = useCallback(async () => {
    if (startPending) return;
    setStartError(null);
    setStartPending(true);
    try {
      await (onStart ?? defaultStart)();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start sharing');
    } finally {
      setStartPending(false);
    }
  }, [onStart, startPending]);

  const handleStop = useCallback(async () => {
    if (startPending) return;
    setStartPending(true);
    try {
      await (onStop ?? defaultStop)();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to stop sharing');
    } finally {
      setStartPending(false);
    }
  }, [onStop, startPending]);

  const handleCopyUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail on insecure contexts — leave the icon as Copy.
    }
  }, [shareUrl]);

  const handleKick = useCallback(
    async (peer: ShareStatePeerSummary) => {
      setPendingKick(peer.peerId);
      try {
        await (onKick ?? defaultKick)(peer);
        const id = Date.now();
        setToasts((current) => [...current, { id, displayName: peer.displayName }]);
        setTimeout(() => expireToast(id), TOAST_DURATION_MS);
      } catch {
        // Errors are swallowed — the peer will reappear in the next SSE state
        // push if the kick failed remotely.
      } finally {
        setPendingKick(null);
      }
    },
    [onKick, expireToast],
  );

  const handleKillAllConfirm = useCallback(async () => {
    setKillAllPending(true);
    setKillAllError(null);
    try {
      const result = await (onKillAll ?? defaultKillAll)();
      setKillAllConfirmOpen(false);
      onOpenChange(false);
      onKillAllSuccess?.(result.revoked);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kill-all failed';
      setKillAllError(message);
    } finally {
      setKillAllPending(false);
    }
  }, [onKillAll, onKillAllSuccess, onOpenChange]);

  const killSwitchDisabled = recentSessionCount === 0 || killAllPending;

  const entriesReversed = [...audit.entries].reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sf:sm:max-w-lg" data-testid="live-share-dialog">
        <DialogHeader>
          <DialogTitle>Live share</DialogTitle>
          <DialogDescription>
            {hostDisplayName
              ? `Hosting as ${hostDisplayName}. Peers joined via the share link.`
              : 'Peers joined via the share link.'}
          </DialogDescription>
        </DialogHeader>

        {status === 'active' && shareUrl ? (
          <div
            data-testid="live-share-url-row"
            className="sf:flex sf:flex-col sf:gap-2 sf:rounded-md sf:border sf:border-border sf:bg-muted/40 sf:p-3"
          >
            <div className="sf:text-xs sf:font-medium sf:uppercase sf:tracking-[0.18em] sf:text-muted-foreground">
              Share link
            </div>
            <div className="sf:flex sf:items-center sf:gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                data-testid="live-share-url-input"
                className="sf:flex-1 sf:rounded-md sf:border sf:border-border sf:bg-background sf:px-2 sf:py-1.5 sf:font-mono sf:text-xs"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCopyUrl}
                    aria-label="Copy share link"
                    data-testid="live-share-copy-button"
                  >
                    {copied ? (
                      <Check className="sf:h-4 sf:w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="sf:h-4 sf:w-4" aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copied ? 'Copied!' : 'Copy link'}</TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={startPending}
                onClick={handleStop}
                data-testid="live-share-stop-button"
              >
                {startPending ? (
                  <Loader2 className="sf:mr-2 sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />
                ) : null}
                End session
              </Button>
            </div>
          </div>
        ) : (
          <div
            data-testid="live-share-start-section"
            className="sf:flex sf:flex-col sf:gap-3 sf:rounded-md sf:border sf:border-border sf:bg-muted/40 sf:p-4"
          >
            <p className="sf:text-sm sf:text-muted-foreground">
              Start a live share session to generate a peer-joinable link. Anyone with the link can
              join, see your canvas in real time, and make edits if you allow it.
            </p>
            {startError ? (
              <div
                data-testid="live-share-start-error"
                className="sf:rounded-md sf:border sf:border-destructive/40 sf:bg-destructive/10 sf:px-3 sf:py-2 sf:text-sm sf:text-destructive"
              >
                {startError}
              </div>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={startPending || status === 'starting' || status === 'stopping'}
              onClick={handleStart}
              data-testid="live-share-start-button"
              className="sf:w-fit"
            >
              {startPending || status === 'starting' ? (
                <Loader2 className="sf:mr-2 sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />
              ) : null}
              {status === 'stopping' ? 'Ending session…' : 'Start sharing'}
            </Button>
          </div>
        )}

        <div data-testid="live-share-peer-list" className="sf:flex sf:flex-col sf:gap-1 sf:py-2">
          {peers.length === 0 ? (
            <div className="sf:py-6 sf:text-center sf:text-sm sf:text-muted-foreground">
              No peers connected.
            </div>
          ) : (
            peers.map((peer) => {
              const pending = pendingKick === peer.peerId;
              return (
                <div
                  key={peer.peerId}
                  data-testid="live-share-peer-row"
                  className="sf:flex sf:items-center sf:gap-3 sf:rounded-md sf:px-2 sf:py-1.5 sf:hover:bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className="sf:inline-block sf:h-2 sf:w-2 sf:rounded-full"
                    style={{ backgroundColor: peer.color ?? '#71717a' }}
                  />
                  <span className="sf:flex-1 sf:truncate sf:text-sm sf:text-foreground">
                    {peer.displayName}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        onClick={() => handleKick(peer)}
                        aria-label={`Kick ${peer.displayName}`}
                        data-testid="live-share-kick-button"
                        data-peer-id={peer.peerId}
                      >
                        {pending ? (
                          <Loader2
                            className="sf:h-4 sf:w-4 sf:animate-spin"
                            data-testid="live-share-kick-spinner"
                          />
                        ) : (
                          <UserX className="sf:h-4 sf:w-4" aria-hidden="true" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove peer</TooltipContent>
                  </Tooltip>
                </div>
              );
            })
          )}
        </div>

        <button
          type="button"
          onClick={() => setActivityOpen((prev) => !prev)}
          aria-expanded={activityOpen}
          data-testid="live-share-activity-toggle"
          className="sf:flex sf:w-full sf:items-center sf:gap-2 sf:rounded-md sf:px-2 sf:py-2 sf:text-left sf:text-sm sf:font-medium sf:text-foreground sf:hover:bg-muted"
        >
          {activityOpen ? (
            <ChevronDown className="sf:h-4 sf:w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="sf:h-4 sf:w-4" aria-hidden="true" />
          )}
          <span>Activity ({audit.entries.length})</span>
        </button>

        {activityOpen ? (
          <div
            data-testid="live-share-activity-list"
            className="sf:max-h-[240px] sf:overflow-y-auto sf:rounded-md sf:border sf:border-border sf:bg-background"
          >
            {entriesReversed.length === 0 ? (
              <div className="sf:px-3 sf:py-4 sf:text-sm sf:text-muted-foreground">
                {audit.loading ? 'Loading…' : 'No activity yet.'}
              </div>
            ) : (
              <ul className="sf:flex sf:flex-col sf:divide-y sf:divide-border">
                {entriesReversed.map((entry, idx) => {
                  const isSystem = SYSTEM_KINDS.has(entry.kind) || entry.peerId === null;
                  return (
                    <li
                      key={`${entry.ts}-${idx}`}
                      data-testid="live-share-activity-entry"
                      data-entry-kind={entry.kind}
                      className={`sf:flex sf:items-center sf:gap-3 sf:px-3 sf:py-1.5 sf:text-sm ${
                        isSystem ? 'sf:text-muted-foreground' : 'sf:text-foreground'
                      }`}
                    >
                      <time
                        dateTime={new Date(entry.ts).toISOString()}
                        data-testid="live-share-activity-time"
                        className="sf:font-mono sf:text-xs sf:tabular-nums sf:text-muted-foreground"
                      >
                        {formatTime(entry.ts)}
                      </time>
                      <span className="sf:truncate sf:text-sm">
                        {entry.displayName ?? 'system'}
                      </span>
                      <span
                        data-testid="live-share-activity-kind"
                        className="sf:ml-auto sf:font-mono sf:text-[11px] sf:font-medium sf:uppercase sf:tracking-[0.18em] sf:text-muted-foreground"
                      >
                        {kindLabel(entry)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {toasts.length > 0 ? (
          <div
            data-testid="live-share-toast-stack"
            className="sf:pointer-events-none sf:flex sf:flex-col sf:gap-1 sf:pt-2"
          >
            {toasts.map((t) => (
              <ToastRow key={t.id} item={t} onExpire={expireToast} />
            ))}
          </div>
        ) : null}

        <div
          data-testid="live-share-footer"
          className="sf:flex sf:flex-col sf:gap-1 sf:border-t sf:border-border sf:pt-3"
        >
          <div className="sf:flex sf:items-start sf:justify-between sf:gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="sf:inline-flex">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={killSwitchDisabled}
                    onClick={() => {
                      setKillAllError(null);
                      setKillAllConfirmOpen(true);
                    }}
                    data-testid="live-share-kill-all-button"
                  >
                    End all sessions
                  </Button>
                </span>
              </TooltipTrigger>
              {recentSessionCount === 0 ? (
                <TooltipContent>No active sessions to end</TooltipContent>
              ) : null}
            </Tooltip>
          </div>
          <div
            data-testid="live-share-active-sessions-count"
            className="sf:text-xs sf:text-muted-foreground"
          >
            Active sessions: {recentSessionCount}
          </div>
        </div>

        <Dialog
          open={killAllConfirmOpen}
          onOpenChange={(next) => {
            if (killAllPending) return;
            setKillAllConfirmOpen(next);
            if (!next) setKillAllError(null);
          }}
        >
          <DialogContent className="sf:sm:max-w-md" data-testid="live-share-kill-all-confirm">
            <DialogHeader>
              <DialogTitle>End all live sessions?</DialogTitle>
              <DialogDescription>
                This revokes every share link this studio has issued. Anyone currently connected
                will be disconnected. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {killAllError ? (
              <div
                data-testid="live-share-kill-all-error"
                className="sf:rounded-md sf:border sf:border-destructive/40 sf:bg-destructive/10 sf:px-3 sf:py-2 sf:text-sm sf:text-destructive"
              >
                {killAllError}
              </div>
            ) : null}
            <div className="sf:flex sf:justify-end sf:gap-2 sf:pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={killAllPending}
                onClick={() => {
                  setKillAllConfirmOpen(false);
                  setKillAllError(null);
                }}
                data-testid="live-share-kill-all-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={killAllPending}
                onClick={handleKillAllConfirm}
                data-testid="live-share-kill-all-confirm-button"
              >
                {killAllPending ? (
                  <Loader2
                    className="sf:mr-2 sf:h-4 sf:w-4 sf:animate-spin"
                    data-testid="live-share-kill-all-spinner"
                  />
                ) : null}
                End all
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

interface ToastRowProps {
  item: ToastItem;
  onExpire: (id: number) => void;
}

function ToastRow({ item, onExpire }: ToastRowProps) {
  useEffect(() => {
    const id = setTimeout(() => onExpire(item.id), TOAST_DURATION_MS);
    return () => clearTimeout(id);
  }, [item.id, onExpire]);
  return (
    <div
      data-testid="live-share-toast"
      className="sf:rounded-md sf:bg-muted sf:px-3 sf:py-1.5 sf:text-xs sf:text-muted-foreground"
    >
      Removed {item.displayName}
    </div>
  );
}

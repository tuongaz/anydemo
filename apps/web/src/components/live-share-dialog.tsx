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
import { ChevronDown, ChevronRight, Loader2, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export interface LiveShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active-state peers (host-supplied via useShareState). Empty if idle. */
  peers: ShareStatePeerSummary[];
  /** Host display name, surfaced at the top of the dialog. */
  hostDisplayName?: string;
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
}

interface ToastItem {
  id: number;
  displayName: string;
}

const TOAST_DURATION_MS = 3000;

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
  auditApi,
  onKick,
}: LiveShareDialogProps) {
  const defaultAudit = useLiveShareAudit(auditApi ? false : open);
  const audit = auditApi ?? defaultAudit;

  const [activityOpen, setActivityOpen] = useState(false);
  const [pendingKick, setPendingKick] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const expireToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

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

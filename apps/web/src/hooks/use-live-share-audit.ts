import { useCallback, useEffect, useState } from 'react';

/**
 * Mirror of the studio's `AuditEntry` (`apps/studio/src/share-audit.ts`,
 * US-078). Duplicated locally so the web bundle stays free of a hard dep on
 * the studio package; the wire shape is the contract.
 */
export type AuditKind =
  | 'rpc-accept'
  | 'rpc-reject'
  | 'kick'
  | 'rotate'
  | 'kill-switch'
  | 'host-start'
  | 'host-stop'
  | 'peer-join'
  | 'peer-leave';

export interface AuditEntry {
  ts: number;
  peerId: string | null;
  displayName: string | null;
  kind: AuditKind;
  op?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

const AUDIT_LIMIT = 200;
const POLL_INTERVAL_MS = 5000;

interface AuditPage {
  entries: AuditEntry[];
  nextCursor: number | null;
}

/**
 * Polls `/api/share/audit?limit=200` while `open` is true. The hook is a
 * no-op (no fetch, no interval) when `open` is false so callers can mount it
 * unconditionally and gate via the dialog's open state.
 *
 * Returns the latest page of entries (raw — caller renders reverse-chrono if
 * desired), a `refresh()` callback, and a `loading` flag that flips true
 * while a fetch is in flight.
 */
export function useLiveShareAudit(open: boolean): {
  entries: AuditEntry[];
  refresh: () => Promise<void>;
  loading: boolean;
} {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/share/audit?limit=${AUDIT_LIMIT}`);
      if (!res.ok) return;
      const body = (await res.json()) as AuditPage;
      if (body && Array.isArray(body.entries)) {
        setEntries(body.entries);
      }
    } catch {
      // Transient failures keep the previously-rendered page on screen.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refresh();
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, refresh]);

  return { entries, refresh, loading };
}

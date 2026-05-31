import { type AttributionToastItem, formatAttribution } from '@seeflow/canvas';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Host studio counterpart of seeflow-viewer's `useAttributionToasts`. Subscribes
 * to the studio's `/api/share/attributions` SSE channel (mounted only while
 * share is active) and surfaces a stream of toast items for
 * `<AttributionToastStack>` to render.
 *
 * Behavior:
 *   - Toasts where `attributedTo.peerId === selfPeerId` are suppressed. For the
 *     host studio the conventional `selfPeerId` is `'host'`, so host-originated
 *     edits stay silent — peer edits surface.
 *   - Same-`{peerId,nodeId,op}` bursts within `dedupeWindowMs` (default 200ms)
 *     coalesce into the most recent toast — useful for drag-flurries of
 *     `moveNode` frames.
 *   - The hook owns the items list. `onExpire(id)` removes the matching item.
 *
 * The hook is a no-op when `active` is false (e.g. share is idle); no
 * EventSource is opened, so callers can mount it unconditionally and gate the
 * stack on the same flag.
 */
export interface UseAttributionToastsOptions {
  active: boolean;
  selfPeerId?: string;
  /** Window for dedupe collisions (same peer + node + op). Default 200ms. */
  dedupeWindowMs?: number;
  /** Resolves a peer's identity color. Falls back to `fallbackColor`. */
  peerColor?: (peerId: string) => string | undefined;
  /** Default color when no presence color is available. */
  fallbackColor?: string;
}

interface AttributionFrame {
  flowId?: unknown;
  op?: unknown;
  diff?: unknown;
  attributedTo?: unknown;
}

interface Attribution {
  peerId: string;
  displayName: string;
}

const DEFAULT_DEDUPE_WINDOW_MS = 200;
const DEFAULT_FALLBACK_COLOR = '#71717a';

function readAttribution(value: unknown): Attribution | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { peerId?: unknown; displayName?: unknown };
  if (typeof v.peerId !== 'string' || v.peerId.length === 0) return null;
  if (typeof v.displayName !== 'string' || v.displayName.length === 0) return null;
  return { peerId: v.peerId, displayName: v.displayName };
}

function readNodeId(diff: unknown): string | null {
  if (!diff || typeof diff !== 'object') return null;
  const d = diff as { nodeId?: unknown; connectorId?: unknown; id?: unknown };
  if (typeof d.nodeId === 'string' && d.nodeId.length > 0) return d.nodeId;
  if (typeof d.connectorId === 'string' && d.connectorId.length > 0) return d.connectorId;
  if (typeof d.id === 'string' && d.id.length > 0) return d.id;
  return null;
}

export function useAttributionToasts({
  active,
  selfPeerId,
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
  peerColor,
  fallbackColor = DEFAULT_FALLBACK_COLOR,
}: UseAttributionToastsOptions): {
  items: AttributionToastItem[];
  onExpire: (id: string) => void;
} {
  const [items, setItems] = useState<AttributionToastItem[]>([]);
  const counterRef = useRef(0);
  const lastByKeyRef = useRef<Map<string, { id: string; ts: number }>>(new Map());
  const peerColorRef = useRef(peerColor);
  peerColorRef.current = peerColor;
  const selfPeerIdRef = useRef<string | undefined>(selfPeerId);
  selfPeerIdRef.current = selfPeerId;

  const onExpire = useCallback((id: string) => {
    setItems((current) => current.filter((it) => it.id !== id));
    const map = lastByKeyRef.current;
    for (const [k, v] of map) {
      if (v.id === id) map.delete(k);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setItems([]);
      lastByKeyRef.current.clear();
      return;
    }
    const source = new EventSource('/api/share/attributions');
    source.addEventListener('attribution', (e) => {
      const ev = e as MessageEvent<string>;
      let parsed: AttributionFrame;
      try {
        parsed = JSON.parse(ev.data) as AttributionFrame;
      } catch {
        return;
      }
      const attribution = readAttribution(parsed.attributedTo);
      if (!attribution) return;
      if (selfPeerIdRef.current && attribution.peerId === selfPeerIdRef.current) return;
      const op = typeof parsed.op === 'string' ? parsed.op : '';
      if (!op) return;
      const nodeId = readNodeId(parsed.diff);
      const dedupeKey = `${attribution.peerId}|${nodeId ?? ''}|${op}`;
      const ts = Date.now();
      const prior = lastByKeyRef.current.get(dedupeKey);
      const { verb, nodeLabel } = formatAttribution(op, parsed.diff, undefined);
      counterRef.current += 1;
      const id = `tx-${counterRef.current}`;
      const color = peerColorRef.current?.(attribution.peerId) ?? fallbackColor;
      const next: AttributionToastItem = {
        id,
        color,
        displayName: attribution.displayName,
        verb,
        nodeLabel,
        createdAt: ts,
      };
      lastByKeyRef.current.set(dedupeKey, { id, ts });
      if (prior && ts - prior.ts <= dedupeWindowMs) {
        setItems((current) => {
          const idx = current.findIndex((it) => it.id === prior.id);
          if (idx < 0) return [...current, next];
          const out = current.slice();
          out[idx] = next;
          return out;
        });
        return;
      }
      setItems((current) => [...current, next]);
    });
    return () => {
      source.close();
    };
  }, [active, dedupeWindowMs, fallbackColor]);

  return { items, onExpire };
}

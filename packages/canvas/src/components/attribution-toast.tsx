import { type CSSProperties, useEffect, useRef } from 'react';

export interface AttributionToastItem {
  id: string;
  color: string;
  displayName: string;
  verb: string;
  nodeLabel: string;
  createdAt: number;
}

export interface AttributionToastStackProps {
  items: AttributionToastItem[];
  onExpire: (id: string) => void;
  /** Lifetime in ms before `onExpire` fires per item. Default 2500. */
  lifetimeMs?: number;
  /** Maximum simultaneously visible toasts. Default 3. */
  maxVisible?: number;
  /**
   * Injection points for deterministic tests. Production callers omit these.
   */
  nowFn?: () => number;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

const DEFAULT_LIFETIME_MS = 2500;
const DEFAULT_MAX_VISIBLE = 3;
const MONO_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

const stackStyle: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column-reverse',
  gap: 8,
  pointerEvents: 'none',
  zIndex: 50,
};

const toastBaseStyle: CSSProperties = {
  background: '#18181b',
  color: '#fafafa',
  border: '1px solid #27272a',
  borderRadius: 8,
  padding: '8px 12px 8px 9px',
  fontFamily: MONO_STACK,
  fontSize: 12,
  lineHeight: 1.4,
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 6,
  boxShadow: '0 4px 12px -2px rgba(0,0,0,0.5)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};

const nameStyle: CSSProperties = {
  fontWeight: 600,
};

const verbStyle: CSSProperties = {
  color: '#a1a1aa',
};

const nodeLabelStyle: CSSProperties = {
  color: '#fafafa',
};

/**
 * Bottom-left fixed stack of attribution toasts ("Alice moved Node X").
 *
 * Each toast self-expires after `lifetimeMs` (default 2500ms) by calling
 * `onExpire(id)`; the consumer is the source of truth for the items list and
 * decides what to do with the expiry (typically: filter the id out of its
 * state). Capped at `maxVisible` (default 3) — extra items still receive
 * timers so they expire at the same per-item rate; only the most recent are
 * rendered visibly (newest-on-top via `flex-direction: column-reverse`).
 *
 * The peer color is the LEFT BORDER per the design tokens (3px). Toasts
 * are `pointer-events: none` so they never eat canvas clicks even when the
 * stack overlaps interactive chrome.
 */
export function AttributionToastStack({
  items,
  onExpire,
  lifetimeMs = DEFAULT_LIFETIME_MS,
  maxVisible = DEFAULT_MAX_VISIBLE,
  nowFn,
  setTimeoutFn,
  clearTimeoutFn,
}: AttributionToastStackProps) {
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const now = nowFn ?? Date.now;
    const setT = setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
    const clearT =
      clearTimeoutFn ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const handles: unknown[] = [];
    for (const item of items) {
      const elapsed = now() - item.createdAt;
      const remaining = Math.max(0, lifetimeMs - elapsed);
      const id = item.id;
      const h = setT(() => onExpireRef.current(id), remaining);
      handles.push(h);
    }
    return () => {
      for (const h of handles) clearT(h);
    };
  }, [items, lifetimeMs, nowFn, setTimeoutFn, clearTimeoutFn]);

  const visible = items.slice(-maxVisible);

  return (
    <div data-testid="attribution-toast-stack" style={stackStyle}>
      {visible.map((item) => (
        <div
          key={item.id}
          data-testid={`attribution-toast-${item.id}`}
          data-toast-id={item.id}
          style={{
            ...toastBaseStyle,
            borderLeft: `3px solid ${item.color}`,
          }}
        >
          <span style={{ ...nameStyle, color: item.color }}>{item.displayName}</span>
          <span style={verbStyle}>{item.verb}</span>
          <span style={nodeLabelStyle}>{item.nodeLabel}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Last-used style memory (design doc, see git history: 2026-05-13-last-used-style-design.md).
 *
 * When the user changes a style property on any node or connector, remember
 * that value and apply it to the next shape of the same family they create.
 * Two buckets — one shared across all node kinds, one for connectors — so a
 * connector-only field (e.g. `direction`) can't leak into a fresh rectangle.
 *
 * Persistence is best-effort `localStorage` under a versioned key. Corrupt
 * JSON, missing storage, or write failures all degrade silently to empty
 * buckets — last-used is convenience, never a correctness boundary.
 *
 * The storage key is `<prefix>:last-used-style:v1`. Callers pass the prefix
 * explicitly so embedders of `@seeflow/canvas` can scope their last-used
 * memory to their app namespace. Pass `DEFAULT_STORAGE_PREFIX` to reproduce
 * the legacy `seeflow:last-used-style:v1` key.
 */
import type { ConnectorStylePatch, NodeStylePatch } from '../components/style-strip.tsx';

/** Default storage prefix — produces the legacy `seeflow:last-used-style:v1`
 *  key when passed to the read/write helpers. */
export const DEFAULT_STORAGE_PREFIX = 'seeflow';

const storageKey = (prefix: string): string => `${prefix}:last-used-style:v1`;

export interface LastUsedStyle {
  node: Partial<NodeStylePatch>;
  connector: Partial<ConnectorStylePatch>;
}

const empty = (): LastUsedStyle => ({ node: {}, connector: {} });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const readRaw = (prefix: string): LastUsedStyle => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(prefix));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return empty();
    const node = isPlainObject(parsed.node) ? (parsed.node as Partial<NodeStylePatch>) : {};
    const connector = isPlainObject(parsed.connector)
      ? (parsed.connector as Partial<ConnectorStylePatch>)
      : {};
    return { node, connector };
  } catch {
    return empty();
  }
};

const writeRaw = (prefix: string, state: LastUsedStyle): void => {
  try {
    globalThis.localStorage?.setItem(storageKey(prefix), JSON.stringify(state));
  } catch {
    // Quota, private-mode write failures, etc. — silent fallback per design.
  }
};

/** Snapshot of the current last-used buckets. Safe to call on every create. */
export const getLastUsedStyle = (prefix: string): LastUsedStyle => readRaw(prefix);

/**
 * Merge a node-style patch into the node bucket. `alt` (icon alt text) is
 * stripped because it's content, not style. `borderSize` and `borderWidth`
 * are mirrored at the write boundary so an `image`-driven `borderWidth` change
 * propagates to the next `rectangle`'s `borderSize` and vice-versa.
 */
export const rememberNodeStyle = (prefix: string, patch: NodeStylePatch): void => {
  const { alt: _alt, ...rest } = patch;
  const next: Partial<NodeStylePatch> = { ...rest };
  if (next.borderSize !== undefined && next.borderWidth === undefined) {
    next.borderWidth = next.borderSize;
  } else if (next.borderWidth !== undefined && next.borderSize === undefined) {
    next.borderSize = next.borderWidth;
  }
  const current = readRaw(prefix);
  writeRaw(prefix, { ...current, node: { ...current.node, ...next } });
};

/** Merge a connector-style patch into the connector bucket. */
export const rememberConnectorStyle = (prefix: string, patch: ConnectorStylePatch): void => {
  // Animation is a per-connector statement about one relationship, not a
  // brush setting — inheriting it would animate every line drawn afterwards.
  const { animated: _animated, ...rest } = patch;
  const current = readRaw(prefix);
  writeRaw(prefix, { ...current, connector: { ...current.connector, ...rest } });
};

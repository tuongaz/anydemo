/**
 * Last-used style memory (design doc: docs/plans/2026-05-13-last-used-style-design.md).
 *
 * When the user changes a style property on any node or connector, remember
 * that value and apply it to the next shape of the same family they create.
 * Two buckets — one shared across all node kinds, one for connectors — so a
 * connector-only field (e.g. `direction`) can't leak into a fresh rectangle.
 *
 * Persistence is best-effort `localStorage` under a versioned key. Corrupt
 * JSON, missing storage, or write failures all degrade silently to empty
 * buckets — last-used is convenience, never a correctness boundary.
 */
import type { ConnectorStylePatch, NodeStylePatch } from '@seeflow/canvas';

const STORAGE_KEY = 'seeflow:last-used-style:v1';

export interface LastUsedStyle {
  node: Partial<NodeStylePatch>;
  connector: Partial<ConnectorStylePatch>;
}

const empty = (): LastUsedStyle => ({ node: {}, connector: {} });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const readRaw = (): LastUsedStyle => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
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

const writeRaw = (state: LastUsedStyle): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota, private-mode write failures, etc. — silent fallback per design.
  }
};

/** Snapshot of the current last-used buckets. Safe to call on every create. */
export const getLastUsedStyle = (): LastUsedStyle => readRaw();

/**
 * Merge a node-style patch into the node bucket. `alt` (icon alt text) is
 * stripped because it's content, not style. `borderSize` and `borderWidth`
 * are mirrored at the write boundary so an `image`-driven `borderWidth` change
 * propagates to the next `rectangle`'s `borderSize` and vice-versa.
 */
export const rememberNodeStyle = (patch: NodeStylePatch): void => {
  const { alt: _alt, ...rest } = patch;
  const next: Partial<NodeStylePatch> = { ...rest };
  if (next.borderSize !== undefined && next.borderWidth === undefined) {
    next.borderWidth = next.borderSize;
  } else if (next.borderWidth !== undefined && next.borderSize === undefined) {
    next.borderSize = next.borderWidth;
  }
  const current = readRaw();
  writeRaw({ ...current, node: { ...current.node, ...next } });
};

/** Merge a connector-style patch into the connector bucket. */
export const rememberConnectorStyle = (patch: ConnectorStylePatch): void => {
  const current = readRaw();
  writeRaw({ ...current, connector: { ...current.connector, ...patch } });
};

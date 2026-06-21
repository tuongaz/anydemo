/**
 * US-024: defaults injected at brand-new-node creation time so the canvas
 * reads more like a wireframe diagram than a poster. The defaults apply ONLY
 * to fresh nodes (toolbar drag-create, drop-popover create, programmatic
 * insert). Pasted clones preserve their source data verbatim — defaults are
 * never backfilled. Existing demos on disk that lack these fields keep
 * rendering via the renderer's CSS / className fallbacks (per the optional
 * schema fields in `apps/studio/src/schema.ts`).
 *
 * Per-variant scope (see PRD AC):
 *   - shape rectangle/ellipse/sticky → borderSize + fontSize
 *   - shape text                      → fontSize only (text stays chromeless)
 *   - image                           → borderWidth (image has no label text)
 *   - icon                            → none (schema has no borderSize/
 *                                       fontSize fields; the `text-xs`
 *                                       className already renders the icon
 *                                       caption at 12px)
 *
 * Last-used overlay (docs/plans/2026-05-13-last-used-style-design.md): each
 * builder accepts an optional `lastUsed` patch and merges only the fields its
 * kind accepts on top of the hardcoded factory defaults. An empty patch
 * reproduces today's behavior exactly. Property irrelevant to a given kind
 * (e.g. `cornerRadius` on ellipse, `borderSize` on text) is silently dropped.
 */
import type { NodeStylePatch } from '../components/style-strip.tsx';
import type { GeometricNodeType } from '../types.ts';

/** Default border thickness for new nodes. */
export const NEW_NODE_BORDER_WIDTH = 1;
/** Default label font size for new nodes. */
export const NEW_NODE_FONT_SIZE = 17;

const pick = <K extends keyof NodeStylePatch>(
  patch: Partial<NodeStylePatch> | undefined,
  keys: readonly K[],
): Partial<Pick<NodeStylePatch, K>> => {
  if (!patch) return {};
  const out: Partial<Pick<NodeStylePatch, K>> = {};
  for (const k of keys) {
    if (patch[k] !== undefined) out[k] = patch[k];
  }
  return out;
};

// Fields each kind's renderer actually reads from its data payload. Anything
// outside this list is silently dropped at apply time so a connector-only or
// kind-irrelevant carry-over can't leak in.
const SHAPE_RECT_FIELDS = [
  'borderColor',
  'backgroundColor',
  'borderSize',
  'borderStyle',
  'fontSize',
  'cornerRadius',
  'shadow',
] as const;
const SHAPE_ELLIPSE_FIELDS = [
  'borderColor',
  'backgroundColor',
  'borderSize',
  'borderStyle',
  'fontSize',
  'shadow',
] as const;
const SHAPE_TEXT_FIELDS = ['fontSize'] as const;
const IMAGE_FIELDS = ['borderColor', 'borderWidth', 'borderStyle', 'shadow'] as const;

export interface ShapeDataDefaults {
  // Index signature lets the result satisfy `CreateNodeBody.data`
  // (`Record<string, unknown>`) without a per-call-site cast. Every concrete
  // field below is assignable to `unknown`, so the broader type is sound.
  [key: string]: unknown;
  width: number;
  height: number;
  borderSize?: number;
  fontSize: number;
}

/** Build the `data` object for a freshly-created shape node. Text variant
 * skips `borderSize` so text shapes stay chromeless (US-003). Optional
 * `lastUsed` overlays the user's most recently chosen style on top of the
 * factory defaults. Under the flat schema `type` IS the shape, so no
 * `shape` field is emitted on `data` (the strict on-disk schema would
 * reject it as an unknown key). */
export function buildNewShapeData(
  shape: GeometricNodeType,
  dims: { width: number; height: number },
  lastUsed?: Partial<NodeStylePatch>,
): ShapeDataDefaults {
  if (shape === 'text') {
    return {
      width: dims.width,
      height: dims.height,
      fontSize: NEW_NODE_FONT_SIZE,
      ...pick(lastUsed, SHAPE_TEXT_FIELDS),
    };
  }
  const fields = shape === 'ellipse' ? SHAPE_ELLIPSE_FIELDS : SHAPE_RECT_FIELDS;
  return {
    width: dims.width,
    height: dims.height,
    borderSize: NEW_NODE_BORDER_WIDTH,
    fontSize: NEW_NODE_FONT_SIZE,
    ...pick(lastUsed, fields),
  };
}

export interface ImageDataDefaults {
  [key: string]: unknown;
  path: string;
  width: number;
  height: number;
  borderWidth: number;
}

/** Build the `data` object for a freshly-created image node. Image uses
 * `borderWidth` (US-014), not `borderSize`. No `fontSize` — image renders
 * no body text. `path` is a relative path under the project root (US-004
 * hard-cut from base64 data URLs). */
export function buildNewImageData(
  path: string,
  dims: { width: number; height: number },
  lastUsed?: Partial<NodeStylePatch>,
): ImageDataDefaults {
  return {
    path,
    width: dims.width,
    height: dims.height,
    borderWidth: NEW_NODE_BORDER_WIDTH,
    ...pick(lastUsed, IMAGE_FIELDS),
  };
}

/** Default title for a freshly-created group container. */
export const NEW_GROUP_NAME = 'Group';

export interface GroupDataDefaults {
  // Index signature so the result satisfies `NodeCreateInput.data`
  // (`Record<string, unknown>`) without a per-call-site cast.
  [key: string]: unknown;
  childIds: string[];
  name: string;
  width: number;
  height: number;
  borderSize: number;
}

/**
 * Build the `data` object for a freshly-created group container (used by the
 * create-group op in M4). `childIds` are the member node ids (existing nodes),
 * `dims` is the computed group box. Defaults to a titled container with a thin
 * border; visual fields route to style.json on write. An empty `childIds` is
 * allowed (a labeled zone, design §9.11). Unlike the shape/image builders this
 * takes no `lastUsed` overlay — a group's chrome is its own concern, decided by
 * the create op / M7 styling, not the last-used shape style.
 */
export function buildNewGroupData(
  childIds: string[],
  dims: { width: number; height: number },
): GroupDataDefaults {
  return {
    childIds,
    name: NEW_GROUP_NAME,
    width: dims.width,
    height: dims.height,
    borderSize: NEW_NODE_BORDER_WIDTH,
  };
}

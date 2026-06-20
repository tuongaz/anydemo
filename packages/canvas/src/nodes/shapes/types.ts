// US-009: per-shape illustrative components live under
// `packages/canvas/src/nodes/shapes/` and all consume this single
// `ShapePartProps` shape so `shape-node.tsx` can dispatch to any of them with
// the same resolved chrome inputs.
//
// `borderColor` / `backgroundColor` are already-resolved CSS color values (the
// caller in shape-node.tsx pre-resolves them via `colorTokenStyle`), not
// `ColorToken` strings. When unset, the SVG falls through to the theme-aware
// CSS-var fallbacks documented below (`var(--seeflow-node-border)` /
// `var(--seeflow-node-bg)`).
export interface ShapePartProps {
  width: number;
  height: number;
  borderColor?: string;
  backgroundColor?: string;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
}

// US-022: theme-aware CSS-var fallbacks shared by every illustrative shape.
// The vars aren't bound globally yet — they're documented hooks for future
// theming. When the caller-resolved prop is undefined, the SVG inherits
// whatever value the surrounding CSS context provides, falling through to the
// host's currentColor when no var binding exists.
export const BORDER_FALLBACK = 'var(--seeflow-node-border)';
export const BG_FALLBACK = 'var(--seeflow-node-bg)';
export const DEFAULT_STROKE_WIDTH = 2;

/**
 * Build a viewBox padded by `strokeWidth` on every side. Boundary-aligned
 * polygon edges (e.g. a triangle base on `y=height`) otherwise have the outer
 * half of their stroke — and any miter tip — clipped by the SVG viewport,
 * rendering at half thickness. Padding the viewBox by the full stroke width
 * pulls the whole stroke inside the visible region. With
 * `preserveAspectRatio="none"` the padded box still maps onto the full wrapper,
 * so the glyph only loses a sub-pixel margin.
 */
export function paddedViewBox(width: number, height: number, strokeWidth: number): string {
  const m = strokeWidth;
  return `${-m} ${-m} ${width + 2 * m} ${height + 2 * m}`;
}

export function dashFor(style: ShapePartProps['borderStyle']): string | undefined {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '2 4';
  return undefined;
}

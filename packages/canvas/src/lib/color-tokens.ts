import type { CSSProperties } from 'react';
import type { ColorToken } from '../types.ts';

// Per-token palette: `body` is the hue that drives the painted node body
// (rendered at `BODY_ALPHA` — a subtle tint, not a solid fill, so theme
// foreground text stays readable). `border` keeps its hand-tuned
// hue/saturation/lightness so the outline reads as a subtly darker,
// less-saturated variant of the body. `headerBackground` matches the body
// exactly — the header sits flush on top of the body fill, with a subtle
// theme border-bottom drawn by the renderer as the only separator.
//
// `default` and `none` are special-cased below — `default` uses theme
// tokens so it adapts to dark mode; `none` paints transparent.
type Hsl = readonly [h: number, s: number, l: number];

const BODY_ALPHA = 0.3;

const PALETTE: Record<
  Exclude<ColorToken, 'default' | 'none' | 'white'>,
  { body: Hsl; border: Hsl }
> = {
  slate: { body: [215, 16, 47], border: [215, 20, 40] },
  gray: { body: [220, 9, 55], border: [220, 9, 46] },
  red: { body: [0, 84, 60], border: [0, 70, 55] },
  rose: { body: [347, 84, 60], border: [347, 70, 55] },
  orange: { body: [25, 95, 55], border: [25, 80, 53] },
  amber: { body: [38, 92, 50], border: [43, 70, 50] },
  lime: { body: [85, 78, 55], border: [85, 60, 50] },
  green: { body: [142, 71, 45], border: [142, 50, 45] },
  teal: { body: [173, 80, 50], border: [173, 60, 45] },
  cyan: { body: [189, 94, 55], border: [189, 70, 50] },
  blue: { body: [217, 91, 60], border: [213, 70, 55] },
  indigo: { body: [231, 88, 65], border: [231, 60, 60] },
  violet: { body: [252, 88, 68], border: [252, 60, 62] },
  purple: { body: [271, 91, 65], border: [270, 60, 60] },
  pink: { body: [330, 81, 60], border: [330, 60, 60] },
};

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

type TokenEntry = {
  border: string;
  background: string;
  edge: string;
  headerBackground: string;
};

const PAINTED_ENTRIES = Object.fromEntries(
  (Object.entries(PALETTE) as [keyof typeof PALETTE, (typeof PALETTE)[keyof typeof PALETTE]][]).map(
    ([token, { body, border }]) => {
      const [bh, bs, bl] = body;
      const [rh, rs, rl] = border;
      const bodyFill = hsla(bh, bs, bl, BODY_ALPHA);
      const entry: TokenEntry = {
        border: hsl(rh, rs, rl),
        background: bodyFill,
        // Edge connectors still paint at full saturation so the line
        // stays visible against the canvas surface; the body tint is the
        // softened variant.
        edge: hsl(bh, bs, bl),
        headerBackground: bodyFill,
      };
      return [token, entry];
    },
  ),
) as Record<keyof typeof PALETTE, TokenEntry>;

const COLOR_TOKEN_MAP: Record<ColorToken, TokenEntry> = {
  // `'none'` is rendered as transparent — `colorTokenStyle` short-circuits
  // before reading these values, so they're placeholders only.
  none: {
    border: 'transparent',
    background: 'transparent',
    edge: 'transparent',
    headerBackground: 'transparent',
  },
  default: {
    // Design system green — matches the canvas's --primary emerald token
    // (#10b981 / hsl(160 84% 39.4%)). Applied so unstyled nodes carry the
    // brand color on their border by default.
    border: 'hsl(var(--primary))',
    background: 'hsl(var(--card))',
    edge: 'hsl(var(--muted-foreground))',
    headerBackground: 'hsl(var(--muted))',
  },
  // White is opaque white throughout; the painted header still matches
  // the body so the border-bottom is the only separator.
  white: {
    border: 'hsl(0, 0%, 100%)',
    background: 'hsl(0, 0%, 100%)',
    edge: 'hsl(0, 0%, 100%)',
    headerBackground: 'hsl(0, 0%, 100%)',
  },
  ...PAINTED_ENTRIES,
};

export const COLOR_TOKENS = COLOR_TOKEN_MAP;

export const NODE_DEFAULT_BG_WHITE = 'hsl(var(--card))';

export type NodeColorStyle = Pick<CSSProperties, 'borderColor' | 'backgroundColor'>;
export type NodeHeaderColorStyle = Pick<CSSProperties, 'backgroundColor'>;
export type EdgeColorStyle = Pick<CSSProperties, 'stroke'>;
export type TextColorStyle = Pick<CSSProperties, 'color'>;

export function colorTokenStyle(token: ColorToken | undefined, kind: 'node'): NodeColorStyle;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node-header',
): NodeHeaderColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'edge'): EdgeColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'text'): TextColorStyle;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node' | 'node-header' | 'edge' | 'text',
): NodeColorStyle | NodeHeaderColorStyle | EdgeColorStyle | TextColorStyle {
  const resolved = token ?? 'default';
  // `'none'` short-circuits every kind to transparent. The picker hides the
  // `'none'` slot for text and edge kinds, but if it ever reaches here we
  // still return a sane no-op rather than reading the placeholder entry.
  if (resolved === 'none') {
    if (kind === 'node') return { borderColor: 'transparent', backgroundColor: 'transparent' };
    if (kind === 'node-header') return { backgroundColor: 'transparent' };
    if (kind === 'edge') return { stroke: 'transparent' };
    return {};
  }
  const entry = COLOR_TOKEN_MAP[resolved];
  if (kind === 'edge') return { stroke: entry.edge };
  if (kind === 'text') return resolved === 'default' ? {} : { color: entry.edge };
  if (kind === 'node-header') return { backgroundColor: entry.headerBackground };
  return { borderColor: entry.border, backgroundColor: entry.background };
}

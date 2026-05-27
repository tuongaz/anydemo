import type { CSSProperties } from 'react';
import type { ColorToken } from '../types.ts';

// Per-token palette: `body` is the hue. The rendered body fill is
// `hsla(H, S%, L%, BODY_ALPHA)` — a very subtle tint over the canvas
// surface so the description text stays on a near-neutral background. The
// `headerBackground` paints at FULL saturation (opaque hsl) so the header
// reads as a proper title bar — solid color, no border-bottom separator.
// `border` keeps its hand-tuned hue/saturation/lightness so the outline
// reads as a subtly darker, less-saturated variant of the body.
//
// `default` and `none` are special-cased below — `default` uses theme
// tokens so it adapts to dark mode; `none` paints transparent.
type Hsl = readonly [h: number, s: number, l: number];

const BODY_ALPHA = 0.12;

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
      const solid = hsl(bh, bs, bl);
      const entry: TokenEntry = {
        border: hsl(rh, rs, rl),
        // Body sits at a very subtle alpha so it reads as a faint hue
        // over the canvas surface — text stays on a near-neutral fill.
        background: hsla(bh, bs, bl, BODY_ALPHA),
        // Edge connectors and the header bar both paint at full
        // saturation so they remain visually punchy.
        edge: solid,
        headerBackground: solid,
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
  // White is opaque white throughout (body + header both solid white).
  // No hsla alpha here — the user-facing "white" choice should look
  // literally white, not a barely-there tint.
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

// Foreground used by `'node-header-text'` when the header bar is painted
// with a color token (skipped for `'default'` / `'none'` / undefined —
// those keep the theme foreground). Light headers get dark text, dark
// headers get light text so the title stays readable on the solid bar.
const TEXT_ON_LIGHT = 'hsl(220, 15%, 15%)';
const TEXT_ON_DARK = 'hsl(0, 0%, 98%)';
const TEXT_LIGHTNESS_THRESHOLD = 60;

function paintedLightness(token: ColorToken): number | null {
  if (token === 'white') return 100;
  if (token in PALETTE) return PALETTE[token as keyof typeof PALETTE].body[2];
  return null;
}

export type NodeColorStyle = Pick<CSSProperties, 'borderColor' | 'backgroundColor'>;
export type NodeHeaderColorStyle = Pick<CSSProperties, 'backgroundColor'>;
export type EdgeColorStyle = Pick<CSSProperties, 'stroke'>;
export type TextColorStyle = Pick<CSSProperties, 'color'>;

export function colorTokenStyle(token: ColorToken | undefined, kind: 'node'): NodeColorStyle;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node-header',
): NodeHeaderColorStyle;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node-header-text',
): TextColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'edge'): EdgeColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'text'): TextColorStyle;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node' | 'node-header' | 'node-header-text' | 'edge' | 'text',
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
  if (kind === 'node-header-text') {
    if (resolved === 'default') return {};
    const l = paintedLightness(resolved);
    if (l === null) return {};
    return { color: l >= TEXT_LIGHTNESS_THRESHOLD ? TEXT_ON_LIGHT : TEXT_ON_DARK };
  }
  const entry = COLOR_TOKEN_MAP[resolved];
  if (kind === 'edge') return { stroke: entry.edge };
  if (kind === 'text') return resolved === 'default' ? {} : { color: entry.edge };
  if (kind === 'node-header') return { backgroundColor: entry.headerBackground };
  return { borderColor: entry.border, backgroundColor: entry.background };
}

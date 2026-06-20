import type { CSSProperties } from 'react';
import type { ColorToken } from '../types.ts';

// Curated palette. Each hue is a single saturated ACCENT HSL (L≈42–60, tuned
// to read on both dark and light card surfaces). A colored node renders as the
// theme surface (`hsl(var(--card))` — dark in dark mode, white in light) with
// the accent on the border and a faint translucent accent tint on the header
// bar, so one definition yields both the dark and light renderings. `white` is
// the lone exception (an explicitly-opaque-white card in either mode), handled
// in COLOR_TOKEN_MAP below.
type Hsl = readonly [h: number, s: number, l: number];

type ThemeToken =
  | 'slate'
  | 'gray'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'fuchsia'
  | 'pink';

// The card surface every colored node body now follows so it adapts to
// dark/light mode. Re-exported below as NODE_DEFAULT_BG_WHITE for callers.
const CARD_SURFACE = 'hsl(var(--card))';

// One saturated accent per hue. Lightness is normalized toward ≈42–60 so the
// border stays legible on both the dark and light card surface (the old border
// tier sat at L≈30, too muddy for dark mode). Connectors + swatch chips paint
// at this accent too.
const ACCENTS: Record<ThemeToken, Hsl> = {
  slate: [215, 22, 48],
  // Near-neutral grey (sat ≤10) — distinct from slate's blue-grey (sat ~22).
  gray: [220, 9, 50],
  red: [0, 72, 51],
  orange: [25, 85, 50],
  amber: [38, 88, 50],
  yellow: [48, 90, 50],
  lime: [95, 62, 45],
  green: [142, 58, 44],
  teal: [173, 62, 42],
  cyan: [190, 78, 43],
  // sky slots between cyan(190) and blue(217).
  sky: [200, 88, 48],
  blue: [217, 82, 55],
  indigo: [231, 72, 60],
  violet: [262, 70, 60],
  // fuchsia fills the violet→pink gap.
  fuchsia: [292, 68, 58],
  pink: [330, 72, 58],
};

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

// Header tint opacity: the accent painted this faint over the card body reads
// as a subtle title bar that adapts to dark/light mode automatically.
const HEADER_TINT_ALPHA = 0.14;

type TokenEntry = {
  border: string;
  background: string;
  edge: string;
  headerBackground: string;
};

const PAINTED_ENTRIES = Object.fromEntries(
  (Object.entries(ACCENTS) as [ThemeToken, Hsl][]).map(([token, accent]) => {
    const border = hsl(...accent);
    const entry: TokenEntry = {
      // Border carries the full accent.
      border,
      // Body follows the theme surface so it adapts to dark/light mode.
      background: CARD_SURFACE,
      // Connectors + swatch chips paint at the accent (saturated).
      edge: border,
      // Header bar is a faint translucent accent over the card body.
      headerBackground: hsla(accent[0], accent[1], accent[2], HEADER_TINT_ALPHA),
    };
    return [token, entry];
  }),
) as Record<ThemeToken, TokenEntry>;

const COLOR_TOKEN_MAP: Record<ColorToken, TokenEntry> = {
  // `'none'` is rendered as transparent body — `colorTokenStyle` short-circuits
  // before reading these values (and supplies the neutral gray border), so
  // they're placeholders only.
  none: {
    border: 'transparent',
    background: 'transparent',
    edge: 'transparent',
    headerBackground: 'transparent',
  },
  default: {
    // Theme-driven so the unset fallback adapts to dark mode. Border is the
    // neutral card edge (matches the `'none'` outline) rather than a loud brand
    // color so a default node reads as a plain card.
    border: 'hsl(var(--border))',
    background: CARD_SURFACE,
    edge: 'hsl(var(--muted-foreground))',
    headerBackground: 'hsl(var(--muted))',
  },
  // White body is solid white in BOTH modes; the header sits a touch grey so it
  // still reads as a header bar instead of vanishing into the white body. The
  // border is a light grey so the card edge stays visible against a white
  // canvas. `edge` stays pure white so the picker swatch (which has its own
  // chip border) still reads as "white".
  white: {
    border: 'hsl(0, 0%, 82%)',
    background: 'hsl(0, 0%, 100%)',
    edge: 'hsl(0, 0%, 100%)',
    headerBackground: 'hsl(0, 0%, 91%)',
  },
  ...PAINTED_ENTRIES,
};

export const COLOR_TOKENS = COLOR_TOKEN_MAP;

export const NODE_DEFAULT_BG_WHITE = CARD_SURFACE;

// Neutral gray border for the `'none'` and `'default'` tokens — the theme card
// edge, so a colorless node keeps a visible outline that adapts to dark/light.
const NEUTRAL_BORDER = 'hsl(var(--border))';

// `white` forces an opaque-white card in either canvas mode, so its title +
// body text must stay dark regardless of mode. Every other token now follows
// the adaptive card surface and inherits the theme foreground instead.
const TEXT_ON_LIGHT = 'hsl(220, 15%, 15%)';
const BODY_TEXT_ON_LIGHT = 'hsl(220, 14%, 36%)';

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
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node-body-text',
): TextColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'edge'): EdgeColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'text'): TextColorStyle;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node' | 'node-header' | 'node-header-text' | 'node-body-text' | 'edge' | 'text',
): NodeColorStyle | NodeHeaderColorStyle | EdgeColorStyle | TextColorStyle {
  const resolved = token ?? 'default';
  if (resolved === 'none') {
    // No fill, but keep a neutral gray border so a colorless node stays
    // visible instead of vanishing into the canvas.
    if (kind === 'node') return { borderColor: NEUTRAL_BORDER, backgroundColor: 'transparent' };
    if (kind === 'node-header') return { backgroundColor: 'transparent' };
    if (kind === 'edge') return { stroke: 'transparent' };
    return {};
  }
  if (kind === 'node-header-text') {
    // Only the forced-white card needs fixed dark text; every other token
    // follows the adaptive card surface and inherits the theme foreground.
    return resolved === 'white' ? { color: TEXT_ON_LIGHT } : {};
  }
  if (kind === 'node-body-text') {
    return resolved === 'white' ? { color: BODY_TEXT_ON_LIGHT } : {};
  }
  const entry = COLOR_TOKEN_MAP[resolved];
  if (kind === 'edge') return { stroke: entry.edge };
  if (kind === 'text') return resolved === 'default' ? {} : { color: entry.edge };
  if (kind === 'node-header') return { backgroundColor: entry.headerBackground };
  return { borderColor: entry.border, backgroundColor: entry.background };
}

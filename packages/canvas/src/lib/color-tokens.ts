import type { CSSProperties } from 'react';
import type { ColorToken } from '../types.ts';

// Curated palette. Every theme is a hand-tuned (body, header, border) tuple
// at FULL opacity — no alpha trick. Bodies sit at L≥90 (pastel) so dark text
// reads on them; headers sit at L≈38–60 (saturated mid) so they act as
// proper title bars; borders sit at L≈30–52 (darker / more saturated than
// the header) so the outline reads as a deeper variant of the same hue.
// `text` flags whether the header is light enough for dark text (`'light'`)
// or dark enough that it needs light text (`'dark'`) — `colorTokenStyle`
// reads this directly for `'node-header-text'`, replacing the old
// lightness-threshold heuristic.
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

type Theme = { body: Hsl; header: Hsl; border: Hsl; text: 'light' | 'dark' };

const THEMES: Record<ThemeToken, Theme> = {
  slate: { body: [215, 16, 92], header: [215, 20, 45], border: [215, 25, 35], text: 'dark' },
  // Near-neutral grey (sat ≤9) — distinct from slate's blue-grey (sat 16–25).
  gray: { body: [220, 8, 92], header: [220, 7, 46], border: [220, 9, 42], text: 'dark' },
  red: { body: [0, 84, 94], header: [0, 70, 50], border: [0, 70, 42], text: 'dark' },
  // Header darkened L50→46 so white title text keeps a comfortable margin.
  orange: { body: [25, 95, 92], header: [25, 85, 46], border: [25, 80, 42], text: 'dark' },
  // amber is too luminous for white text (was ~2:1) → dark title text.
  amber: { body: [43, 92, 90], header: [38, 85, 50], border: [38, 80, 42], text: 'light' },
  // yellow + lime fill the amber→green gap; both luminous → dark title text.
  yellow: { body: [52, 96, 90], header: [50, 95, 52], border: [47, 90, 42], text: 'light' },
  lime: { body: [90, 70, 90], header: [95, 60, 45], border: [98, 65, 35], text: 'light' },
  green: { body: [142, 50, 92], header: [142, 60, 38], border: [142, 65, 30], text: 'dark' },
  teal: { body: [173, 60, 92], header: [173, 65, 38], border: [173, 70, 30], text: 'dark' },
  // Header darkened L42→38 so white text clears ~5:1 (cyan is luminous).
  cyan: { body: [189, 70, 92], header: [189, 80, 38], border: [189, 80, 35], text: 'dark' },
  // sky slots between cyan(189) and blue(217).
  sky: { body: [200, 90, 92], header: [200, 88, 46], border: [202, 90, 39], text: 'dark' },
  blue: { body: [217, 70, 93], header: [217, 80, 52], border: [217, 85, 45], text: 'dark' },
  indigo: { body: [231, 60, 94], header: [231, 70, 58], border: [231, 75, 50], text: 'light' },
  violet: { body: [262, 60, 94], header: [262, 70, 60], border: [262, 75, 52], text: 'light' },
  // fuchsia fills the violet→pink gap; matches their dark-text treatment.
  fuchsia: { body: [292, 70, 94], header: [292, 68, 58], border: [292, 75, 49], text: 'light' },
  pink: { body: [330, 70, 94], header: [330, 70, 58], border: [330, 75, 50], text: 'light' },
};

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

type TokenEntry = {
  border: string;
  background: string;
  edge: string;
  headerBackground: string;
};

const PAINTED_ENTRIES = Object.fromEntries(
  (Object.entries(THEMES) as [ThemeToken, Theme][]).map(([token, theme]) => {
    const border = hsl(...theme.border);
    const entry: TokenEntry = {
      border,
      // Body now paints at full opacity from the theme's pastel HSL.
      background: hsl(...theme.body),
      // Connectors + swatch chips paint at the border color (saturated).
      edge: border,
      // Header bar paints at the theme's mid-saturated header HSL.
      headerBackground: hsl(...theme.header),
    };
    return [token, entry];
  }),
) as Record<ThemeToken, TokenEntry>;

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
    // Theme-driven so the unset fallback adapts to dark mode.
    border: 'hsl(var(--primary))',
    background: 'hsl(var(--card))',
    edge: 'hsl(var(--muted-foreground))',
    headerBackground: 'hsl(var(--muted))',
  },
  // White is opaque white throughout (body + header both solid white).
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

// Foreground used by `'node-header-text'`. Light headers (text:'light') get
// dark text; dark headers (text:'dark') get light text. Picked once from the
// theme tuple at apply time — no runtime lightness arithmetic.
const TEXT_ON_LIGHT = 'hsl(220, 15%, 15%)';
const TEXT_ON_DARK = 'hsl(0, 0%, 98%)';

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
  if (resolved === 'none') {
    if (kind === 'node') return { borderColor: 'transparent', backgroundColor: 'transparent' };
    if (kind === 'node-header') return { backgroundColor: 'transparent' };
    if (kind === 'edge') return { stroke: 'transparent' };
    return {};
  }
  if (kind === 'node-header-text') {
    if (resolved === 'default') return {};
    if (resolved === 'white') return { color: TEXT_ON_LIGHT };
    const theme = THEMES[resolved as ThemeToken];
    return { color: theme.text === 'light' ? TEXT_ON_LIGHT : TEXT_ON_DARK };
  }
  const entry = COLOR_TOKEN_MAP[resolved];
  if (kind === 'edge') return { stroke: entry.edge };
  if (kind === 'text') return resolved === 'default' ? {} : { color: entry.edge };
  if (kind === 'node-header') return { backgroundColor: entry.headerBackground };
  return { borderColor: entry.border, backgroundColor: entry.background };
}

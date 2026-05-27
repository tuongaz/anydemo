import type { CSSProperties } from 'react';
import type { ColorToken } from '../types.ts';

const COLOR_TOKEN_MAP: Record<
  ColorToken,
  { border: string; background: string; edge: string; headerBackground: string }
> = {
  // `'none'` is rendered as transparent — `colorTokenStyle` short-circuits
  // before reading these values, so they're placeholders only and never
  // surface as a swatch fill (the picker special-cases the slot).
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
  // Named tokens: `background` and `headerBackground` are translucent overlays
  // of the same hue as `edge` so the rendered fill reads as the same color
  // family the picker swatch advertises. Mirrors the design system's badge
  // pattern (design.html lines 626-628: `rgba(<color>, 0.15)` on a dark
  // canvas). Theme-agnostic — works on both light and dark backgrounds.
  // Header sits at a higher alpha so it stays distinct from the body fill.
  slate: {
    border: 'hsl(215, 20%, 40%)',
    background: 'hsla(215, 16%, 47%, 0.15)',
    edge: 'hsl(215, 16%, 47%)',
    headerBackground: 'hsla(215, 16%, 47%, 0.25)',
  },
  gray: {
    border: 'hsl(220, 9%, 46%)',
    background: 'hsla(220, 9%, 55%, 0.15)',
    edge: 'hsl(220, 9%, 55%)',
    headerBackground: 'hsla(220, 9%, 55%, 0.25)',
  },
  red: {
    border: 'hsl(0, 70%, 55%)',
    background: 'hsla(0, 84%, 60%, 0.15)',
    edge: 'hsl(0, 84%, 60%)',
    headerBackground: 'hsla(0, 84%, 60%, 0.25)',
  },
  rose: {
    border: 'hsl(347, 70%, 55%)',
    background: 'hsla(347, 84%, 60%, 0.15)',
    edge: 'hsl(347, 84%, 60%)',
    headerBackground: 'hsla(347, 84%, 60%, 0.25)',
  },
  orange: {
    border: 'hsl(25, 80%, 53%)',
    background: 'hsla(25, 95%, 55%, 0.15)',
    edge: 'hsl(25, 95%, 55%)',
    headerBackground: 'hsla(25, 95%, 55%, 0.25)',
  },
  amber: {
    border: 'hsl(43, 70%, 50%)',
    background: 'hsla(38, 92%, 50%, 0.15)',
    edge: 'hsl(38, 92%, 50%)',
    headerBackground: 'hsla(38, 92%, 50%, 0.25)',
  },
  lime: {
    border: 'hsl(85, 60%, 50%)',
    background: 'hsla(85, 78%, 55%, 0.15)',
    edge: 'hsl(85, 78%, 55%)',
    headerBackground: 'hsla(85, 78%, 55%, 0.25)',
  },
  green: {
    border: 'hsl(142, 50%, 45%)',
    background: 'hsla(142, 71%, 45%, 0.15)',
    edge: 'hsl(142, 71%, 45%)',
    headerBackground: 'hsla(142, 71%, 45%, 0.25)',
  },
  teal: {
    border: 'hsl(173, 60%, 45%)',
    background: 'hsla(173, 80%, 50%, 0.15)',
    edge: 'hsl(173, 80%, 50%)',
    headerBackground: 'hsla(173, 80%, 50%, 0.25)',
  },
  cyan: {
    border: 'hsl(189, 70%, 50%)',
    background: 'hsla(189, 94%, 55%, 0.15)',
    edge: 'hsl(189, 94%, 55%)',
    headerBackground: 'hsla(189, 94%, 55%, 0.25)',
  },
  blue: {
    border: 'hsl(213, 70%, 55%)',
    background: 'hsla(217, 91%, 60%, 0.15)',
    edge: 'hsl(217, 91%, 60%)',
    headerBackground: 'hsla(217, 91%, 60%, 0.25)',
  },
  indigo: {
    border: 'hsl(231, 60%, 60%)',
    background: 'hsla(231, 88%, 65%, 0.15)',
    edge: 'hsl(231, 88%, 65%)',
    headerBackground: 'hsla(231, 88%, 65%, 0.25)',
  },
  violet: {
    border: 'hsl(252, 60%, 62%)',
    background: 'hsla(252, 88%, 68%, 0.15)',
    edge: 'hsl(252, 88%, 68%)',
    headerBackground: 'hsla(252, 88%, 68%, 0.25)',
  },
  purple: {
    border: 'hsl(270, 60%, 60%)',
    background: 'hsla(271, 91%, 65%, 0.15)',
    edge: 'hsl(271, 91%, 65%)',
    headerBackground: 'hsla(271, 91%, 65%, 0.25)',
  },
  pink: {
    border: 'hsl(330, 60%, 60%)',
    background: 'hsla(330, 81%, 60%, 0.15)',
    edge: 'hsl(330, 81%, 60%)',
    headerBackground: 'hsla(330, 81%, 60%, 0.25)',
  },
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

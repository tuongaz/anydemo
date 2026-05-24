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
  slate: {
    border: 'hsl(215, 20%, 40%)',
    background: 'hsl(215, 15%, 15%)',
    edge: 'hsl(215, 16%, 47%)',
    headerBackground: 'hsl(215, 15%, 11%)',
  },
  gray: {
    border: 'hsl(220, 9%, 46%)',
    background: 'hsl(220, 13%, 16%)',
    edge: 'hsl(220, 9%, 55%)',
    headerBackground: 'hsl(220, 13%, 12%)',
  },
  red: {
    border: 'hsl(0, 70%, 55%)',
    background: 'hsl(0, 25%, 14%)',
    edge: 'hsl(0, 84%, 60%)',
    headerBackground: 'hsl(0, 25%, 10%)',
  },
  rose: {
    border: 'hsl(347, 70%, 55%)',
    background: 'hsl(347, 25%, 14%)',
    edge: 'hsl(347, 84%, 60%)',
    headerBackground: 'hsl(347, 25%, 10%)',
  },
  orange: {
    border: 'hsl(25, 80%, 53%)',
    background: 'hsl(25, 30%, 14%)',
    edge: 'hsl(25, 95%, 55%)',
    headerBackground: 'hsl(25, 30%, 10%)',
  },
  amber: {
    border: 'hsl(43, 70%, 50%)',
    background: 'hsl(43, 30%, 14%)',
    edge: 'hsl(38, 92%, 50%)',
    headerBackground: 'hsl(43, 30%, 10%)',
  },
  lime: {
    border: 'hsl(85, 60%, 50%)',
    background: 'hsl(85, 25%, 13%)',
    edge: 'hsl(85, 78%, 55%)',
    headerBackground: 'hsl(85, 25%, 9%)',
  },
  green: {
    border: 'hsl(142, 50%, 45%)',
    background: 'hsl(142, 25%, 13%)',
    edge: 'hsl(142, 71%, 45%)',
    headerBackground: 'hsl(142, 25%, 9%)',
  },
  teal: {
    border: 'hsl(173, 60%, 45%)',
    background: 'hsl(173, 25%, 13%)',
    edge: 'hsl(173, 80%, 50%)',
    headerBackground: 'hsl(173, 25%, 9%)',
  },
  cyan: {
    border: 'hsl(189, 70%, 50%)',
    background: 'hsl(189, 28%, 13%)',
    edge: 'hsl(189, 94%, 55%)',
    headerBackground: 'hsl(189, 28%, 9%)',
  },
  blue: {
    border: 'hsl(213, 70%, 55%)',
    background: 'hsl(214, 30%, 14%)',
    edge: 'hsl(217, 91%, 60%)',
    headerBackground: 'hsl(214, 30%, 10%)',
  },
  indigo: {
    border: 'hsl(231, 60%, 60%)',
    background: 'hsl(231, 25%, 14%)',
    edge: 'hsl(231, 88%, 65%)',
    headerBackground: 'hsl(231, 25%, 10%)',
  },
  violet: {
    border: 'hsl(252, 60%, 62%)',
    background: 'hsl(252, 22%, 15%)',
    edge: 'hsl(252, 88%, 68%)',
    headerBackground: 'hsl(252, 22%, 11%)',
  },
  purple: {
    border: 'hsl(270, 60%, 60%)',
    background: 'hsl(270, 20%, 15%)',
    edge: 'hsl(271, 91%, 65%)',
    headerBackground: 'hsl(270, 20%, 11%)',
  },
  pink: {
    border: 'hsl(330, 60%, 60%)',
    background: 'hsl(330, 20%, 14%)',
    edge: 'hsl(330, 81%, 60%)',
    headerBackground: 'hsl(330, 20%, 10%)',
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

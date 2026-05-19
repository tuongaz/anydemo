import type { CSSProperties } from 'react';
import type { ColorToken } from '../types.ts';

const COLOR_TOKEN_MAP: Record<
  ColorToken,
  { border: string; background: string; edge: string; headerBackground: string }
> = {
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
  blue: {
    border: 'hsl(213, 70%, 55%)',
    background: 'hsl(214, 30%, 14%)',
    edge: 'hsl(217, 91%, 60%)',
    headerBackground: 'hsl(214, 30%, 10%)',
  },
  green: {
    border: 'hsl(142, 50%, 45%)',
    background: 'hsl(142, 25%, 13%)',
    edge: 'hsl(142, 71%, 45%)',
    headerBackground: 'hsl(142, 25%, 9%)',
  },
  amber: {
    border: 'hsl(43, 70%, 50%)',
    background: 'hsl(43, 30%, 14%)',
    edge: 'hsl(38, 92%, 50%)',
    headerBackground: 'hsl(43, 30%, 10%)',
  },
  red: {
    border: 'hsl(0, 70%, 55%)',
    background: 'hsl(0, 25%, 14%)',
    edge: 'hsl(0, 84%, 60%)',
    headerBackground: 'hsl(0, 25%, 10%)',
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
  const entry = COLOR_TOKEN_MAP[resolved];
  if (kind === 'edge') return { stroke: entry.edge };
  if (kind === 'text') return resolved === 'default' ? {} : { color: entry.edge };
  if (kind === 'node-header') return { backgroundColor: entry.headerBackground };
  return { borderColor: entry.border, backgroundColor: entry.background };
}

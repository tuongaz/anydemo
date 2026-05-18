import type { CSSProperties } from 'react';
import type { ColorToken } from '../types.ts';

const COLOR_TOKEN_MAP: Record<ColorToken, { border: string; background: string; edge: string }> = {
  default: {
    border: 'hsl(var(--border))',
    background: 'hsl(var(--card))',
    edge: 'hsl(var(--muted-foreground))',
  },
  slate: {
    border: 'hsl(215, 20%, 40%)',
    background: 'hsl(215, 15%, 15%)',
    edge: 'hsl(215, 16%, 47%)',
  },
  blue: {
    border: 'hsl(213, 70%, 55%)',
    background: 'hsl(214, 30%, 14%)',
    edge: 'hsl(217, 91%, 60%)',
  },
  green: {
    border: 'hsl(142, 50%, 45%)',
    background: 'hsl(142, 25%, 13%)',
    edge: 'hsl(142, 71%, 45%)',
  },
  amber: {
    border: 'hsl(43, 70%, 50%)',
    background: 'hsl(43, 30%, 14%)',
    edge: 'hsl(38, 92%, 50%)',
  },
  red: {
    border: 'hsl(0, 70%, 55%)',
    background: 'hsl(0, 25%, 14%)',
    edge: 'hsl(0, 84%, 60%)',
  },
  purple: {
    border: 'hsl(270, 60%, 60%)',
    background: 'hsl(270, 20%, 15%)',
    edge: 'hsl(271, 91%, 65%)',
  },
  pink: {
    border: 'hsl(330, 60%, 60%)',
    background: 'hsl(330, 20%, 14%)',
    edge: 'hsl(330, 81%, 60%)',
  },
};

export const COLOR_TOKENS = COLOR_TOKEN_MAP;

export const NODE_DEFAULT_BG_WHITE = 'hsl(var(--card))';

export type NodeColorStyle = Pick<CSSProperties, 'borderColor' | 'backgroundColor'>;
export type EdgeColorStyle = Pick<CSSProperties, 'stroke'>;
export type TextColorStyle = Pick<CSSProperties, 'color'>;

export function colorTokenStyle(token: ColorToken | undefined, kind: 'node'): NodeColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'edge'): EdgeColorStyle;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'text'): TextColorStyle;
export function colorTokenStyle(
  token: ColorToken | undefined,
  kind: 'node' | 'edge' | 'text',
): NodeColorStyle | EdgeColorStyle | TextColorStyle {
  const resolved = token ?? 'default';
  const entry = COLOR_TOKEN_MAP[resolved];
  if (kind === 'edge') return { stroke: entry.edge };
  if (kind === 'text') return resolved === 'default' ? {} : { color: entry.edge };
  return { borderColor: entry.border, backgroundColor: entry.background };
}

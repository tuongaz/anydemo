import { describe, expect, it } from 'bun:test';
import type { ColorToken } from '../types.ts';
import { COLOR_TOKENS, colorTokenStyle } from './color-tokens.ts';

const ALL_TOKENS: ColorToken[] = [
  'default',
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
];

describe('COLOR_TOKENS map', () => {
  it('has an entry for every ColorToken enum value', () => {
    for (const token of ALL_TOKENS) {
      expect(COLOR_TOKENS[token]).toBeDefined();
    }
    // No extra keys beyond the enum.
    expect(Object.keys(COLOR_TOKENS).sort()).toEqual([...ALL_TOKENS].sort());
  });

  it('every entry exposes non-empty border/background/edge/headerBackground strings', () => {
    for (const token of ALL_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.border.length).toBeGreaterThan(0);
      expect(entry.background.length).toBeGreaterThan(0);
      expect(entry.edge.length).toBeGreaterThan(0);
      expect(entry.headerBackground.length).toBeGreaterThan(0);
    }
  });

  it('uses shadcn CSS variables for the default token so it adapts to dark mode', () => {
    expect(COLOR_TOKENS.default.border).toContain('var(--');
    expect(COLOR_TOKENS.default.background).toContain('var(--');
    expect(COLOR_TOKENS.default.edge).toContain('var(--');
    expect(COLOR_TOKENS.default.headerBackground).toContain('var(--');
  });
});

describe('colorTokenStyle', () => {
  it('returns borderColor + backgroundColor non-empty strings for kind=node', () => {
    for (const token of ALL_TOKENS) {
      const style = colorTokenStyle(token, 'node');
      expect(typeof style.borderColor).toBe('string');
      expect(typeof style.backgroundColor).toBe('string');
      expect((style.borderColor as string).length).toBeGreaterThan(0);
      expect((style.backgroundColor as string).length).toBeGreaterThan(0);
    }
  });

  it('returns a stroke non-empty string for kind=edge', () => {
    for (const token of ALL_TOKENS) {
      const style = colorTokenStyle(token, 'edge');
      expect(typeof style.stroke).toBe('string');
      expect((style.stroke as string).length).toBeGreaterThan(0);
    }
  });

  it('falls back to the default token when given undefined', () => {
    expect(colorTokenStyle(undefined, 'node')).toEqual(colorTokenStyle('default', 'node'));
    expect(colorTokenStyle(undefined, 'edge')).toEqual(colorTokenStyle('default', 'edge'));
  });

  it('maps each token to its COLOR_TOKENS entry', () => {
    for (const token of ALL_TOKENS) {
      const node = colorTokenStyle(token, 'node');
      const edge = colorTokenStyle(token, 'edge');
      expect(node.borderColor).toBe(COLOR_TOKENS[token].border);
      expect(node.backgroundColor).toBe(COLOR_TOKENS[token].background);
      expect(edge.stroke).toBe(COLOR_TOKENS[token].edge);
    }
  });

  it('returns the default token header background when given undefined for kind=node-header', () => {
    const style = colorTokenStyle(undefined, 'node-header');
    expect(style.backgroundColor).toBe(COLOR_TOKENS.default.headerBackground);
    expect(style.backgroundColor).toBe('hsl(var(--muted))');
  });

  it('maps each token to its headerBackground for kind=node-header', () => {
    for (const token of ALL_TOKENS) {
      const style = colorTokenStyle(token, 'node-header');
      expect(style.backgroundColor).toBe(COLOR_TOKENS[token].headerBackground);
    }
  });

  it('returns a distinct header background from the body background for non-default tokens', () => {
    const nonDefault: ColorToken[] = ['slate', 'blue', 'green', 'amber', 'red', 'purple', 'pink'];
    for (const token of nonDefault) {
      const node = colorTokenStyle(token, 'node');
      const header = colorTokenStyle(token, 'node-header');
      expect(header.backgroundColor).not.toBe(node.backgroundColor);
    }
  });
});

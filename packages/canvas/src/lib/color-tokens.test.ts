import { describe, expect, it } from 'bun:test';
import type { ColorToken } from '../types.ts';
import { COLOR_TOKENS, colorTokenStyle } from './color-tokens.ts';

const ALL_TOKENS: ColorToken[] = [
  'none',
  'default',
  'white',
  'slate',
  'gray',
  'red',
  'rose',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'purple',
  'pink',
];

// Tokens with concrete (non-transparent) color values. `'none'` is omitted
// because its COLOR_TOKEN_MAP entry intentionally uses `transparent` strings;
// `colorTokenStyle` short-circuits before reading them.
const PAINTED_TOKENS: ColorToken[] = ALL_TOKENS.filter((t) => t !== 'none');

// Tokens whose body is a literal HSL color (no theme variable). White is
// included; `default` is excluded because its body resolves via theme tokens.
const LITERAL_BODY_TOKENS: ColorToken[] = PAINTED_TOKENS.filter((t) => t !== 'default');

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

  it('uses transparent placeholders for the none token', () => {
    expect(COLOR_TOKENS.none.border).toBe('transparent');
    expect(COLOR_TOKENS.none.background).toBe('transparent');
    expect(COLOR_TOKENS.none.edge).toBe('transparent');
    expect(COLOR_TOKENS.none.headerBackground).toBe('transparent');
  });

  it('paints every literal-body token with an opaque hsl() string (no hsla)', () => {
    for (const token of LITERAL_BODY_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.background.startsWith('hsl(')).toBe(true);
      expect(entry.background).not.toMatch(/hsla\(/);
      expect(entry.headerBackground.startsWith('hsl(')).toBe(true);
      expect(entry.headerBackground).not.toMatch(/hsla\(/);
    }
  });

  it('paints body and edge with the same color for non-white literal tokens (swatch ↔ body parity)', () => {
    for (const token of LITERAL_BODY_TOKENS.filter((t) => t !== 'white')) {
      const entry = COLOR_TOKENS[token];
      expect(entry.background).toBe(entry.edge);
    }
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

  it('maps each painted token to its COLOR_TOKENS entry', () => {
    for (const token of PAINTED_TOKENS) {
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

  it('maps each painted token to its headerBackground for kind=node-header', () => {
    for (const token of PAINTED_TOKENS) {
      const style = colorTokenStyle(token, 'node-header');
      expect(style.backgroundColor).toBe(COLOR_TOKENS[token].headerBackground);
    }
  });

  it('returns a distinct header background from the body background for non-default painted tokens', () => {
    const nonDefault = PAINTED_TOKENS.filter((t) => t !== 'default');
    for (const token of nonDefault) {
      const node = colorTokenStyle(token, 'node');
      const header = colorTokenStyle(token, 'node-header');
      expect(header.backgroundColor).not.toBe(node.backgroundColor);
    }
  });

  describe('kind=node-body-text', () => {
    it('returns an empty style for theme-backed tokens (default + undefined + none)', () => {
      expect(colorTokenStyle(undefined, 'node-body-text')).toEqual({});
      expect(colorTokenStyle('default', 'node-body-text')).toEqual({});
      expect(colorTokenStyle('none', 'node-body-text')).toEqual({});
    });

    it('returns dark text for light-body tokens', () => {
      const darkText = 'hsl(220, 15%, 15%)';
      for (const token of [
        'white',
        'indigo',
        'violet',
        'purple',
        'red',
        'rose',
        'blue',
        'pink',
      ] as const) {
        expect(colorTokenStyle(token, 'node-body-text')).toEqual({ color: darkText });
      }
    });

    it('returns light text for darker-body tokens', () => {
      const lightText = 'hsl(0, 0%, 98%)';
      for (const token of ['slate', 'green', 'teal', 'amber'] as const) {
        expect(colorTokenStyle(token, 'node-body-text')).toEqual({ color: lightText });
      }
    });
  });

  describe('none token', () => {
    it('returns transparent border + background for kind=node', () => {
      const style = colorTokenStyle('none', 'node');
      expect(style.borderColor).toBe('transparent');
      expect(style.backgroundColor).toBe('transparent');
    });

    it('returns transparent background for kind=node-header', () => {
      const style = colorTokenStyle('none', 'node-header');
      expect(style.backgroundColor).toBe('transparent');
    });

    it('returns transparent stroke for kind=edge', () => {
      const style = colorTokenStyle('none', 'edge');
      expect(style.stroke).toBe('transparent');
    });

    it('returns an empty style for kind=text (text inherits theme foreground)', () => {
      const style = colorTokenStyle('none', 'text');
      expect(style).toEqual({});
    });
  });
});

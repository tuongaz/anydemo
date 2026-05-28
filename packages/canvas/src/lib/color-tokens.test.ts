import { describe, expect, it } from 'bun:test';
import type { ColorToken } from '../types.ts';
import { COLOR_TOKENS, colorTokenStyle } from './color-tokens.ts';

// The 19-slot curated palette: 16 themed tokens + the 3 specials. There is no
// color migration — old projects are regenerated (commit 3dfc9f7), so dropped
// tokens that later return (e.g. `gray`/`lime`) are not remapped anywhere.
const ALL_TOKENS: ColorToken[] = [
  'none',
  'default',
  'white',
  'slate',
  'gray',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'pink',
];

// Tokens with concrete (non-transparent) color values. `'none'` is omitted
// because its COLOR_TOKEN_MAP entry intentionally uses `transparent` strings;
// `colorTokenStyle` short-circuits before reading them.
const PAINTED_TOKENS: ColorToken[] = ALL_TOKENS.filter((t) => t !== 'none');

// The 16 themed tokens — used in palette-math assertions that don't apply to
// the theme-backed `default` or the opaque-white `white` token.
const THEMED_TOKENS: ColorToken[] = PAINTED_TOKENS.filter((t) => t !== 'default' && t !== 'white');

describe('COLOR_TOKENS map', () => {
  it('has an entry for every ColorToken enum value', () => {
    for (const token of ALL_TOKENS) {
      expect(COLOR_TOKENS[token]).toBeDefined();
    }
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

  it('paints themed-token bodies at FULL opacity (opaque hsl, no alpha)', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.background.startsWith('hsl(')).toBe(true);
      expect(entry.background).not.toMatch(/hsla\(/);
    }
  });

  it('paints headerBackground at the saturated header HSL for every themed token', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.headerBackground.startsWith('hsl(')).toBe(true);
      expect(entry.headerBackground).not.toMatch(/hsla\(/);
    }
  });

  it('headerBackground differs from body for themed tokens (header is saturated, body is pastel)', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.headerBackground).not.toBe(entry.background);
    }
  });

  it('edge equals border for themed tokens (connectors paint at the border color)', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.edge).toBe(entry.border);
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

  describe('kind=node-header-text', () => {
    it('returns an empty style for theme-backed tokens (default + undefined + none)', () => {
      expect(colorTokenStyle(undefined, 'node-header-text')).toEqual({});
      expect(colorTokenStyle('default', 'node-header-text')).toEqual({});
      expect(colorTokenStyle('none', 'node-header-text')).toEqual({});
    });

    it('returns dark text for light-header tokens (text:"light")', () => {
      const darkText = 'hsl(220, 15%, 15%)';
      // `white` is opaque white throughout — treated as a light header so
      // the title stays readable. Themed tokens with `text:'light'` get dark
      // text: the high-L hues (indigo/violet/fuchsia/pink) plus the luminous
      // yellow-family hues (amber/yellow/lime) that read too light for white.
      for (const token of [
        'white',
        'amber',
        'yellow',
        'lime',
        'indigo',
        'violet',
        'fuchsia',
        'pink',
      ] as const) {
        expect(colorTokenStyle(token, 'node-header-text')).toEqual({ color: darkText });
      }
    });

    it('returns light text for darker-header tokens (text:"dark")', () => {
      const lightText = 'hsl(0, 0%, 98%)';
      // Themed tokens whose saturated mid-dark header reads light text well.
      for (const token of [
        'slate',
        'gray',
        'red',
        'orange',
        'green',
        'teal',
        'cyan',
        'sky',
        'blue',
      ] as const) {
        expect(colorTokenStyle(token, 'node-header-text')).toEqual({ color: lightText });
      }
    });
  });

  describe('kind=node-body-text', () => {
    it('inherits theme foreground for default + undefined + none fills', () => {
      expect(colorTokenStyle(undefined, 'node-body-text')).toEqual({});
      expect(colorTokenStyle('default', 'node-body-text')).toEqual({});
      expect(colorTokenStyle('none', 'node-body-text')).toEqual({});
    });

    it('returns fixed dark text for white + every themed fill (light pastel islands)', () => {
      const bodyText = 'hsl(220, 14%, 36%)';
      for (const token of ['white', ...THEMED_TOKENS] as const) {
        expect(colorTokenStyle(token, 'node-body-text')).toEqual({ color: bodyText });
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

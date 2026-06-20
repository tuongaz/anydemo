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

  it('points the default border at the neutral card edge (not a brand color)', () => {
    // "Default option too": an unset node reads as a plain neutral card, the
    // same outline a `'none'` node shows.
    expect(COLOR_TOKENS.default.border).toBe('hsl(var(--border))');
    expect(colorTokenStyle('default', 'node').borderColor).toBe('hsl(var(--border))');
  });

  it('uses transparent placeholders for the none token', () => {
    expect(COLOR_TOKENS.none.border).toBe('transparent');
    expect(COLOR_TOKENS.none.background).toBe('transparent');
    expect(COLOR_TOKENS.none.edge).toBe('transparent');
    expect(COLOR_TOKENS.none.headerBackground).toBe('transparent');
  });

  it('paints themed-token bodies at the adaptive card surface (theme-driven)', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      // Body now follows the theme surface so it adapts to dark/light mode —
      // the accent lives on the border + a translucent header tint, not the body.
      expect(entry.background).toBe('hsl(var(--card))');
    }
  });

  it('paints headerBackground as a translucent accent tint for every themed token', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      // Translucent accent over the card body → tints subtly and adapts to
      // dark/light mode from a single definition.
      expect(entry.headerBackground.startsWith('hsla(')).toBe(true);
    }
  });

  it('headerBackground differs from body for themed tokens (translucent accent vs card)', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.headerBackground).not.toBe(entry.background);
    }
  });

  it('paints border at an opaque accent HSL (saturated, not a theme var) for themed tokens', () => {
    for (const token of THEMED_TOKENS) {
      const entry = COLOR_TOKENS[token];
      expect(entry.border.startsWith('hsl(')).toBe(true);
      expect(entry.border).not.toMatch(/hsla\(/);
      expect(entry.border).not.toContain('var(--');
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

  it('themed nodes paint the adaptive card surface + opaque accent border', () => {
    for (const token of THEMED_TOKENS) {
      const node = colorTokenStyle(token, 'node');
      expect(node.backgroundColor).toBe('hsl(var(--card))');
      expect((node.borderColor as string).startsWith('hsl(')).toBe(true);
      expect(node.borderColor).not.toContain('var(--');
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
    it('inherits theme foreground for theme-backed + every themed token', () => {
      // The header is now a faint translucent accent tint over the adaptive
      // card surface, so the title inherits the theme foreground (white-ish in
      // dark mode, near-black in light mode) for every themed token.
      for (const token of [undefined, 'default', 'none', ...THEMED_TOKENS] as const) {
        expect(colorTokenStyle(token, 'node-header-text')).toEqual({});
      }
    });

    it('returns fixed dark text only for the forced-white header', () => {
      // `white` paints an opaque white card in BOTH modes, so its title text
      // must stay dark regardless of canvas mode.
      expect(colorTokenStyle('white', 'node-header-text')).toEqual({
        color: 'hsl(220, 15%, 15%)',
      });
    });
  });

  describe('kind=node-body-text', () => {
    it('inherits theme foreground for theme-backed + every themed fill', () => {
      // Themed body fills are now the adaptive card surface, so body text
      // inherits the theme muted-foreground and adapts to dark/light mode.
      for (const token of [undefined, 'default', 'none', ...THEMED_TOKENS] as const) {
        expect(colorTokenStyle(token, 'node-body-text')).toEqual({});
      }
    });

    it('returns fixed dark text only for the forced-white fill', () => {
      expect(colorTokenStyle('white', 'node-body-text')).toEqual({ color: 'hsl(220, 14%, 36%)' });
    });
  });

  describe('none token', () => {
    it('returns a neutral gray border + transparent background for kind=node', () => {
      // No fill, but a visible neutral outline so a colorless node doesn't
      // vanish into the canvas.
      const style = colorTokenStyle('none', 'node');
      expect(style.borderColor).toBe('hsl(var(--border))');
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

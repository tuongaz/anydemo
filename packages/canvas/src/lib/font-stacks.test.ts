import { describe, expect, it } from 'bun:test';
import type { FontFamilyToken } from '../types.ts';
import { FONT_FAMILY_OPTIONS, FONT_STACKS, resolveFontStack } from './font-stacks.ts';

describe('resolveFontStack', () => {
  it('resolves a token to its concrete stack', () => {
    expect(resolveFontStack('serif')).toBe(FONT_STACKS.serif);
    expect(resolveFontStack('serif')).toContain('Georgia');
    expect(resolveFontStack('mono')).toContain('JetBrains Mono');
  });

  it('resolves every token to its stack', () => {
    for (const opt of FONT_FAMILY_OPTIONS) {
      expect(resolveFontStack(opt.token)).toBe(FONT_STACKS[opt.token]);
    }
  });

  it('returns undefined for an unset token so callers inherit the default', () => {
    expect(resolveFontStack(undefined)).toBeUndefined();
  });
});

describe('FONT_FAMILY_OPTIONS', () => {
  it('lists every stack token exactly once, sans first', () => {
    const tokens = FONT_FAMILY_OPTIONS.map((o) => o.token);
    expect(tokens[0]).toBe('sans');
    expect(new Set(tokens).size).toBe(tokens.length);
    const stackKeys = Object.keys(FONT_STACKS);
    expect(tokens.length).toBe(stackKeys.length);
    for (const k of stackKeys) expect(tokens).toContain(k as FontFamilyToken);
  });

  it('every option has a non-empty label + stack', () => {
    for (const o of FONT_FAMILY_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(FONT_STACKS[o.token].length).toBeGreaterThan(0);
    }
  });
});

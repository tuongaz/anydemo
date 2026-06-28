import { describe, expect, it } from 'bun:test';
import { EMOJI_CATALOG } from './emoji-catalog.ts';
import { formatIconId, parseIconId } from './icon-id.ts';

describe('EMOJI_CATALOG', () => {
  it('ships a substantial set of emojis', () => {
    expect(EMOJI_CATALOG.length).toBeGreaterThan(1500);
  });

  it('every entry is a well-formed twemoji slug with searchable text', () => {
    for (const e of EMOJI_CATALOG) {
      expect(e.id.startsWith('twemoji:')).toBe(true);
      expect(e.id.length).toBeGreaterThan('twemoji:'.length);
      expect(e.label.trim().length).toBeGreaterThan(0);
      expect(e.keywords.trim().length).toBeGreaterThan(0);
      // keywords haystack is pre-lowercased for case-insensitive matching.
      expect(e.keywords).toBe(e.keywords.toLowerCase());
    }
  });

  it('has no duplicate ids', () => {
    const ids = new Set(EMOJI_CATALOG.map((e) => e.id));
    expect(ids.size).toBe(EMOJI_CATALOG.length);
  });

  it('round-trips through the iconify vendor id encoding', () => {
    const { id } = EMOJI_CATALOG[0]!;
    const fullId = formatIconId({ vendor: 'iconify', name: id });
    expect(fullId).toBe(`iconify:${id}`);
    expect(parseIconId(fullId)).toEqual({ vendor: 'iconify', name: id });
  });

  it('excludes skin-tone modifier variants', () => {
    expect(EMOJI_CATALOG.some((e) => /skin-tone/.test(e.id))).toBe(false);
  });

  it('contains common, recognizable emojis', () => {
    const ids = new Set(EMOJI_CATALOG.map((e) => e.id));
    expect(ids.has('twemoji:grinning-face')).toBe(true);
    expect(ids.has('twemoji:red-heart')).toBe(true);
  });
});

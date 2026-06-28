import { describe, expect, it } from 'bun:test';
import type { EmojiCatalogEntry } from './emoji-catalog-types.ts';
import { EMOJI_TAB, filterEmoji, isEmojiTab, tabRenderVendor } from './picker-tabs.ts';

const SAMPLE: EmojiCatalogEntry[] = [
  { id: 'twemoji:grinning-face', label: 'grinning face', keywords: 'grinning face happy smile' },
  { id: 'twemoji:red-heart', label: 'red heart', keywords: 'red heart love' },
  { id: 'twemoji:dog-face', label: 'dog face', keywords: 'dog face pet puppy' },
];

describe('tabRenderVendor', () => {
  it('maps the emoji tab to the iconify vendor', () => {
    expect(tabRenderVendor(EMOJI_TAB)).toBe('iconify');
  });

  it('maps every other tab to itself', () => {
    expect(tabRenderVendor('lucide')).toBe('lucide');
    expect(tabRenderVendor('aws')).toBe('aws');
    expect(tabRenderVendor('iconify')).toBe('iconify');
  });
});

describe('isEmojiTab', () => {
  it('narrows only the emoji tab', () => {
    expect(isEmojiTab('emoji')).toBe(true);
    expect(isEmojiTab('lucide')).toBe(false);
    expect(isEmojiTab('iconify')).toBe(false);
  });
});

describe('filterEmoji', () => {
  it('returns [] before the catalog loads', () => {
    expect(filterEmoji(null, '')).toEqual([]);
    expect(filterEmoji(null, 'happy')).toEqual([]);
  });

  it('returns every id (in order) for an empty query', () => {
    expect(filterEmoji(SAMPLE, '')).toEqual([
      'twemoji:grinning-face',
      'twemoji:red-heart',
      'twemoji:dog-face',
    ]);
    expect(filterEmoji(SAMPLE, '   ')).toHaveLength(3);
  });

  it('matches the keyword haystack, not the slug', () => {
    // "happy" appears only in keywords, never in the slug.
    expect(filterEmoji(SAMPLE, 'happy')).toEqual(['twemoji:grinning-face']);
    expect(filterEmoji(SAMPLE, 'love')).toEqual(['twemoji:red-heart']);
    expect(filterEmoji(SAMPLE, 'puppy')).toEqual(['twemoji:dog-face']);
  });

  it('is case-insensitive and trims the query', () => {
    expect(filterEmoji(SAMPLE, '  HEART ')).toEqual(['twemoji:red-heart']);
  });

  it('returns [] when nothing matches', () => {
    expect(filterEmoji(SAMPLE, 'zzzz')).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';

const memStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string): string | null => memStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    memStore.set(k, v);
  },
  removeItem: (k: string): void => {
    memStore.delete(k);
  },
};

(globalThis as { window?: { localStorage: typeof mockLocalStorage } }).window = {
  localStorage: mockLocalStorage,
};

const { ICON_RECENTS_STORAGE_KEY, getRecents, pushRecent } = await import('./icon-recents.ts');

beforeEach(() => {
  memStore.clear();
});

describe('getRecents', () => {
  it('returns [] when the key is missing', () => {
    expect(getRecents()).toEqual([]);
  });

  it('returns [] when the stored payload is not valid JSON', () => {
    memStore.set(ICON_RECENTS_STORAGE_KEY, '{not json');
    expect(getRecents()).toEqual([]);
  });

  it('returns [] when the stored payload is JSON but not an array', () => {
    memStore.set(ICON_RECENTS_STORAGE_KEY, JSON.stringify({ recents: ['x'] }));
    expect(getRecents()).toEqual([]);
  });

  it('returns [] when the stored payload is an array but contains non-strings', () => {
    memStore.set(ICON_RECENTS_STORAGE_KEY, JSON.stringify(['ok', 42, 'still-ok']));
    expect(getRecents()).toEqual([]);
  });

  it('round-trips an array of strings through JSON', () => {
    memStore.set(ICON_RECENTS_STORAGE_KEY, JSON.stringify(['a', 'b', 'c']));
    expect(getRecents()).toEqual(['a', 'b', 'c']);
  });
});

describe('pushRecent', () => {
  it('adds a name to an empty store', () => {
    pushRecent('shopping-cart');
    expect(getRecents()).toEqual(['shopping-cart']);
  });

  it('places the most recently pushed name first (MRU order)', () => {
    pushRecent('a');
    pushRecent('b');
    pushRecent('c');
    expect(getRecents()).toEqual(['c', 'b', 'a']);
  });

  it('dedupes by moving the existing entry to the front rather than duplicating', () => {
    pushRecent('a');
    pushRecent('b');
    pushRecent('c');
    pushRecent('a');
    expect(getRecents()).toEqual(['a', 'c', 'b']);
  });

  it('caps the list at 16 entries, evicting the oldest', () => {
    for (let i = 0; i < 20; i++) pushRecent(`icon-${i}`);
    const recents = getRecents();
    expect(recents).toHaveLength(16);
    // Most recent push lands at the front; the four oldest (0..3) are evicted.
    expect(recents[0]).toBe('icon-19');
    expect(recents[15]).toBe('icon-4');
    expect(recents).not.toContain('icon-3');
    expect(recents).not.toContain('icon-0');
  });

  it('persists the new list as JSON in localStorage', () => {
    pushRecent('a');
    pushRecent('b');
    const raw = memStore.get(ICON_RECENTS_STORAGE_KEY);
    expect(raw).toBe(JSON.stringify(['b', 'a']));
  });

  it('treats a corrupt payload as empty and writes a fresh array', () => {
    memStore.set(ICON_RECENTS_STORAGE_KEY, '{corrupt');
    pushRecent('a');
    expect(getRecents()).toEqual(['a']);
  });
});

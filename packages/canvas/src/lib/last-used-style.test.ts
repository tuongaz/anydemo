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

(globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;

const { DEFAULT_STORAGE_PREFIX, getLastUsedStyle, rememberNodeStyle, rememberConnectorStyle } =
  await import('./last-used-style.ts');

const STORAGE_KEY = 'seeflow:last-used-style:v1';

beforeEach(() => {
  memStore.clear();
});

describe('DEFAULT_STORAGE_PREFIX', () => {
  it('matches the legacy STORAGE_KEY prefix', () => {
    expect(DEFAULT_STORAGE_PREFIX).toBe('seeflow');
  });

  it('produces the legacy `seeflow:last-used-style:v1` key when used as the prefix', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'blue' });
    expect(memStore.get(STORAGE_KEY)).toBe(
      JSON.stringify({ node: { borderColor: 'blue' }, connector: {} }),
    );
  });
});

describe('getLastUsedStyle', () => {
  it('returns empty buckets when the key is missing', () => {
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX)).toEqual({ node: {}, connector: {} });
  });

  it('returns empty buckets when the stored JSON is corrupt', () => {
    memStore.set(STORAGE_KEY, '{not json');
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX)).toEqual({ node: {}, connector: {} });
  });

  it('returns empty buckets when the stored payload is JSON but the wrong shape', () => {
    memStore.set(STORAGE_KEY, JSON.stringify(['array', 'not', 'object']));
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX)).toEqual({ node: {}, connector: {} });
  });

  it('coerces a non-object `node` sub-bucket to an empty object', () => {
    memStore.set(STORAGE_KEY, JSON.stringify({ node: 'wat', connector: { color: 'blue' } }));
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX)).toEqual({
      node: {},
      connector: { color: 'blue' },
    });
  });

  it('round-trips a stored payload', () => {
    memStore.set(
      STORAGE_KEY,
      JSON.stringify({ node: { borderColor: 'blue' }, connector: { style: 'dashed' } }),
    );
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX)).toEqual({
      node: { borderColor: 'blue' },
      connector: { style: 'dashed' },
    });
  });

  it('scopes reads to the supplied prefix', () => {
    memStore.set('other:last-used-style:v1', JSON.stringify({ node: { borderColor: 'red' } }));
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX)).toEqual({ node: {}, connector: {} });
    expect(getLastUsedStyle('other')).toEqual({ node: { borderColor: 'red' }, connector: {} });
  });
});

describe('rememberNodeStyle', () => {
  it('stores a node patch into the node bucket', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'blue' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({ borderColor: 'blue' });
  });

  it('shallow-merges successive patches', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'blue' });
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { backgroundColor: 'red' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({
      borderColor: 'blue',
      backgroundColor: 'red',
    });
  });

  it('later writes override earlier writes for the same field', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'blue' });
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'green' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({ borderColor: 'green' });
  });

  it('strips `alt` (content, not style)', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { alt: 'a server', color: 'amber' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({ color: 'amber' });
    expect('alt' in getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toBe(false);
  });

  it('mirrors borderSize → borderWidth on write', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderSize: 4 });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({
      borderSize: 4,
      borderWidth: 4,
    });
  });

  it('mirrors borderWidth → borderSize on write', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderWidth: 6 });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({
      borderSize: 6,
      borderWidth: 6,
    });
  });

  it('does not clobber an explicit pairing when both fields are present', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderSize: 4, borderWidth: 6 });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({
      borderSize: 4,
      borderWidth: 6,
    });
  });

  it('preserves the connector bucket', () => {
    rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, { style: 'dashed' });
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'blue' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).connector).toEqual({ style: 'dashed' });
  });

  it('scopes writes to the supplied prefix', () => {
    rememberNodeStyle('other', { borderColor: 'red' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({});
    expect(getLastUsedStyle('other').node).toEqual({ borderColor: 'red' });
  });
});

describe('rememberConnectorStyle', () => {
  it('stores a connector patch into the connector bucket', () => {
    rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, { style: 'dashed' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).connector).toEqual({ style: 'dashed' });
  });

  it('shallow-merges successive patches', () => {
    rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, { style: 'dashed' });
    rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, { color: 'red' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).connector).toEqual({
      style: 'dashed',
      color: 'red',
    });
  });

  it('preserves the node bucket', () => {
    rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'blue' });
    rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, { style: 'dashed' });
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node).toEqual({ borderColor: 'blue' });
  });

  it('does not remember connector animation', () => {
    rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, { color: 'red', animated: true });
    const remembered = getLastUsedStyle(DEFAULT_STORAGE_PREFIX).connector;
    expect(remembered.color).toBe('red');
    expect(remembered.animated).toBeUndefined();
  });
});

describe('storage failure modes', () => {
  it('rememberNodeStyle does not throw when setItem throws', () => {
    const throwingStorage: typeof mockLocalStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = throwingStorage;
    expect(() => rememberNodeStyle(DEFAULT_STORAGE_PREFIX, { borderColor: 'blue' })).not.toThrow();
    // restore for subsequent tests
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;
  });

  it('rememberConnectorStyle does not throw when setItem throws', () => {
    const throwingStorage: typeof mockLocalStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = throwingStorage;
    expect(() => rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, { style: 'dashed' })).not.toThrow();
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;
  });

  it('getLastUsedStyle does not throw when getItem throws', () => {
    const throwingStorage: typeof mockLocalStorage = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = throwingStorage;
    expect(getLastUsedStyle(DEFAULT_STORAGE_PREFIX)).toEqual({ node: {}, connector: {} });
    (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;
  });
});

import { describe, expect, it } from 'bun:test';
import {
  ID_PREFIX_BY_TYPE,
  ID_TYPES,
  MAX_ID_COUNT,
  generateIds,
  isIdType,
  shortId,
} from './short-id.ts';

describe('shortId', () => {
  it('returns 10 chars by default', () => {
    expect(shortId()).toHaveLength(10);
  });

  it('honours the requested length', () => {
    expect(shortId(1)).toHaveLength(1);
    expect(shortId(32)).toHaveLength(32);
  });

  it('only emits base62 characters', () => {
    const id = shortId(1000);
    expect(/^[A-Za-z0-9]+$/.test(id)).toBe(true);
  });

  it('does not collide across a large batch', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(shortId());
    expect(ids.size).toBe(10_000);
  });
});

describe('id-type vocabulary', () => {
  it('exposes exactly the two public types', () => {
    expect([...ID_TYPES]).toEqual(['node', 'connector']);
  });

  it('maps node → `node-` and connector → `conn-`', () => {
    expect(ID_PREFIX_BY_TYPE.node).toBe('node-');
    expect(ID_PREFIX_BY_TYPE.connector).toBe('conn-');
  });

  it('caps batches at 100', () => {
    expect(MAX_ID_COUNT).toBe(100);
  });
});

describe('isIdType', () => {
  it('accepts node and connector', () => {
    expect(isIdType('node')).toBe(true);
    expect(isIdType('connector')).toBe(true);
  });

  it('rejects everything else (including conn, NODE, undefined, numbers, objects)', () => {
    expect(isIdType('conn')).toBe(false);
    expect(isIdType('NODE')).toBe(false);
    expect(isIdType('')).toBe(false);
    expect(isIdType(undefined)).toBe(false);
    expect(isIdType(null)).toBe(false);
    expect(isIdType(0)).toBe(false);
    expect(isIdType({})).toBe(false);
  });
});

describe('generateIds', () => {
  it('returns count ids, each prefixed by the canonical type prefix', () => {
    const nodes = generateIds('node', 3);
    expect(nodes).toHaveLength(3);
    for (const id of nodes) {
      expect(/^node-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }

    const conns = generateIds('connector', 4);
    expect(conns).toHaveLength(4);
    for (const id of conns) {
      expect(/^conn-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
  });

  it('does not collide across a batch of MAX_ID_COUNT', () => {
    const ids = generateIds('node', MAX_ID_COUNT);
    expect(new Set(ids).size).toBe(MAX_ID_COUNT);
  });
});

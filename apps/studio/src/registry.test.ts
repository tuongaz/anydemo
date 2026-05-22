import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry, slugify } from './registry.ts';

const tmpRegistryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-registry-'));
  return join(dir, 'registry.json');
};

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with dashes', () => {
    expect(slugify('Checkout Flow')).toBe('checkout-flow');
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  spaces   here ')).toBe('spaces-here');
  });

  it('returns "demo" for empty/non-alphanumeric input', () => {
    expect(slugify('')).toBe('demo');
    expect(slugify('!!!')).toBe('demo');
  });
});

describe('createRegistry', () => {
  it('upsert adds a new entry with id + slug', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const entry = reg.upsert({
      name: 'Checkout Flow',
      repoPath: '/tmp/repo-a',
      flowPath: 'flow.json',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.slug).toBe('checkout-flow');
    expect(reg.list()).toHaveLength(1);
  });

  it('different repos with the same name get -2, -3 collision suffixes', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({ name: 'Dup', repoPath: '/tmp/a', flowPath: 'd.json' });
    const b = reg.upsert({ name: 'Dup', repoPath: '/tmp/b', flowPath: 'd.json' });
    const c = reg.upsert({ name: 'Dup', repoPath: '/tmp/c', flowPath: 'd.json' });
    expect(a.slug).toBe('dup');
    expect(b.slug).toBe('dup-2');
    expect(c.slug).toBe('dup-3');
  });

  it('re-registering the same repoPath keeps id + slug, updates name', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const first = reg.upsert({ name: 'Old name', repoPath: '/tmp/r', flowPath: 'd.json' });
    const second = reg.upsert({ name: 'New name', repoPath: '/tmp/r', flowPath: 'd.json' });
    expect(second.id).toBe(first.id);
    expect(second.slug).toBe(first.slug);
    expect(second.name).toBe('New name');
    expect(reg.list()).toHaveLength(1);
  });

  it('same repoPath + different flowPath coexist as two entries', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({
      name: 'Checkout',
      repoPath: '/tmp/multi',
      flowPath: 'checkout/flow.json',
    });
    const b = reg.upsert({
      name: 'Refund',
      repoPath: '/tmp/multi',
      flowPath: 'refund/flow.json',
    });
    expect(a.id).not.toBe(b.id);
    expect(a.slug).toBe('checkout');
    expect(b.slug).toBe('refund');
    expect(reg.list()).toHaveLength(2);
  });

  it('upsert for (repoPath, flowPath) only updates that entry, leaves siblings unchanged', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({
      name: 'Checkout',
      repoPath: '/tmp/multi',
      flowPath: 'checkout/flow.json',
    });
    const b = reg.upsert({
      name: 'Refund',
      repoPath: '/tmp/multi',
      flowPath: 'refund/flow.json',
    });
    const updated = reg.upsert({
      name: 'Checkout v2',
      repoPath: '/tmp/multi',
      flowPath: 'checkout/flow.json',
    });
    expect(updated.id).toBe(a.id);
    expect(updated.slug).toBe(a.slug);
    expect(updated.name).toBe('Checkout v2');
    expect(reg.list()).toHaveLength(2);
    const sibling = reg.getById(b.id);
    expect(sibling?.name).toBe('Refund');
    expect(sibling?.flowPath).toBe('refund/flow.json');
  });

  it('slug uniqueness still enforced across the WHOLE registry (same name, same repo)', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({
      name: 'Foo',
      repoPath: '/tmp/multi',
      flowPath: 'foo-a/flow.json',
    });
    const b = reg.upsert({
      name: 'Foo',
      repoPath: '/tmp/multi',
      flowPath: 'foo-b/flow.json',
    });
    expect(a.slug).toBe('foo');
    expect(b.slug).toBe('foo-2');
  });

  it('remove by id is surgical: deletes one entry, leaves siblings intact', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({
      name: 'Checkout',
      repoPath: '/tmp/multi',
      flowPath: 'checkout/flow.json',
    });
    const b = reg.upsert({
      name: 'Refund',
      repoPath: '/tmp/multi',
      flowPath: 'refund/flow.json',
    });
    expect(reg.remove(a.id)).toBe(true);
    expect(reg.list()).toHaveLength(1);
    expect(reg.getById(b.id)?.name).toBe('Refund');
    expect(reg.getById(a.id)).toBeUndefined();
  });

  it('getByRepoPathAndFlowPath returns only the matching tuple', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({
      name: 'A',
      repoPath: '/tmp/multi',
      flowPath: 'a/flow.json',
    });
    reg.upsert({
      name: 'B',
      repoPath: '/tmp/multi',
      flowPath: 'b/flow.json',
    });
    const found = reg.getByRepoPathAndFlowPath('/tmp/multi', 'a/flow.json');
    expect(found?.id).toBe(a.id);
    expect(reg.getByRepoPathAndFlowPath('/tmp/multi', 'missing/flow.json')).toBeUndefined();
  });

  it('persists to disk on every mutation and rehydrates on construct', () => {
    const path = tmpRegistryPath();
    const reg1 = createRegistry({ path });
    reg1.upsert({ name: 'Persist me', repoPath: '/tmp/p', flowPath: 'd.json' });

    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk).toHaveLength(1);

    const reg2 = createRegistry({ path });
    expect(reg2.list()).toHaveLength(1);
    expect(reg2.list()[0]?.name).toBe('Persist me');
  });

  it('remove deletes by id and persists', () => {
    const path = tmpRegistryPath();
    const reg = createRegistry({ path });
    const entry = reg.upsert({ name: 'X', repoPath: '/tmp/x', flowPath: 'd.json' });
    expect(reg.remove(entry.id)).toBe(true);
    expect(reg.list()).toHaveLength(0);

    const reg2 = createRegistry({ path });
    expect(reg2.list()).toHaveLength(0);
  });

  it('starts empty when registry.json is corrupt', () => {
    const path = tmpRegistryPath();
    writeFileSync(path, '{ this is not json');
    const reg = createRegistry({ path });
    expect(reg.list()).toHaveLength(0);
  });

  it('persists description on insert and rehydrates it on construct', () => {
    const path = tmpRegistryPath();
    const reg1 = createRegistry({ path });
    reg1.upsert({
      name: 'Documented',
      description: 'Stripe → ship',
      repoPath: '/tmp/d',
      flowPath: 'd.json',
    });

    const reg2 = createRegistry({ path });
    expect(reg2.list()[0]?.description).toBe('Stripe → ship');
  });

  it('omits description on disk when not provided', () => {
    const path = tmpRegistryPath();
    const reg = createRegistry({ path });
    reg.upsert({ name: 'Bare', repoPath: '/tmp/b', flowPath: 'd.json' });
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect('description' in onDisk[0]).toBe(false);
  });

  it('upsert updates description from a fresh value, including clearing it', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const first = reg.upsert({
      name: 'X',
      description: 'first',
      repoPath: '/tmp/x',
      flowPath: 'd.json',
    });
    expect(first.description).toBe('first');

    const second = reg.upsert({
      name: 'X',
      description: 'second',
      repoPath: '/tmp/x',
      flowPath: 'd.json',
    });
    expect(second.description).toBe('second');

    const cleared = reg.upsert({ name: 'X', repoPath: '/tmp/x', flowPath: 'd.json' });
    expect(cleared.description).toBeUndefined();
  });

  it('strips a malformed description from a tampered registry on load', () => {
    const path = tmpRegistryPath();
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: 'abc',
          slug: 'abc',
          name: 'tampered',
          description: 42,
          repoPath: '/tmp/t',
          flowPath: 'd.json',
          lastModified: 0,
          valid: true,
        },
      ]),
    );
    const reg = createRegistry({ path });
    expect(reg.list()[0]?.description).toBeUndefined();
  });
});

describe('onChange subscription', () => {
  it('records the hash of every persisted state for own-echo dedupe', () => {
    const path = tmpRegistryPath();
    const registry = createRegistry({ path });

    registry.upsert({
      name: 'a',
      repoPath: '/tmp/a',
      flowPath: 'flow.json',
    });
    const persisted = readFileSync(path, 'utf8');

    expect(registry.isOwnWrite(persisted)).toBe(true);
    expect(registry.isOwnWrite('[]')).toBe(false);
  });

  it('fires onChange listeners when reload() is called', () => {
    const path = tmpRegistryPath();
    const registry = createRegistry({ path });
    const observed: number[] = [];
    const unsub = registry.onChange(() => observed.push(registry.list().length));

    writeFileSync(
      path,
      JSON.stringify(
        [
          {
            id: 'a',
            slug: 'a',
            name: 'a',
            repoPath: '/tmp/a',
            flowPath: 'flow.json',
            lastModified: 0,
            valid: true,
          },
          {
            id: 'b',
            slug: 'b',
            name: 'b',
            repoPath: '/tmp/b',
            flowPath: 'flow.json',
            lastModified: 0,
            valid: true,
          },
        ],
        null,
        2,
      ),
    );

    registry.reload();
    expect(observed).toEqual([2]);
    unsub();
  });

  it('exposes the resolved path on disk', () => {
    const path = tmpRegistryPath();
    const registry = createRegistry({ path });
    expect(registry.path).toBe(path);
  });
});

describe('atomic registry writes', () => {
  it('never leaves the registry file in a half-written state', async () => {
    const path = tmpRegistryPath();
    const registry = createRegistry({ path });

    const writes = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve().then(() =>
        registry.upsert({
          name: `flow-${i}`,
          repoPath: `/tmp/repo-${i}`,
          flowPath: 'flow.json',
        }),
      ),
    );
    const reads = Array.from({ length: 50 }, () =>
      Promise.resolve().then(() => {
        if (!existsSync(path)) return;
        const content = readFileSync(path, 'utf8');
        expect(() => JSON.parse(content)).not.toThrow();
      }),
    );
    await Promise.all([...writes, ...reads]);
  });
});

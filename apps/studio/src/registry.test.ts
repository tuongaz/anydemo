import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
      flowPath: '.seeflow/flow.json',
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
      flowPath: '.seeflow/checkout/flow.json',
    });
    const b = reg.upsert({
      name: 'Refund',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/refund/flow.json',
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
      flowPath: '.seeflow/checkout/flow.json',
    });
    const b = reg.upsert({
      name: 'Refund',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/refund/flow.json',
    });
    const updated = reg.upsert({
      name: 'Checkout v2',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/checkout/flow.json',
    });
    expect(updated.id).toBe(a.id);
    expect(updated.slug).toBe(a.slug);
    expect(updated.name).toBe('Checkout v2');
    expect(reg.list()).toHaveLength(2);
    const sibling = reg.getById(b.id);
    expect(sibling?.name).toBe('Refund');
    expect(sibling?.flowPath).toBe('.seeflow/refund/flow.json');
  });

  it('slug uniqueness still enforced across the WHOLE registry (same name, same repo)', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({
      name: 'Foo',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/foo-a/flow.json',
    });
    const b = reg.upsert({
      name: 'Foo',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/foo-b/flow.json',
    });
    expect(a.slug).toBe('foo');
    expect(b.slug).toBe('foo-2');
  });

  it('remove by id is surgical: deletes one entry, leaves siblings intact', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert({
      name: 'Checkout',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/checkout/flow.json',
    });
    const b = reg.upsert({
      name: 'Refund',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/refund/flow.json',
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
      flowPath: '.seeflow/a/flow.json',
    });
    reg.upsert({
      name: 'B',
      repoPath: '/tmp/multi',
      flowPath: '.seeflow/b/flow.json',
    });
    const found = reg.getByRepoPathAndFlowPath('/tmp/multi', '.seeflow/a/flow.json');
    expect(found?.id).toBe(a.id);
    expect(
      reg.getByRepoPathAndFlowPath('/tmp/multi', '.seeflow/missing/flow.json'),
    ).toBeUndefined();
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
});

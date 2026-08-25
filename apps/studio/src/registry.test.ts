import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RegisterInput, createRegistry, slugify } from './registry.ts';

const tmpRegistryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-registry-'));
  return join(dir, 'registry.json');
};

// Test helper: fills in the new US-002 required fields with sane single-flow
// defaults so tests can express only what they care about. Tests that want to
// assert multi-flow / non-default behaviour pass overrides explicitly.
const mk = (input: {
  name: string;
  repoPath: string;
  flowPath: string;
  description?: string;
  projectSlug?: string;
  flowSlug?: string;
  isDefault?: boolean;
  icon?: string;
}): RegisterInput => ({
  name: input.name,
  repoPath: input.repoPath,
  flowPath: input.flowPath,
  description: input.description,
  projectSlug: input.projectSlug ?? slugify(input.name),
  flowSlug: input.flowSlug ?? 'main',
  isDefault: input.isDefault ?? true,
  icon: input.icon,
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with dashes', () => {
    expect(slugify('Checkout Flow')).toBe('checkout-flow');
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  spaces   here ')).toBe('spaces-here');
  });

  it('returns "flow" for empty/non-alphanumeric input', () => {
    expect(slugify('')).toBe('flow');
    expect(slugify('!!!')).toBe('flow');
  });
});

describe('createRegistry', () => {
  it('upsert adds a new entry with id + slug derived from projectSlug/flowSlug', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const entry = reg.upsert(
      mk({
        name: 'Checkout Flow',
        repoPath: '/tmp/repo-a',
        flowPath: 'flows/main/flow.json',
      }),
    );
    expect(entry.id).toBeTruthy();
    expect(entry.projectSlug).toBe('checkout-flow');
    expect(entry.flowSlug).toBe('main');
    expect(entry.slug).toBe('checkout-flow/main');
    expect(entry.isDefault).toBe(true);
    expect(reg.list()).toHaveLength(1);
  });

  it('different repos can register the same projectSlug — caller owns uniqueness', () => {
    // Auto-collision (slug-2, slug-3) was retired in US-002: the manifest
    // scanner is responsible for unique (projectSlug, flowSlug) pairs. The
    // registry simply records what the caller supplies, so two callers using
    // the same projectSlug end up with the same derived slug. Surfacing this
    // behaviour keeps the contract honest.
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert(
      mk({
        name: 'Dup',
        repoPath: '/tmp/a',
        flowPath: 'flows/main/flow.json',
        projectSlug: 'dup',
      }),
    );
    const b = reg.upsert(
      mk({
        name: 'Dup',
        repoPath: '/tmp/b',
        flowPath: 'flows/main/flow.json',
        projectSlug: 'dup',
      }),
    );
    expect(a.slug).toBe('dup/main');
    expect(b.slug).toBe('dup/main');
    expect(a.id).not.toBe(b.id);
    expect(reg.list()).toHaveLength(2);
  });

  it('re-registering the same repoPath keeps id + slug, updates name', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const first = reg.upsert(
      mk({ name: 'Old name', repoPath: '/tmp/r', flowPath: 'flows/main/flow.json' }),
    );
    const second = reg.upsert(
      mk({
        name: 'New name',
        repoPath: '/tmp/r',
        flowPath: 'flows/main/flow.json',
        projectSlug: first.projectSlug,
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.slug).toBe(first.slug);
    expect(second.name).toBe('New name');
    expect(reg.list()).toHaveLength(1);
  });

  it('same repoPath + different flowPath coexist as two entries with their own flowSlug', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert(
      mk({
        name: 'Checkout',
        repoPath: '/tmp/multi',
        flowPath: 'flows/checkout/flow.json',
        projectSlug: 'multi',
        flowSlug: 'checkout',
        isDefault: true,
      }),
    );
    const b = reg.upsert(
      mk({
        name: 'Refund',
        repoPath: '/tmp/multi',
        flowPath: 'flows/refund/flow.json',
        projectSlug: 'multi',
        flowSlug: 'refund',
        isDefault: false,
      }),
    );
    expect(a.id).not.toBe(b.id);
    expect(a.slug).toBe('multi/checkout');
    expect(b.slug).toBe('multi/refund');
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);
    expect(reg.list()).toHaveLength(2);
  });

  it('upsert for (repoPath, flowPath) only updates that entry, leaves siblings unchanged', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert(
      mk({
        name: 'Checkout',
        repoPath: '/tmp/multi',
        flowPath: 'flows/checkout/flow.json',
        projectSlug: 'multi',
        flowSlug: 'checkout',
      }),
    );
    const b = reg.upsert(
      mk({
        name: 'Refund',
        repoPath: '/tmp/multi',
        flowPath: 'flows/refund/flow.json',
        projectSlug: 'multi',
        flowSlug: 'refund',
      }),
    );
    const updated = reg.upsert(
      mk({
        name: 'Checkout v2',
        repoPath: '/tmp/multi',
        flowPath: 'flows/checkout/flow.json',
        projectSlug: 'multi',
        flowSlug: 'checkout',
      }),
    );
    expect(updated.id).toBe(a.id);
    expect(updated.slug).toBe(a.slug);
    expect(updated.name).toBe('Checkout v2');
    expect(reg.list()).toHaveLength(2);
    const sibling = reg.getById(b.id);
    expect(sibling?.name).toBe('Refund');
    expect(sibling?.flowPath).toBe('flows/refund/flow.json');
    expect(sibling?.flowSlug).toBe('refund');
  });

  it('two flows in the same project keep distinct slugs via distinct flowSlug', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert(
      mk({
        name: 'Foo A',
        repoPath: '/tmp/multi',
        flowPath: 'flows/foo-a/flow.json',
        projectSlug: 'multi',
        flowSlug: 'foo-a',
      }),
    );
    const b = reg.upsert(
      mk({
        name: 'Foo B',
        repoPath: '/tmp/multi',
        flowPath: 'flows/foo-b/flow.json',
        projectSlug: 'multi',
        flowSlug: 'foo-b',
        isDefault: false,
      }),
    );
    expect(a.slug).toBe('multi/foo-a');
    expect(b.slug).toBe('multi/foo-b');
  });

  it('remove by id is surgical: deletes one entry, leaves siblings intact', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert(
      mk({
        name: 'Checkout',
        repoPath: '/tmp/multi',
        flowPath: 'flows/checkout/flow.json',
        projectSlug: 'multi',
        flowSlug: 'checkout',
      }),
    );
    const b = reg.upsert(
      mk({
        name: 'Refund',
        repoPath: '/tmp/multi',
        flowPath: 'flows/refund/flow.json',
        projectSlug: 'multi',
        flowSlug: 'refund',
        isDefault: false,
      }),
    );
    expect(reg.remove(a.id)).toBe(true);
    expect(reg.list()).toHaveLength(1);
    expect(reg.getById(b.id)?.name).toBe('Refund');
    expect(reg.getById(a.id)).toBeUndefined();
  });

  it('getByRepoPathAndFlowPath returns only the matching tuple', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const a = reg.upsert(
      mk({
        name: 'A',
        repoPath: '/tmp/multi',
        flowPath: 'flows/a/flow.json',
        projectSlug: 'multi',
        flowSlug: 'a',
      }),
    );
    reg.upsert(
      mk({
        name: 'B',
        repoPath: '/tmp/multi',
        flowPath: 'flows/b/flow.json',
        projectSlug: 'multi',
        flowSlug: 'b',
        isDefault: false,
      }),
    );
    const found = reg.getByRepoPathAndFlowPath('/tmp/multi', 'flows/a/flow.json');
    expect(found?.id).toBe(a.id);
    expect(reg.getByRepoPathAndFlowPath('/tmp/multi', 'missing/flow.json')).toBeUndefined();
  });

  it('persists to disk on every mutation and rehydrates on construct', () => {
    const path = tmpRegistryPath();
    const reg1 = createRegistry({ path });
    reg1.upsert(mk({ name: 'Persist me', repoPath: '/tmp/p', flowPath: 'flows/main/flow.json' }));

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
    const entry = reg.upsert(
      mk({ name: 'X', repoPath: '/tmp/x', flowPath: 'flows/main/flow.json' }),
    );
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
    reg1.upsert(
      mk({
        name: 'Documented',
        description: 'Stripe → ship',
        repoPath: '/tmp/d',
        flowPath: 'flows/main/flow.json',
      }),
    );

    const reg2 = createRegistry({ path });
    expect(reg2.list()[0]?.description).toBe('Stripe → ship');
  });

  it('omits description on disk when not provided', () => {
    const path = tmpRegistryPath();
    const reg = createRegistry({ path });
    reg.upsert(mk({ name: 'Bare', repoPath: '/tmp/b', flowPath: 'flows/main/flow.json' }));
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect('description' in onDisk[0]).toBe(false);
  });

  it('upsert updates description from a fresh value, including clearing it', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const first = reg.upsert(
      mk({
        name: 'X',
        description: 'first',
        repoPath: '/tmp/x',
        flowPath: 'flows/main/flow.json',
      }),
    );
    expect(first.description).toBe('first');

    const second = reg.upsert(
      mk({
        name: 'X',
        description: 'second',
        repoPath: '/tmp/x',
        flowPath: 'flows/main/flow.json',
      }),
    );
    expect(second.description).toBe('second');

    const cleared = reg.upsert(
      mk({ name: 'X', repoPath: '/tmp/x', flowPath: 'flows/main/flow.json' }),
    );
    expect(cleared.description).toBeUndefined();
  });

  it('strips a malformed description from a tampered registry on load', () => {
    const path = tmpRegistryPath();
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: 'abc',
          slug: 'tampered/main',
          name: 'tampered',
          description: 42,
          repoPath: '/tmp/t',
          flowPath: 'flows/main/flow.json',
          projectSlug: 'tampered',
          flowSlug: 'main',
          isDefault: true,
          lastModified: 0,
          valid: true,
        },
      ]),
    );
    const reg = createRegistry({ path });
    expect(reg.list()[0]?.description).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // US-002: round-trip the new manifest-derived fields
  // ---------------------------------------------------------------------------

  it('round-trips projectSlug / flowSlug / isDefault / icon via upsert + list + getById', () => {
    const path = tmpRegistryPath();
    const reg = createRegistry({ path });
    const entry = reg.upsert({
      name: 'Retry',
      repoPath: '/tmp/multi',
      flowPath: 'flows/retry/flow.json',
      projectSlug: 'order-pipeline',
      flowSlug: 'retry',
      isDefault: false,
      icon: 'refresh-ccw',
      description: 'recovery path',
    });
    expect(entry.projectSlug).toBe('order-pipeline');
    expect(entry.flowSlug).toBe('retry');
    expect(entry.isDefault).toBe(false);
    expect(entry.icon).toBe('refresh-ccw');
    expect(entry.slug).toBe('order-pipeline/retry');

    const listed = reg.list()[0];
    expect(listed?.projectSlug).toBe('order-pipeline');
    expect(listed?.flowSlug).toBe('retry');
    expect(listed?.isDefault).toBe(false);
    expect(listed?.icon).toBe('refresh-ccw');

    const fetched = reg.getById(entry.id);
    expect(fetched?.projectSlug).toBe('order-pipeline');
    expect(fetched?.flowSlug).toBe('retry');
    expect(fetched?.isDefault).toBe(false);
    expect(fetched?.icon).toBe('refresh-ccw');

    const reloaded = createRegistry({ path });
    const after = reloaded.getById(entry.id);
    expect(after?.projectSlug).toBe('order-pipeline');
    expect(after?.flowSlug).toBe('retry');
    expect(after?.isDefault).toBe(false);
    expect(after?.icon).toBe('refresh-ccw');
    expect(after?.slug).toBe('order-pipeline/retry');
  });

  it('omits icon on disk when not provided and clears it on a subsequent upsert without icon', () => {
    const path = tmpRegistryPath();
    const reg = createRegistry({ path });
    reg.upsert(
      mk({
        name: 'NoIcon',
        repoPath: '/tmp/n',
        flowPath: 'flows/main/flow.json',
      }),
    );
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect('icon' in onDisk[0]).toBe(false);

    const updated = reg.upsert(
      mk({
        name: 'NoIcon',
        repoPath: '/tmp/n',
        flowPath: 'flows/main/flow.json',
        icon: 'star',
      }),
    );
    expect(updated.icon).toBe('star');

    const cleared = reg.upsert(
      mk({
        name: 'NoIcon',
        repoPath: '/tmp/n',
        flowPath: 'flows/main/flow.json',
      }),
    );
    expect(cleared.icon).toBeUndefined();
  });

  it('migrates pre-US-002 entries on load: derives projectSlug, flowSlug, isDefault, recomputes slug', () => {
    const path = tmpRegistryPath();
    // Legacy on-disk shape (no projectSlug / flowSlug / isDefault).
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: 'legacy-id',
          slug: 'legacy-flow',
          name: 'Legacy Flow',
          repoPath: '/tmp/legacy',
          flowPath: 'flow.json',
          lastModified: 0,
          valid: true,
        },
      ]),
    );
    const reg = createRegistry({ path });
    const entry = reg.list()[0];
    expect(entry?.projectSlug).toBe('legacy-flow');
    expect(entry?.flowSlug).toBe('main');
    expect(entry?.isDefault).toBe(true);
    expect(entry?.slug).toBe('legacy-flow/main');
  });
});

describe('onChange subscription', () => {
  it('records the hash of every persisted state for own-echo dedupe', () => {
    const path = tmpRegistryPath();
    const registry = createRegistry({ path });

    registry.upsert(
      mk({
        name: 'a',
        repoPath: '/tmp/a',
        flowPath: 'flows/main/flow.json',
      }),
    );
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
            slug: 'a/main',
            name: 'a',
            repoPath: '/tmp/a',
            flowPath: 'flows/main/flow.json',
            projectSlug: 'a',
            flowSlug: 'main',
            isDefault: true,
            lastModified: 0,
            valid: true,
          },
          {
            id: 'b',
            slug: 'b/main',
            name: 'b',
            repoPath: '/tmp/b',
            flowPath: 'flows/main/flow.json',
            projectSlug: 'b',
            flowSlug: 'main',
            isDefault: true,
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
        registry.upsert(
          mk({
            name: `flow-${i}`,
            repoPath: `/tmp/repo-${i}`,
            flowPath: 'flows/main/flow.json',
            projectSlug: `flow-${i}`,
          }),
        ),
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

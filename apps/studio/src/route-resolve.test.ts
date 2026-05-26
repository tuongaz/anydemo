import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from './registry.ts';
import { resolveProjectFlow } from './route-resolve.ts';

const tmpRegistry = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-route-resolve-'));
  return createRegistry({ path: join(dir, 'registry.json') });
};

const seed = (
  registry: ReturnType<typeof createRegistry>,
  projectSlug: string,
  flowSlug: string,
  opts: { isDefault?: boolean; name?: string } = {},
) =>
  registry.upsert({
    name: opts.name ?? `${projectSlug} ${flowSlug}`,
    repoPath: `/tmp/${projectSlug}`,
    flowPath: `flows/${flowSlug}/flow.json`,
    projectSlug,
    flowSlug,
    isDefault: opts.isDefault ?? false,
  });

describe('resolveProjectFlow', () => {
  it('returns the entry on a project + flow match', () => {
    const registry = tmpRegistry();
    seed(registry, 'order-pipeline', 'main', { isDefault: true });
    const retry = seed(registry, 'order-pipeline', 'retry');

    const result = resolveProjectFlow(registry, 'order-pipeline', 'retry');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.entry.id).toBe(retry.id);
    expect(result.entry.slug).toBe('order-pipeline/retry');
  });

  it('returns project-not-found when no entry has that projectSlug', () => {
    const registry = tmpRegistry();
    seed(registry, 'order-pipeline', 'main', { isDefault: true });

    const result = resolveProjectFlow(registry, 'unknown-project', 'main');
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.code).toBe('project-not-found');
  });

  it('returns flow-not-found when the project is registered but the flow is not', () => {
    const registry = tmpRegistry();
    seed(registry, 'order-pipeline', 'main', { isDefault: true });
    seed(registry, 'order-pipeline', 'retry');

    const result = resolveProjectFlow(registry, 'order-pipeline', 'ghost');
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.code).toBe('flow-not-found');
  });

  it('distinguishes flows with identical slugs across different projects', () => {
    const registry = tmpRegistry();
    const a = seed(registry, 'project-a', 'main', { isDefault: true });
    const b = seed(registry, 'project-b', 'main', { isDefault: true });

    const ra = resolveProjectFlow(registry, 'project-a', 'main');
    const rb = resolveProjectFlow(registry, 'project-b', 'main');
    if (ra.kind !== 'ok' || rb.kind !== 'ok') throw new Error('expected both ok');
    expect(ra.entry.id).toBe(a.id);
    expect(rb.entry.id).toBe(b.id);
    expect(ra.entry.id).not.toBe(rb.entry.id);
  });

  it('returns project-not-found on an empty registry', () => {
    const registry = tmpRegistry();
    const result = resolveProjectFlow(registry, 'any', 'main');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.code).toBe('project-not-found');
  });
});

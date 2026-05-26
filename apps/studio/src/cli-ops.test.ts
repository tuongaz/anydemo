import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProject } from './cli-ops.ts';
import { createRegistry } from './registry.ts';

interface ManifestFlow {
  id: string;
  name: string;
  icon?: string;
}

interface ManifestInit {
  version: number;
  name: string;
  description?: string;
  defaultFlow: string;
  flows: ManifestFlow[];
}

const writeFlowJson = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'flow.json'),
    JSON.stringify({ version: 1, name, nodes: [], connectors: [] }),
  );
};

const tmpProject = (manifest: ManifestInit, flowFolders: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-cli-ops-'));
  writeFileSync(join(dir, 'seeflow.json'), JSON.stringify(manifest));
  for (const id of flowFolders) {
    writeFlowJson(join(dir, 'flows', id), id);
  }
  return dir;
};

const tmpRegistry = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-cli-ops-registry-'));
  return createRegistry({ path: join(dir, 'registry.json') });
};

describe('registerProject', () => {
  it('registers one FlowEntry per declared flow with correct projectSlug + flowSlug', () => {
    const repoPath = tmpProject(
      {
        version: 1,
        name: 'Order Pipeline',
        defaultFlow: 'main',
        flows: [
          { id: 'main', name: 'Main' },
          { id: 'retry', name: 'Retry', icon: 'refresh-ccw' },
        ],
      },
      ['main', 'retry'],
    );
    const registry = tmpRegistry();

    const result = registerProject({ repoPath, registry });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.projectSlug).toBe('order-pipeline');
    expect(result.entries).toHaveLength(2);

    const main = result.entries.find((e) => e.flowSlug === 'main');
    const retry = result.entries.find((e) => e.flowSlug === 'retry');
    if (!main || !retry) throw new Error('expected both main + retry entries');

    expect(main.projectSlug).toBe('order-pipeline');
    expect(retry.projectSlug).toBe('order-pipeline');
    expect(main.slug).toBe('order-pipeline/main');
    expect(retry.slug).toBe('order-pipeline/retry');
    expect(main.isDefault).toBe(true);
    expect(retry.isDefault).toBe(false);
    expect(retry.icon).toBe('refresh-ccw');
    expect(main.icon).toBeUndefined();
    expect(main.flowPath).toBe('flows/main/flow.json');
    expect(retry.flowPath).toBe('flows/retry/flow.json');
    expect(registry.list()).toHaveLength(2);
  });

  it('registers a one-flow project with description carried from the manifest', () => {
    const repoPath = tmpProject(
      {
        version: 1,
        name: 'Solo',
        description: 'Just the one flow',
        defaultFlow: 'main',
        flows: [{ id: 'main', name: 'Main' }],
      },
      ['main'],
    );
    const registry = tmpRegistry();

    const result = registerProject({ repoPath, registry });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.description).toBe('Just the one flow');
    expect(result.entries[0]?.isDefault).toBe(true);
  });

  it('returns manifest-missing when seeflow.json is absent', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-cli-ops-empty-'));
    const registry = tmpRegistry();
    const result = registerProject({ repoPath, registry });
    expect(result.kind).toBe('manifest-missing');
    expect(registry.list()).toHaveLength(0);
  });

  it('returns flow-json-missing when a declared flow folder lacks flow.json', () => {
    const repoPath = tmpProject(
      {
        version: 1,
        name: 'Partial',
        defaultFlow: 'main',
        flows: [
          { id: 'main', name: 'Main' },
          { id: 'retry', name: 'Retry' },
        ],
      },
      ['main'],
    );
    const registry = tmpRegistry();
    const result = registerProject({ repoPath, registry });
    expect(result.kind).toBe('flow-json-missing');
    if (result.kind !== 'flow-json-missing') throw new Error('expected flow-json-missing');
    expect(result.flowId).toBe('retry');
    expect(registry.list()).toHaveLength(0);
  });

  it('updates existing entries in place when called twice for the same project', () => {
    const repoPath = tmpProject(
      {
        version: 1,
        name: 'Order Pipeline',
        defaultFlow: 'main',
        flows: [{ id: 'main', name: 'Main' }],
      },
      ['main'],
    );
    const registry = tmpRegistry();

    const first = registerProject({ repoPath, registry });
    if (first.kind !== 'ok') throw new Error('expected first ok');
    const firstId = first.entries[0]?.id;

    const second = registerProject({ repoPath, registry });
    if (second.kind !== 'ok') throw new Error('expected second ok');
    expect(second.entries[0]?.id).toBe(firstId);
    expect(registry.list()).toHaveLength(1);
  });

  it('marks the default flow even when it is not the first in the flows[] array', () => {
    const repoPath = tmpProject(
      {
        version: 1,
        name: 'Showcase',
        defaultFlow: 'retry',
        flows: [
          { id: 'main', name: 'Main' },
          { id: 'retry', name: 'Retry' },
        ],
      },
      ['main', 'retry'],
    );
    const registry = tmpRegistry();
    const result = registerProject({ repoPath, registry });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const main = result.entries.find((e) => e.flowSlug === 'main');
    const retry = result.entries.find((e) => e.flowSlug === 'retry');
    expect(main?.isDefault).toBe(false);
    expect(retry?.isDefault).toBe(true);
  });
});

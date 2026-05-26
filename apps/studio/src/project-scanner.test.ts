import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanProject } from './project-scanner.ts';

interface ManifestFlow {
  id: string;
  name: string;
  icon?: string;
}

interface ManifestInit {
  version?: number;
  name?: string;
  description?: string;
  defaultFlow?: string;
  flows?: ManifestFlow[];
  // Allow callers to inject malformed shapes for the manifest-invalid case.
  // biome-ignore lint/suspicious/noExplicitAny: test helper accepts any shape
  [extra: string]: any;
}

const writeFlowJson = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'flow.json'),
    JSON.stringify({ version: 1, name, nodes: [], connectors: [] }),
  );
};

const tmpProject = (
  manifest: ManifestInit | undefined,
  flowFolders: string[] = [],
  opts: { legacyRootFlow?: boolean; rawManifest?: string } = {},
): string => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-scanner-'));
  if (opts.legacyRootFlow) {
    writeFlowJson(dir, 'Legacy Project');
  }
  if (opts.rawManifest !== undefined) {
    writeFileSync(join(dir, 'seeflow.json'), opts.rawManifest);
  } else if (manifest !== undefined) {
    writeFileSync(join(dir, 'seeflow.json'), JSON.stringify(manifest));
  }
  for (const id of flowFolders) {
    writeFlowJson(join(dir, 'flows', id), id);
  }
  return dir;
};

describe('scanProject', () => {
  it('returns ok for a one-flow project with defaultFlow marked isDefault', () => {
    const dir = tmpProject(
      {
        version: 1,
        name: 'Order Pipeline',
        defaultFlow: 'main',
        flows: [{ id: 'main', name: 'Main' }],
      },
      ['main'],
    );
    const result = scanProject(dir);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.projectSlug).toBe('order-pipeline');
    expect(result.manifest.name).toBe('Order Pipeline');
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0]).toEqual({
      id: 'main',
      name: 'Main',
      icon: undefined,
      isDefault: true,
      flowPath: 'flows/main/flow.json',
    });
  });

  it('returns ok for a two-flow project with icons and correct default marking', () => {
    const dir = tmpProject(
      {
        version: 1,
        name: 'Component Showcase',
        description: 'A multi-flow showcase project',
        defaultFlow: 'retry',
        flows: [
          { id: 'main', name: 'Main', icon: 'home' },
          { id: 'retry', name: 'Retry', icon: 'refresh-ccw' },
        ],
      },
      ['main', 'retry'],
    );
    const result = scanProject(dir);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.projectSlug).toBe('component-showcase');
    expect(result.flows).toHaveLength(2);
    const main = result.flows.find((f) => f.id === 'main');
    const retry = result.flows.find((f) => f.id === 'retry');
    expect(main).toBeDefined();
    expect(retry).toBeDefined();
    expect(main?.isDefault).toBe(false);
    expect(retry?.isDefault).toBe(true);
    expect(main?.icon).toBe('home');
    expect(retry?.icon).toBe('refresh-ccw');
    expect(main?.flowPath).toBe('flows/main/flow.json');
    expect(retry?.flowPath).toBe('flows/retry/flow.json');
  });

  it('returns manifest-missing when seeflow.json is absent and no legacy flow.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seeflow-scanner-empty-'));
    const result = scanProject(dir);
    expect(result.kind).toBe('manifest-missing');
  });

  it('returns legacy-root-flow when flow.json exists at the project root', () => {
    const dir = tmpProject(undefined, [], { legacyRootFlow: true });
    const result = scanProject(dir);
    expect(result.kind).toBe('legacy-root-flow');
  });

  it('returns manifest-invalid with message for a bad flow id pattern', () => {
    const dir = tmpProject(
      {
        version: 1,
        name: 'Bad Project',
        defaultFlow: '-bad',
        flows: [{ id: '-bad', name: 'Bad' }],
      },
      ['-bad'],
    );
    const result = scanProject(dir);
    expect(result.kind).toBe('manifest-invalid');
    if (result.kind !== 'manifest-invalid') throw new Error('expected manifest-invalid');
    expect(result.message).toContain('flow id must match');
  });

  it('returns manifest-invalid for malformed JSON', () => {
    const dir = tmpProject(undefined, [], { rawManifest: '{ not json' });
    const result = scanProject(dir);
    expect(result.kind).toBe('manifest-invalid');
    if (result.kind !== 'manifest-invalid') throw new Error('expected manifest-invalid');
    expect(result.message).toMatch(/failed to parse seeflow\.json/);
  });

  it('returns flow-json-missing when a declared flow folder lacks flow.json', () => {
    // Only create the 'main' folder, even though manifest declares 'main' + 'retry'.
    const dir = tmpProject(
      {
        version: 1,
        name: 'Partial Project',
        defaultFlow: 'main',
        flows: [
          { id: 'main', name: 'Main' },
          { id: 'retry', name: 'Retry' },
        ],
      },
      ['main'],
    );
    const result = scanProject(dir);
    expect(result.kind).toBe('flow-json-missing');
    if (result.kind !== 'flow-json-missing') throw new Error('expected flow-json-missing');
    expect(result.flowId).toBe('retry');
    expect(result.flowPath).toBe('flows/retry/flow.json');
  });

  it('falls back to basename for projects whose manifest name has no alphanumerics', () => {
    const dir = tmpProject(
      {
        version: 1,
        name: '!!!',
        defaultFlow: 'main',
        flows: [{ id: 'main', name: 'Main' }],
      },
      ['main'],
    );
    const result = scanProject(dir);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    // basename of the mkdtemp dir starts with 'seeflow-scanner-' so slugify
    // will produce a stable string starting with that prefix.
    expect(result.projectSlug.startsWith('seeflow-scanner-')).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bundleProject } from './export-bundle.ts';

function fixtureRoot(): string {
  const root = join(tmpdir(), `sf-export-${crypto.randomUUID()}`);
  mkdirSync(join(root, 'nodes', 'n1'), { recursive: true });
  writeFileSync(
    join(root, 'flow.json'),
    JSON.stringify({ version: 1, name: 'Demo', nodes: [{ id: 'n1', type: 'rectangle' }], connectors: [] }, null, 2),
  );
  writeFileSync(join(root, 'style.json'), JSON.stringify({ nodes: {}, connectors: {} }));
  writeFileSync(join(root, 'nodes', 'n1', 'detail.md'), '# hi');
  return root;
}

describe('bundleProject', () => {
  test('collects flow.json, style.json, and node files with forward-slash relative paths', () => {
    const bundle = bundleProject(fixtureRoot());
    const paths = bundle.files.map((f) => f.path).sort();
    expect(paths).toEqual(['flow.json', 'nodes/n1/detail.md', 'style.json']);
    expect(bundle.files.find((f) => f.path === 'flow.json')?.content).toContain('"name": "Demo"');
  });

  test('omits an absent style.json', () => {
    const root = join(tmpdir(), `sf-export-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'flow.json'),
      JSON.stringify({ version: 1, name: 'N', nodes: [], connectors: [] }),
    );
    expect(bundleProject(root).files.map((f) => f.path)).toEqual(['flow.json']);
  });

  test('derives the bundle name from flow.json name', () => {
    expect(bundleProject(fixtureRoot()).name).toBe('Demo');
  });

  test('throws when flow.json is missing', () => {
    const root = join(tmpdir(), `sf-export-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    expect(() => bundleProject(root)).toThrow();
  });
});

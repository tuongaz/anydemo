import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineComponentSpecs } from './component-spec-resolver.ts';
import type { ResolvedFlow } from './schema.ts';

const setupProject = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-spec-'));
  mkdirSync(join(dir, 'nodes', 'n1'), { recursive: true });
  writeFileSync(
    join(dir, 'nodes', 'n1', 'spec.json'),
    JSON.stringify({
      root: 'r',
      state: { '/x': 1 },
      elements: { r: { type: 'Text', props: { text: 'hi' } } },
    }),
  );
  return dir;
};

const baseComponentNode = (id: string) => ({
  id,
  type: 'component' as const,
  position: { x: 0, y: 0 },
  data: { spec: { root: 'placeholder', elements: {} } },
});

const baseFlow = (nodes: unknown[]): ResolvedFlow =>
  ({
    version: 2,
    name: 'x',
    nodes,
    connectors: [],
  }) as unknown as ResolvedFlow;

describe('inlineComponentSpecs', () => {
  it('attaches spec.json content as data.spec for component nodes', () => {
    const root = setupProject();
    const flow = baseFlow([baseComponentNode('n1')]);
    const { flow: out, errors, refs } = inlineComponentSpecs(flow, root);
    expect(errors).toEqual([]);
    const firstNode = out.nodes[0];
    if (!firstNode) throw new Error('unreachable');
    expect((firstNode.data as { spec: unknown }).spec).toEqual({
      root: 'r',
      state: { '/x': 1 },
      elements: { r: { type: 'Text', props: { text: 'hi' } } },
    });
    expect(refs).toEqual(['nodes/n1/spec.json']);
  });

  it('emits an error path when spec.json is missing', () => {
    const root = setupProject();
    const flow = baseFlow([baseComponentNode('missing')]);
    const { errors, refs } = inlineComponentSpecs(flow, root);
    expect(errors.length).toBe(1);
    const firstErr = errors[0];
    if (!firstErr) throw new Error('unreachable');
    expect(firstErr.path).toBe('nodes/missing/data/spec');
    expect(refs).toEqual([]);
  });

  it('emits an error when spec.json contains malformed JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'seeflow-spec-bad-'));
    mkdirSync(join(root, 'nodes', 'n1'), { recursive: true });
    writeFileSync(join(root, 'nodes', 'n1', 'spec.json'), '{ not valid json');
    const flow = baseFlow([baseComponentNode('n1')]);
    const { errors, refs } = inlineComponentSpecs(flow, root);
    expect(errors.length).toBe(1);
    const firstErr = errors[0];
    if (!firstErr) throw new Error('unreachable');
    expect(firstErr.path).toBe('nodes/n1/data/spec');
    expect(firstErr.message).toMatch(/Invalid JSON/);
    expect(refs).toEqual([]);
  });

  it('is a no-op on non-component nodes', () => {
    const root = setupProject();
    const flow = baseFlow([
      {
        id: 'g',
        type: 'rectangle',
        position: { x: 0, y: 0 },
        data: { name: 'r' },
      },
    ]);
    const { flow: out, errors, refs } = inlineComponentSpecs(flow, root);
    expect(errors).toEqual([]);
    expect(refs).toEqual([]);
    expect(out.nodes[0]).toEqual({
      id: 'g',
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: { name: 'r' },
    });
  });

  it('does not mutate the input flow object', () => {
    const root = setupProject();
    const original = baseComponentNode('n1');
    const flow = baseFlow([original]);
    const { flow: out } = inlineComponentSpecs(flow, root);
    expect(out).not.toBe(flow);
    expect(out.nodes[0]).not.toBe(original);
    expect((original.data as { spec: unknown }).spec).toEqual({
      root: 'placeholder',
      elements: {},
    });
  });
});

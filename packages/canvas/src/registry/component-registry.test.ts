import { describe, expect, test } from 'bun:test';
import { COMPONENT_NAMES } from '../catalog/component-catalog.ts';
import { componentRegistry } from './component-registry.tsx';

describe('componentRegistry', () => {
  test('exposes a components map', () => {
    expect(componentRegistry).toBeDefined();
    expect(typeof componentRegistry.components).toBe('object');
  });

  test('has an impl for every catalog name', () => {
    for (const name of COMPONENT_NAMES) {
      const impl = componentRegistry.components[name];
      if (impl === undefined) {
        throw new Error(`Missing registry impl for catalog name '${name}'`);
      }
      // React components are functions (function components) or objects
      // (forwardRef / lazy / memo). Any of those is acceptable here.
      const t = typeof impl;
      expect(t === 'function' || t === 'object').toBe(true);
    }
  });

  test('does not expose unknown names beyond the catalog', () => {
    const catalogSet = new Set<string>(COMPONENT_NAMES);
    const registryNames = Object.keys(componentRegistry.components);
    const stray = registryNames.filter((name) => !catalogSet.has(name));
    expect(stray).toEqual([]);
  });
});

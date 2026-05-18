import { describe, expect, it } from 'bun:test';
import { ICON_NAMES, ICON_REGISTRY } from './icon-registry.ts';

describe('ICON_REGISTRY', () => {
  it('exposes more than 1000 lucide icons', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(1000);
  });

  it("includes 'help-circle'", () => {
    expect(ICON_NAMES).toContain('help-circle');
    expect(ICON_REGISTRY['help-circle']).toBeDefined();
  });

  it("resolves 'shopping-cart' to a defined component", () => {
    const component = ICON_REGISTRY['shopping-cart'];
    expect(component).toBeDefined();
    // forwardRef components are objects with a $$typeof tag; functions are also
    // acceptable (some Lucide builds use plain function components).
    const typeOk = typeof component === 'function' || typeof component === 'object';
    expect(typeOk).toBe(true);
  });

  it('excludes non-icon lucide exports', () => {
    expect(ICON_NAMES).not.toContain('create-lucide-icon');
    expect(ICON_NAMES).not.toContain('icon');
    expect(ICON_NAMES).not.toContain('icons');
    expect(ICON_NAMES).not.toContain('default');
  });

  it('returns names sorted alphabetically', () => {
    const sorted = [...ICON_NAMES].sort();
    expect(ICON_NAMES).toEqual(sorted);
  });

  it("converts pascal-case to kebab-case (e.g. 'a-arrow-down')", () => {
    expect(ICON_NAMES).toContain('a-arrow-down');
  });
});

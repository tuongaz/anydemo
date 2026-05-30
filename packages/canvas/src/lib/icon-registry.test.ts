import { describe, expect, it } from 'bun:test';
import type { PackSummary } from '../adapter/types.ts';
import {
  ICON_NAMES,
  ICON_NAMES_BY_VENDOR,
  ICON_REGISTRY,
  applyPackSummaries,
} from './icon-registry.ts';

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

describe('ICON_NAMES_BY_VENDOR seeds', () => {
  it('mirrors the bundled lucide list and seeds iconify with curated brand logos', () => {
    expect(ICON_NAMES_BY_VENDOR.lucide).toBe(ICON_NAMES);
    expect(ICON_NAMES_BY_VENDOR.iconify).toContain('logos:aws');
    expect(ICON_NAMES_BY_VENDOR.iconify).toContain('logos:google-cloud');
    expect(ICON_NAMES_BY_VENDOR.iconify).toContain('logos:microsoft-azure');
  });
});

describe('applyPackSummaries', () => {
  it('populates aws/azure entries from installed pack icon names', () => {
    const packs: PackSummary[] = [
      {
        vendor: 'aws',
        installed: true,
        version: '2026-05-30',
        iconCount: 2,
        sizeBytes: 100,
        iconNames: ['lambda', 's3'],
      },
      {
        vendor: 'azure',
        installed: true,
        version: '2026-05-30',
        iconCount: 1,
        sizeBytes: 50,
        iconNames: ['functions'],
      },
    ];

    applyPackSummaries(packs);

    expect(ICON_NAMES_BY_VENDOR.aws).toEqual(['lambda', 's3']);
    expect(ICON_NAMES_BY_VENDOR.azure).toEqual(['functions']);
  });

  it('leaves lucide and iconify untouched when applying pack summaries', () => {
    const lucideBefore = ICON_NAMES_BY_VENDOR.lucide;
    const iconifyBefore = [...ICON_NAMES_BY_VENDOR.iconify];
    applyPackSummaries([
      {
        vendor: 'aws',
        installed: true,
        version: 'v',
        iconCount: 1,
        sizeBytes: 1,
        iconNames: ['lambda'],
      },
    ]);
    expect(ICON_NAMES_BY_VENDOR.lucide).toBe(lucideBefore);
    expect(ICON_NAMES_BY_VENDOR.iconify).toEqual(iconifyBefore);
  });

  it('replaces a previously-installed entry on the next summary', () => {
    applyPackSummaries([
      {
        vendor: 'aws',
        installed: true,
        version: 'v1',
        iconCount: 1,
        sizeBytes: 1,
        iconNames: ['lambda'],
      },
    ]);
    expect(ICON_NAMES_BY_VENDOR.aws).toEqual(['lambda']);

    applyPackSummaries([
      {
        vendor: 'aws',
        installed: true,
        version: 'v2',
        iconCount: 2,
        sizeBytes: 2,
        iconNames: ['ec2', 's3'],
      },
    ]);
    expect(ICON_NAMES_BY_VENDOR.aws).toEqual(['ec2', 's3']);

    applyPackSummaries([{ vendor: 'aws', installed: false }]);
    expect(ICON_NAMES_BY_VENDOR.aws).toEqual([]);
  });

  it('is a no-op on an empty input', () => {
    const lucideBefore = ICON_NAMES_BY_VENDOR.lucide;
    const iconifyBefore = [...ICON_NAMES_BY_VENDOR.iconify];
    applyPackSummaries([]);
    expect(ICON_NAMES_BY_VENDOR.lucide).toBe(lucideBefore);
    expect(ICON_NAMES_BY_VENDOR.iconify).toEqual(iconifyBefore);
  });
});

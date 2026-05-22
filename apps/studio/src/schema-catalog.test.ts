import { describe, expect, it } from 'bun:test';
import { getSchemaCategory, listSchemaCategories, schemaCategoryNames } from './schema-catalog.ts';

// Strict accessor that fails the test loudly if a category is unknown — beats
// scattering `!` non-null assertions across every it() body.
const loadCategory = (name: string) => {
  const payload = getSchemaCategory(name);
  if (!payload) throw new Error(`expected ${name} category to exist`);
  return payload;
};

describe('schema-catalog', () => {
  describe('listSchemaCategories', () => {
    it('returns the five canonical categories with descriptions', () => {
      const cats = listSchemaCategories();
      expect(cats.map((c) => c.name)).toEqual(['flow', 'node', 'connector', 'action', 'style']);
      for (const c of cats) {
        expect(c.description.length).toBeGreaterThan(0);
      }
    });

    it('returns a fresh array on each call (caller-mutation safe)', () => {
      const a = listSchemaCategories();
      const b = listSchemaCategories();
      expect(a).not.toBe(b);
      const first = a[0];
      if (!first) throw new Error('expected at least one category');
      first.name = 'mutated';
      const reloaded = listSchemaCategories()[0];
      expect(reloaded?.name).toBe('flow');
    });
  });

  describe('getSchemaCategory', () => {
    it('returns null for unknown categories', () => {
      expect(getSchemaCategory('bogus')).toBeNull();
      expect(getSchemaCategory('')).toBeNull();
    });

    it('flow → envelope schema plus connector-ref note', () => {
      const payload = loadCategory('flow');
      const schema = payload.schemas.flow as Record<string, unknown>;
      expect(schema.type).toBe('object');
      const props = schema.properties as Record<string, unknown>;
      expect(props.version).toBeDefined();
      expect(props.name).toBeDefined();
      expect(props.nodes).toBeDefined();
      expect(props.connectors).toBeDefined();
      // Envelope: nodes/connectors are placeholders, not the full per-variant
      // discriminated unions. The placeholder items should carry a description
      // that points the reader at the dedicated category.
      const nodesProp = props.nodes as { items?: Record<string, unknown> };
      expect(nodesProp.items?.description).toMatch(/schema node/i);
      expect(payload.notes.length).toBeGreaterThan(0);
      expect(payload.notes[0]).toMatch(/source.*target.*nodes\[\]\.id/);
    });

    it('node → all six variants', () => {
      const payload = loadCategory('node');
      const keys = Object.keys(payload.schemas).sort();
      expect(keys).toEqual(
        ['htmlNode', 'iconNode', 'imageNode', 'playNode', 'shapeNode', 'stateNode'].sort(),
      );
      for (const variantName of Object.keys(payload.schemas)) {
        const schema = payload.schemas[variantName] as Record<string, unknown>;
        expect(schema.type).toBe('object');
        const props = schema.properties as Record<string, unknown>;
        expect(props.id).toBeDefined();
        expect(props.type).toBeDefined();
        expect(props.data).toBeDefined();
      }
      // imageNode path prefix note must surface.
      expect(payload.notes.some((n) => /imageNode.*path.*nodes/.test(n))).toBe(true);
    });

    it('connector → single shape', () => {
      const payload = loadCategory('connector');
      const keys = Object.keys(payload.schemas);
      expect(keys).toEqual(['connector']);
      expect(payload.notes).toEqual([]);
    });

    it('action → playAction, statusAction, resetAction, statusReport', () => {
      const payload = loadCategory('action');
      const keys = Object.keys(payload.schemas).sort();
      expect(keys).toEqual(['playAction', 'resetAction', 'statusAction', 'statusReport'].sort());
      expect(payload.notes.some((n) => /scriptPath/.test(n))).toBe(true);
    });

    it('style → studio-owned envelope', () => {
      const payload = loadCategory('style');
      expect(Object.keys(payload.schemas)).toEqual(['style']);
      expect(payload.notes).toEqual([]);
    });

    it('mutating the returned payload does not affect later reads', () => {
      const first = loadCategory('node');
      first.notes.push('tampered');
      first.schemas.playNode = { tampered: true };
      const second = loadCategory('node');
      expect(second.notes.some((n) => n === 'tampered')).toBe(false);
      expect((second.schemas.playNode as { type?: string })?.type).toBe('object');
    });
  });

  describe('schemaCategoryNames', () => {
    it('matches listSchemaCategories', () => {
      expect(schemaCategoryNames()).toEqual(listSchemaCategories().map((c) => c.name));
    });
  });
});

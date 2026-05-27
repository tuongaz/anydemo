import { describe, expect, it } from 'bun:test';
import {
  getCategorySubschema,
  getSchemaCategory,
  listCategorySubnames,
  listSchemaCategories,
  schemaCategoryNames,
} from './schema-catalog.ts';

// Strict accessor that fails the test loudly if a category is unknown — beats
// scattering `!` non-null assertions across every it() body.
const loadCategory = (name: string) => {
  const payload = getSchemaCategory(name);
  if (!payload) throw new Error(`expected ${name} category to exist`);
  return payload;
};

describe('schema-catalog', () => {
  describe('listSchemaCategories', () => {
    it('returns the six canonical categories with descriptions', () => {
      const cats = listSchemaCategories();
      expect(cats.map((c) => c.name)).toEqual([
        'flow',
        'node',
        'connector',
        'action',
        'componentSpec',
        'style',
      ]);
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

    it('node → all 13 flat variants', () => {
      const payload = loadCategory('node');
      const keys = Object.keys(payload.schemas).sort();
      // Flat-types refactor: schema-catalog returns one schema per
      // FlowNodeSchema variant — 9 geometric tags + image + html + icon +
      // component.
      expect(keys).toEqual(
        [
          'cloud',
          'component',
          'database',
          'ellipse',
          'html',
          'icon',
          'image',
          'queue',
          'rectangle',
          'server',
          'sticky',
          'text',
          'user',
        ].sort(),
      );
      for (const variantName of Object.keys(payload.schemas)) {
        const schema = payload.schemas[variantName] as Record<string, unknown>;
        expect(schema.type).toBe('object');
        const props = schema.properties as Record<string, unknown>;
        expect(props.id).toBeDefined();
        expect(props.type).toBeDefined();
        expect(props.data).toBeDefined();
      }
      // image path prefix note must surface.
      expect(payload.notes.some((n) => /image.*path.*nodes/.test(n))).toBe(true);
      // component spec-sidecar note must surface so authors find spec.json.
      expect(payload.notes.some((n) => /component.*spec\.json/i.test(n))).toBe(true);
      // stateSource guidance notes must surface so AI authors know when/how to set it.
      expect(payload.notes.some((n) => /stateSource.*statusAction/.test(n))).toBe(true);
      // Every node variant must carry a description on data.stateSource so the
      // JSON Schema teaches the AI how to use the field at the call site.
      for (const variantName of Object.keys(payload.schemas)) {
        const schema = payload.schemas[variantName] as Record<string, unknown>;
        const props = (schema.properties as Record<string, unknown>) ?? {};
        const data = props.data as { properties?: Record<string, unknown> } | undefined;
        const stateSource = data?.properties?.stateSource as
          | { description?: string; anyOf?: Array<{ description?: string }> }
          | undefined;
        expect(stateSource).toBeDefined();
        expect(stateSource?.description?.length ?? 0).toBeGreaterThan(0);
        const anyOf = stateSource?.anyOf ?? [];
        expect(anyOf.length).toBe(2);
        for (const member of anyOf) {
          expect(member.description?.length ?? 0).toBeGreaterThan(0);
        }
      }
    });

    it('connector → single shape', () => {
      const payload = loadCategory('connector');
      const keys = Object.keys(payload.schemas);
      expect(keys).toEqual(['connector']);
      expect(payload.notes).toEqual([]);
    });

    it('action → playAction, statusAction, statusReport, componentAction', () => {
      const payload = loadCategory('action');
      const keys = Object.keys(payload.schemas).sort();
      expect(keys).toEqual(
        ['playAction', 'statusAction', 'statusReport', 'componentAction'].sort(),
      );
      expect(payload.notes.some((n) => /scriptPath/.test(n))).toBe(true);
      // componentAction discriminator note must surface so authors know set vs script.
      expect(payload.notes.some((n) => /componentAction/.test(n))).toBe(true);
    });

    it('componentSpec → spec.json shape + element shape', () => {
      const payload = loadCategory('componentSpec');
      const keys = Object.keys(payload.schemas).sort();
      expect(keys).toEqual(['componentSpec', 'componentSpecElement'].sort());
      const spec = payload.schemas.componentSpec as Record<string, unknown>;
      expect(spec.type).toBe('object');
      const props = spec.properties as Record<string, unknown>;
      expect(props.root).toBeDefined();
      expect(props.elements).toBeDefined();
      // sidecar invariant note must surface.
      expect(payload.notes.some((n) => /spec\.json/.test(n))).toBe(true);
    });

    it('style → studio-owned envelope', () => {
      const payload = loadCategory('style');
      expect(Object.keys(payload.schemas)).toEqual(['style']);
      expect(payload.notes).toEqual([]);
    });

    it('mutating the returned payload does not affect later reads', () => {
      const first = loadCategory('node');
      first.notes.push('tampered');
      first.schemas.rectangle = { tampered: true };
      const second = loadCategory('node');
      expect(second.notes.some((n) => n === 'tampered')).toBe(false);
      expect((second.schemas.rectangle as { type?: string })?.type).toBe('object');
    });
  });

  describe('schemaCategoryNames', () => {
    it('matches listSchemaCategories', () => {
      expect(schemaCategoryNames()).toEqual(listSchemaCategories().map((c) => c.name));
    });
  });

  describe('getCategorySubschema', () => {
    it('returns just the requested variant under schemas, keyed by subname', () => {
      const payload = getCategorySubschema('node', 'rectangle');
      if (!payload) throw new Error('expected node.rectangle');
      expect(Object.keys(payload.schemas)).toEqual(['rectangle']);
      const schema = payload.schemas.rectangle as Record<string, unknown>;
      expect(schema.type).toBe('object');
    });

    it('preserves the category-level notes verbatim (cross-variant invariants still apply)', () => {
      const category = getSchemaCategory('node');
      const single = getCategorySubschema('node', 'image');
      if (!category || !single) throw new Error('expected node + image');
      expect(single.notes).toEqual(category.notes);
    });

    it('works for every multi-schema category (action subname, componentSpec subname)', () => {
      const action = getCategorySubschema('action', 'playAction');
      if (!action) throw new Error('expected action.playAction');
      expect(Object.keys(action.schemas)).toEqual(['playAction']);
      const spec = getCategorySubschema('componentSpec', 'componentSpecElement');
      if (!spec) throw new Error('expected componentSpec.componentSpecElement');
      expect(Object.keys(spec.schemas)).toEqual(['componentSpecElement']);
    });

    it('returns null when the category is unknown', () => {
      expect(getCategorySubschema('bogus', 'rectangle')).toBeNull();
      expect(getCategorySubschema('', 'rectangle')).toBeNull();
    });

    it('returns null when the subname is unknown within a known category', () => {
      expect(getCategorySubschema('node', 'bogus')).toBeNull();
      expect(getCategorySubschema('node', '')).toBeNull();
    });

    it('returns a fresh payload (caller-mutation safe)', () => {
      const first = getCategorySubschema('node', 'rectangle');
      if (!first) throw new Error('expected node.rectangle');
      first.notes.push('tampered');
      first.schemas.rectangle = { tampered: true };
      const second = getCategorySubschema('node', 'rectangle');
      if (!second) throw new Error('expected node.rectangle (refetch)');
      expect(second.notes.some((n) => n === 'tampered')).toBe(false);
      expect((second.schemas.rectangle as { type?: string })?.type).toBe('object');
    });
  });

  describe('listCategorySubnames', () => {
    it('lists every variant for the node category', () => {
      const subnames = listCategorySubnames('node');
      expect(subnames).not.toBeNull();
      expect(subnames?.sort()).toEqual(
        [
          'cloud',
          'component',
          'database',
          'ellipse',
          'html',
          'icon',
          'image',
          'queue',
          'rectangle',
          'server',
          'sticky',
          'text',
          'user',
        ].sort(),
      );
    });

    it('returns the singleton key for single-schema categories', () => {
      expect(listCategorySubnames('flow')).toEqual(['flow']);
      expect(listCategorySubnames('connector')).toEqual(['connector']);
      expect(listCategorySubnames('style')).toEqual(['style']);
    });

    it('returns null for unknown categories', () => {
      expect(listCategorySubnames('bogus')).toBeNull();
      expect(listCategorySubnames('')).toBeNull();
    });
  });

  // Description discipline — every AI-facing field on a node variant's `data`
  // object must carry a `.describe()` string in schema.ts. The smoking gun
  // this was written to prevent: `stateSource` shipping without one, leaving
  // the model unable to set it. Keep the opt-out set small.
  describe('description discipline', () => {
    // Mechanical / structurally-self-explanatory fields. Adding to this set
    // is a deliberate decision — prefer adding a `.describe()` in schema.ts.
    const DESCRIPTION_OPT_OUT = new Set<string>([]);

    it('every data.* property on every node variant has a non-empty description', () => {
      const node = loadCategory('node');
      const offenders: string[] = [];
      for (const [variant, raw] of Object.entries(node.schemas)) {
        const schema = raw as { properties?: { data?: { properties?: Record<string, unknown> } } };
        const dataProps = schema.properties?.data?.properties;
        if (!dataProps) {
          offenders.push(`${variant}: missing data.properties on emitted JSON schema`);
          continue;
        }
        for (const [field, value] of Object.entries(dataProps)) {
          if (DESCRIPTION_OPT_OUT.has(field)) continue;
          const description = (value as { description?: string }).description;
          if (typeof description !== 'string' || description.trim().length === 0) {
            offenders.push(`${variant}.data.${field}`);
          }
        }
      }
      if (offenders.length > 0) {
        const list = offenders.join('\n  - ');
        throw new Error(
          `Missing description on:\n  - ${list}\n\nAdd a \`.describe(...)\` call to the matching field in apps/studio/src/schema.ts, or — for genuinely mechanical fields — add it to DESCRIPTION_OPT_OUT in this test.`,
        );
      }
    });
  });
});

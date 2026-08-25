import { describe, expect, it } from 'bun:test';
import { COMPONENT_NAMES } from '@seeflow/canvas/catalog';
import {
  SCHEMA_INDEX_USAGE,
  buildIndexJqHints,
  buildJqHints,
  getCategorySubschema,
  getDataFieldNames,
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
    it('returns the seven canonical categories with descriptions', () => {
      const cats = listSchemaCategories();
      expect(cats.map((c) => c.name)).toEqual([
        'flow',
        'node',
        'connector',
        'action',
        'componentSpec',
        'componentCatalog',
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

    it('inlines subnames on every category so callers can drill in without a second lookup', () => {
      const cats = listSchemaCategories();
      const byName = Object.fromEntries(cats.map((c) => [c.name, c]));
      expect(byName.flow?.subnames).toEqual(['flow']);
      expect(byName.connector?.subnames).toEqual(['connector']);
      expect(byName.style?.subnames).toEqual(['style']);
      expect(byName.node?.subnames?.sort()).toEqual(
        [
          'cloud',
          'component',
          'database',
          'diamond',
          'document',
          'ellipse',
          'hexagon',
          'html',
          'icon',
          'image',
          'linkflow',
          'parallelogram',
          'queue',
          'rectangle',
          'server',
          'sticky',
          'text',
          'triangle',
          'user',
        ].sort(),
      );
      expect(byName.action?.subnames?.sort()).toEqual(['componentAction'].sort());
      expect(byName.componentSpec?.subnames?.sort()).toEqual(
        ['componentSpec', 'componentSpecElement'].sort(),
      );
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

    it('node → all 19 flat variants', () => {
      const payload = loadCategory('node');
      const keys = Object.keys(payload.schemas).sort();
      // Flat-types refactor: schema-catalog returns one schema per
      // FlowNodeSchema variant — 14 geometric tags + image + html + icon +
      // component + linkflow.
      expect(keys).toEqual(
        [
          'cloud',
          'component',
          'database',
          'diamond',
          'document',
          'ellipse',
          'hexagon',
          'html',
          'icon',
          'image',
          'linkflow',
          'parallelogram',
          'queue',
          'rectangle',
          'server',
          'sticky',
          'text',
          'triangle',
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
    });

    it('connector → single shape', () => {
      const payload = loadCategory('connector');
      const keys = Object.keys(payload.schemas);
      expect(keys).toEqual(['connector']);
      expect(payload.notes).toEqual([]);
    });

    it('action → componentAction', () => {
      const payload = loadCategory('action');
      const keys = Object.keys(payload.schemas).sort();
      expect(keys).toEqual(['componentAction'].sort());
      // componentAction note must surface so authors know the set-mutation shape.
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

    it('componentCatalog → one props schema per catalog component', () => {
      const payload = loadCategory('componentCatalog');
      // Every COMPONENT_NAMES entry must be resolvable as a subname — this is
      // the catalog the agent could not previously see through `seeflow schema`.
      expect(Object.keys(payload.schemas).sort()).toEqual([...COMPONENT_NAMES].sort());
      for (const name of COMPONENT_NAMES) {
        const schema = payload.schemas[name] as Record<string, unknown>;
        expect(schema.type).toBe('object');
      }
      // The ref-shape note must surface so authors know $state/$action are legal.
      expect(payload.notes.some((n) => /\$state.*\$action|\$action.*\$state/.test(n))).toBe(true);
    });

    it('componentCatalog drills into a single component (Chart) with its props', () => {
      const single = getCategorySubschema('componentCatalog', 'Chart');
      if (!single) throw new Error('expected componentCatalog.Chart');
      expect(Object.keys(single.schemas)).toEqual(['Chart']);
      const chart = single.schemas.Chart as { properties?: Record<string, unknown> };
      expect(chart.properties?.kind).toBeDefined();
      expect(chart.properties?.data).toBeDefined();
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
      const action = getCategorySubschema('action', 'componentAction');
      if (!action) throw new Error('expected action.componentAction');
      expect(Object.keys(action.schemas)).toEqual(['componentAction']);
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
          'diamond',
          'document',
          'ellipse',
          'hexagon',
          'html',
          'icon',
          'image',
          'linkflow',
          'parallelogram',
          'queue',
          'rectangle',
          'server',
          'sticky',
          'text',
          'triangle',
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

  describe('getDataFieldNames', () => {
    it('lists every data.* key for a node variant (rectangle)', () => {
      const fields = getDataFieldNames('node', 'rectangle');
      expect(fields).not.toBeNull();
      // Rectangle is the kitchen-sink variant — must surface the descriptive
      // header fields the planner sets.
      expect(fields).toEqual(expect.arrayContaining(['name', 'detail', 'icon']));
    });

    it('returns null for shapes / categories with no data.properties wrapper', () => {
      // Action schemas are top-level — no data wrapper.
      expect(getDataFieldNames('action', 'componentAction')).toBeNull();
      // Bogus subname / category.
      expect(getDataFieldNames('node', 'bogus')).toBeNull();
      expect(getDataFieldNames('bogus', 'rectangle')).toBeNull();
    });
  });

  describe('buildJqHints', () => {
    it('category-level hints include sample drill paths + a tip that names the subnames', () => {
      const hints = buildJqHints('node');
      expect(hints).not.toBeNull();
      if (!hints) return;
      expect(hints.examples).toEqual(
        expect.arrayContaining(['.schemas', '.schemas[]', '.notes[]']),
      );
      // Tip should mention at least one concrete subname so the agent can paste it.
      expect(hints.tip).toMatch(/rectangle/);
      // No dataFields at the category level — that's a per-variant detail.
      expect(hints.dataFields).toBeUndefined();
      // rootPath at the category level reaches the schema body.
      expect(hints.rootPath).toBe('.schemas');
      // Tip warns against the presentational `.result` wrapper.
      expect(hints.tip).toMatch(/never prefix your filter with `\.result`/);
    });

    it('per-subname hints expose dataFields + ready-to-paste paths for each data field', () => {
      const hints = buildJqHints('node', 'rectangle');
      expect(hints).not.toBeNull();
      if (!hints) return;
      // dataFields must surface the per-shape data.* keys so the agent can target one.
      expect(hints.dataFields).toEqual(expect.arrayContaining(['name', 'detail', 'icon']));
      // Every example path under data.properties must be addressable by .schemas.rectangle.
      for (const example of hints.examples) {
        if (example.startsWith('.schemas.')) {
          expect(example.startsWith('.schemas.rectangle')).toBe(true);
        }
      }
      // At least one example must point at a real data.<field> so agents see the pattern.
      expect(
        hints.examples.some((e) => /\.schemas\.rectangle\.properties\.data\.properties\./.test(e)),
      ).toBe(true);
      // Tip should reference dataFields for affordance.
      expect(hints.tip).toMatch(/dataFields/i);
      // rootPath reaches the single variant body.
      expect(hints.rootPath).toBe('.schemas.rectangle');
    });

    it('componentCatalog subname hints root at .schemas.<Name>', () => {
      const hints = buildJqHints('componentCatalog', 'Chart');
      if (!hints) throw new Error('expected componentCatalog.Chart hints');
      expect(hints.rootPath).toBe('.schemas.Chart');
      // Catalog props have no data.* wrapper, so no dataFields.
      expect(hints.dataFields).toBeUndefined();
      expect(hints.examples).toEqual(
        expect.arrayContaining(['.schemas.Chart', '.schemas.Chart.required']),
      );
    });

    it('per-subname hints on action variants (no data wrapper) skip dataFields gracefully', () => {
      const hints = buildJqHints('action', 'componentAction');
      expect(hints).not.toBeNull();
      if (!hints) return;
      expect(hints.dataFields).toBeUndefined();
      // Examples still point at the variant.
      expect(hints.examples).toEqual(
        expect.arrayContaining(['.schemas.componentAction', '.schemas.componentAction.required']),
      );
    });

    it('returns null for unknown category / subname so callers can fall through to error paths', () => {
      expect(buildJqHints('bogus')).toBeNull();
      expect(buildJqHints('node', 'bogus')).toBeNull();
    });
  });

  describe('buildIndexJqHints', () => {
    it('roots the index at .categories and warns about the .result wrapper', () => {
      const hints = buildIndexJqHints();
      expect(hints.rootPath).toBe('.categories');
      expect(hints.examples).toEqual(expect.arrayContaining(['.categories', '.categories[].name']));
      expect(hints.tip).toMatch(/never prefix your filter with `\.result`/);
    });
  });

  describe('SCHEMA_INDEX_USAGE', () => {
    it('carries copy-paste examples for the progressive workflow', () => {
      // The agent sees this block on `seeflow schema` and on GET /api/schema —
      // it must teach drill (with subname) + filter (with --jq) inline.
      expect(SCHEMA_INDEX_USAGE.drill).toMatch(/schema <category>/);
      expect(SCHEMA_INDEX_USAGE.filter).toMatch(/--jq/);
      expect(SCHEMA_INDEX_USAGE.examples.some((e) => e.includes('seeflow schema node'))).toBe(true);
      expect(SCHEMA_INDEX_USAGE.examples.some((e) => e.includes('--jq'))).toBe(true);
    });
  });

  // Description discipline — every AI-facing field on a node variant's `data`
  // object must carry a `.describe()` string in schema.ts, so the model knows
  // how to set it. Keep the opt-out set small.
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

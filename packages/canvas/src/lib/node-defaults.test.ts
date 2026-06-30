import { describe, expect, it } from 'bun:test';
import {
  NEW_GROUP_NAME,
  NEW_NODE_BORDER_WIDTH,
  NEW_NODE_FONT_SIZE,
  buildNewGroupData,
  buildNewImageData,
  buildNewShapeData,
  buildNewTableData,
} from './node-defaults.ts';
import { TABLE_DEFAULT_COLS, TABLE_DEFAULT_ROWS } from './table-ops.ts';

describe('buildNewShapeData', () => {
  it('rectangle gets borderSize=1 and fontSize=12 (flat schema: no data.shape)', () => {
    const data = buildNewShapeData('rectangle', { width: 200, height: 120 });
    // Under the flat schema `type` IS the shape — buildNewShapeData no longer
    // emits a `data.shape` field (the strict on-disk FlowSchema would reject
    // it as an unknown key).
    expect('shape' in data).toBe(false);
    expect(data.width).toBe(200);
    expect(data.height).toBe(120);
    expect(data.borderSize).toBe(NEW_NODE_BORDER_WIDTH);
    expect(data.fontSize).toBe(NEW_NODE_FONT_SIZE);
  });

  it('ellipse gets the default borderSize + fontSize', () => {
    const data = buildNewShapeData('ellipse', { width: 160, height: 100 });
    expect(data.borderSize).toBe(NEW_NODE_BORDER_WIDTH);
    expect(data.fontSize).toBe(NEW_NODE_FONT_SIZE);
  });

  it('sticky gets the default borderSize + fontSize', () => {
    const data = buildNewShapeData('sticky', { width: 180, height: 180 });
    expect(data.borderSize).toBe(NEW_NODE_BORDER_WIDTH);
    expect(data.fontSize).toBe(NEW_NODE_FONT_SIZE);
  });

  it('text variant gets the default fontSize but NO borderSize (text stays chromeless)', () => {
    const data = buildNewShapeData('text', { width: 120, height: 36 });
    expect('shape' in data).toBe(false);
    expect(data.fontSize).toBe(NEW_NODE_FONT_SIZE);
    expect(data.borderSize).toBeUndefined();
    expect('borderSize' in data).toBe(false);
  });

  it('preserves the requested dims regardless of variant', () => {
    const a = buildNewShapeData('rectangle', { width: 5, height: 7 });
    const b = buildNewShapeData('text', { width: 11, height: 13 });
    expect(a.width).toBe(5);
    expect(a.height).toBe(7);
    expect(b.width).toBe(11);
    expect(b.height).toBe(13);
  });
});

describe('buildNewImageData', () => {
  it('image gets borderWidth=1 (NOT borderSize) and no fontSize', () => {
    const data = buildNewImageData('assets/hello.png', { width: 200, height: 150 });
    expect(data.path).toBe('assets/hello.png');
    expect(data.width).toBe(200);
    expect(data.height).toBe(150);
    expect(data.borderWidth).toBe(NEW_NODE_BORDER_WIDTH);
    // image renders no body text — fontSize is intentionally absent.
    expect('fontSize' in data).toBe(false);
    // confirm we used the group/image naming, not the shape spelling.
    expect('borderSize' in data).toBe(false);
    // US-004: on-disk field is `path`, not `image` (base64 hard-cut).
    expect('image' in data).toBe(false);
  });
});

describe('constants', () => {
  it('NEW_NODE_BORDER_WIDTH = 1', () => {
    expect(NEW_NODE_BORDER_WIDTH).toBe(1);
  });

  it('NEW_NODE_FONT_SIZE = 17', () => {
    expect(NEW_NODE_FONT_SIZE).toBe(17);
  });
});

describe('buildNewShapeData with lastUsed', () => {
  it('an empty lastUsed reproduces the factory defaults exactly', () => {
    const baseline = buildNewShapeData('rectangle', { width: 200, height: 120 });
    const overlaid = buildNewShapeData('rectangle', { width: 200, height: 120 }, {});
    expect(overlaid).toEqual(baseline);
  });

  it('rectangle consumes borderColor / backgroundColor / borderStyle / cornerRadius / fontSize / borderSize', () => {
    const data = buildNewShapeData(
      'rectangle',
      { width: 200, height: 120 },
      {
        borderColor: 'blue',
        backgroundColor: 'amber',
        borderSize: 5,
        borderStyle: 'dashed',
        fontSize: 22,
        cornerRadius: 8,
      },
    );
    expect(data.borderColor).toBe('blue');
    expect(data.backgroundColor).toBe('amber');
    expect(data.borderSize).toBe(5);
    expect(data.borderStyle).toBe('dashed');
    expect(data.fontSize).toBe(22);
    expect(data.cornerRadius).toBe(8);
  });

  it('sticky also consumes cornerRadius', () => {
    const data = buildNewShapeData(
      'sticky',
      { width: 180, height: 180 },
      { cornerRadius: 12, borderColor: 'green' },
    );
    expect(data.cornerRadius).toBe(12);
    expect(data.borderColor).toBe('green');
  });

  it('ellipse drops cornerRadius (kind-specific filter)', () => {
    const data = buildNewShapeData(
      'ellipse',
      { width: 160, height: 100 },
      { cornerRadius: 12, borderColor: 'violet' },
    );
    expect(data.borderColor).toBe('violet');
    expect('cornerRadius' in data).toBe(false);
  });

  it('rectangle, ellipse, and sticky inherit shadow from lastUsed', () => {
    const rect = buildNewShapeData('rectangle', { width: 200, height: 120 }, { shadow: 3 });
    const ell = buildNewShapeData('ellipse', { width: 160, height: 100 }, { shadow: 4 });
    const sticky = buildNewShapeData('sticky', { width: 180, height: 180 }, { shadow: 2 });
    expect(rect.shadow).toBe(3);
    expect(ell.shadow).toBe(4);
    expect(sticky.shadow).toBe(2);
  });

  it('text drops shadow alongside other chrome fields (stays chromeless)', () => {
    const data = buildNewShapeData('text', { width: 120, height: 36 }, { fontSize: 22, shadow: 3 });
    expect(data.fontSize).toBe(22);
    expect('shadow' in data).toBe(false);
  });

  it('text stays chromeless: only fontSize carries over, borderSize is dropped', () => {
    const data = buildNewShapeData(
      'text',
      { width: 120, height: 36 },
      { fontSize: 28, borderSize: 9, borderColor: 'red', backgroundColor: 'amber' },
    );
    expect(data.fontSize).toBe(28);
    expect('borderSize' in data).toBe(false);
    expect('borderColor' in data).toBe(false);
    expect('backgroundColor' in data).toBe(false);
  });

  it('connector-only fields never leak in (e.g. direction)', () => {
    const data = buildNewShapeData(
      'rectangle',
      { width: 200, height: 120 },
      // Cast: a NodeStylePatch shouldn't carry this field at the type level,
      // but `getLastUsedStyle().node` is `Partial<NodeStylePatch>` derived from
      // localStorage so we defensively pick only known keys.
      { borderColor: 'blue', direction: 'forward' } as unknown as Parameters<
        typeof buildNewShapeData
      >[2],
    );
    expect(data.borderColor).toBe('blue');
    expect('direction' in data).toBe(false);
  });
});

describe('buildNewImageData with lastUsed', () => {
  it('an empty lastUsed reproduces the factory defaults exactly', () => {
    const baseline = buildNewImageData('a/b.png', { width: 200, height: 150 });
    const overlaid = buildNewImageData('a/b.png', { width: 200, height: 150 }, {});
    expect(overlaid).toEqual(baseline);
  });

  it('consumes borderColor, borderWidth, borderStyle', () => {
    const data = buildNewImageData(
      'a/b.png',
      { width: 200, height: 150 },
      { borderColor: 'blue', borderWidth: 5, borderStyle: 'dashed' },
    );
    expect(data.borderColor).toBe('blue');
    expect(data.borderWidth).toBe(5);
    expect(data.borderStyle).toBe('dashed');
  });

  it('inherits shadow from lastUsed', () => {
    const data = buildNewImageData('a/b.png', { width: 200, height: 150 }, { shadow: 3 });
    expect((data as { shadow?: number }).shadow).toBe(3);
  });

  it('drops shape-only fields like fontSize and cornerRadius', () => {
    const data = buildNewImageData(
      'a/b.png',
      { width: 200, height: 150 },
      { fontSize: 22, cornerRadius: 8, borderColor: 'green' },
    );
    expect(data.borderColor).toBe('green');
    expect('fontSize' in data).toBe(false);
    expect('cornerRadius' in data).toBe(false);
  });

  it('does NOT read borderSize (image uses borderWidth)', () => {
    // borderSize is mirrored to borderWidth at the remember boundary, so a
    // realistic lastUsed bucket carries both. Confirm the builder honors the
    // image-native key (`borderWidth`) and ignores any stray `borderSize`.
    const data = buildNewImageData(
      'a/b.png',
      { width: 200, height: 150 },
      { borderSize: 9, borderWidth: 4 },
    );
    expect(data.borderWidth).toBe(4);
    expect('borderSize' in data).toBe(false);
  });
});

describe('buildNewGroupData', () => {
  it('builds a titled container carrying childIds + dims + default border', () => {
    const data = buildNewGroupData(['a', 'b'], { width: 320, height: 220 });
    expect(data.childIds).toEqual(['a', 'b']);
    expect(data.name).toBe(NEW_GROUP_NAME);
    expect(data.width).toBe(320);
    expect(data.height).toBe(220);
    expect(data.borderSize).toBe(NEW_NODE_BORDER_WIDTH);
  });

  it('allows an empty member list (labeled zone)', () => {
    const data = buildNewGroupData([], { width: 200, height: 120 });
    expect(data.childIds).toEqual([]);
    expect(data.name).toBe(NEW_GROUP_NAME);
  });

  it('does not mutate the passed childIds reference into shared state', () => {
    const ids = ['x'];
    const a = buildNewGroupData(ids, { width: 100, height: 100 });
    const b = buildNewGroupData(['y'], { width: 100, height: 100 });
    expect(a.childIds).toEqual(['x']);
    expect(b.childIds).toEqual(['y']);
  });
});

describe('buildNewTableData', () => {
  it('seeds a default grid of unique column/row ids with no cells', () => {
    const data = buildNewTableData();
    expect(data.columns).toHaveLength(TABLE_DEFAULT_COLS);
    expect(data.rows).toHaveLength(TABLE_DEFAULT_ROWS);
    expect(data.cells).toEqual({});
    expect(data.headerRow).toBe(true);
    const colIds = data.columns.map((c) => c.id);
    const rowIds = data.rows.map((r) => r.id);
    expect(new Set(colIds).size).toBe(colIds.length); // unique
    expect(new Set(rowIds).size).toBe(rowIds.length);
    // column/row ids never collide (distinct prefixes keep cell keys unambiguous)
    expect(colIds.some((id) => rowIds.includes(id))).toBe(false);
  });

  it('overlays last-used border style but never seeds a derived width/height', () => {
    const data = buildNewTableData({ borderColor: 'blue' });
    expect(data.borderColor).toBe('blue');
    // size is derived from columns/rows (deriveTableSize), never stored
    expect('width' in data).toBe(false);
    expect('height' in data).toBe(false);
  });
});

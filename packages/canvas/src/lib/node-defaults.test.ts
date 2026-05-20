import { describe, expect, it } from 'bun:test';
import {
  NEW_NODE_BORDER_WIDTH,
  NEW_NODE_FONT_SIZE,
  buildNewImageData,
  buildNewShapeData,
} from './node-defaults.ts';

describe('buildNewShapeData', () => {
  it('rectangle gets borderSize=1 and fontSize=12', () => {
    const data = buildNewShapeData('rectangle', { width: 200, height: 120 });
    expect(data.shape).toBe('rectangle');
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
    expect(data.shape).toBe('text');
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
      { cornerRadius: 12, borderColor: 'purple' },
    );
    expect(data.borderColor).toBe('purple');
    expect('cornerRadius' in data).toBe(false);
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

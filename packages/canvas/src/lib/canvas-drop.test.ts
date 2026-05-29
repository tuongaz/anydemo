import { describe, expect, it } from 'bun:test';
import {
  type CanvasDropDispatchArgs,
  IMAGE_DROP_EXTS,
  IMAGE_DROP_MAX_LONGEST_SIDE,
  IMAGE_DROP_SVG_FALLBACK,
  clampImageDims,
  extractImageFile,
  handleCanvasFileDrop,
  isAcceptableImageFile,
  isRasterDownscalable,
} from './canvas-drop';

/** Build a File with the given name + optional MIME type. Body content is
 *  irrelevant — these helpers only inspect name/type. */
const fileOf = (name: string, type = ''): File => new File([new Uint8Array([0])], name, { type });

/** Minimal DataTransfer-like stand-in. Bun has no DOM DataTransfer; we only
 *  need .files with .length + .item(i). */
const dtOf = (files: File[]): DataTransfer =>
  ({
    files: {
      length: files.length,
      item: (i: number) => files[i] ?? null,
    },
  }) as unknown as DataTransfer;

describe('isRasterDownscalable', () => {
  it('accepts png/jpeg/webp (canvas re-encode is safe)', () => {
    expect(isRasterDownscalable(fileOf('a.png', 'image/png'))).toBe(true);
    expect(isRasterDownscalable(fileOf('a.jpg', 'image/jpeg'))).toBe(true);
    expect(isRasterDownscalable(fileOf('a.webp', 'image/webp'))).toBe(true);
  });

  it('rejects svg (vector) and gif (may be animated) so they upload untouched', () => {
    expect(isRasterDownscalable(fileOf('a.svg', 'image/svg+xml'))).toBe(false);
    expect(isRasterDownscalable(fileOf('a.gif', 'image/gif'))).toBe(false);
  });

  it('rejects when the MIME is missing (can not safely decide to re-encode)', () => {
    expect(isRasterDownscalable(fileOf('a.png', ''))).toBe(false);
  });
});

describe('isAcceptableImageFile (US-008)', () => {
  it('accepts every extension in IMAGE_DROP_EXTS by name', () => {
    for (const ext of IMAGE_DROP_EXTS) {
      expect(isAcceptableImageFile(fileOf(`pic${ext}`))).toBe(true);
    }
  });

  it('accepts uppercase extensions (Finder sometimes returns IMG_001.PNG)', () => {
    expect(isAcceptableImageFile(fileOf('pic.PNG'))).toBe(true);
    expect(isAcceptableImageFile(fileOf('pic.JPG'))).toBe(true);
    expect(isAcceptableImageFile(fileOf('pic.SVG'))).toBe(true);
  });

  it('accepts image/* MIME even with an unfamiliar extension', () => {
    // Safari has been known to attach `.heic`-renamed files with type=image/png.
    // Trust the MIME when extension is missing/unfamiliar.
    expect(isAcceptableImageFile(fileOf('pic', 'image/png'))).toBe(true);
    expect(isAcceptableImageFile(fileOf('shot.heif', 'image/webp'))).toBe(true);
    expect(isAcceptableImageFile(fileOf('vec.icon', 'image/svg+xml'))).toBe(true);
  });

  it('rejects non-image files', () => {
    expect(isAcceptableImageFile(fileOf('notes.txt'))).toBe(false);
    expect(isAcceptableImageFile(fileOf('archive.zip'))).toBe(false);
    expect(isAcceptableImageFile(fileOf('movie.mp4', 'video/mp4'))).toBe(false);
    expect(isAcceptableImageFile(fileOf('noext'))).toBe(false);
  });
});

describe('extractImageFile (US-008)', () => {
  it('returns null for a null DataTransfer', () => {
    expect(extractImageFile(null)).toBeNull();
  });

  it('returns null when the file list is empty', () => {
    expect(extractImageFile(dtOf([]))).toBeNull();
  });

  it('returns the first acceptable image File', () => {
    const a = fileOf('pic.png');
    const result = extractImageFile(dtOf([a]));
    expect(result).toBe(a);
  });

  it('skips non-image entries to find the first acceptable image', () => {
    const txt = fileOf('a.txt');
    const png = fileOf('b.png');
    const zip = fileOf('c.zip');
    const result = extractImageFile(dtOf([txt, png, zip]));
    expect(result).toBe(png);
  });

  it('returns null when no entry is an image', () => {
    expect(extractImageFile(dtOf([fileOf('a.txt'), fileOf('b.zip')]))).toBeNull();
  });

  it('returns the first image when multiple images are dropped (single-image policy)', () => {
    const a = fileOf('first.png');
    const b = fileOf('second.jpg');
    expect(extractImageFile(dtOf([a, b]))).toBe(a);
  });
});

describe('clampImageDims (US-008)', () => {
  it('returns natural dims unchanged when both sides are <= max', () => {
    expect(clampImageDims({ width: 100, height: 200 })).toEqual({ width: 100, height: 200 });
    expect(
      clampImageDims({ width: IMAGE_DROP_MAX_LONGEST_SIDE, height: IMAGE_DROP_MAX_LONGEST_SIDE }),
    ).toEqual({ width: 400, height: 400 });
  });

  it('caps the longest side at IMAGE_DROP_MAX_LONGEST_SIDE preserving aspect ratio', () => {
    // 2000x1000 → cap longest side (2000) to 400 → 400x200
    expect(clampImageDims({ width: 2000, height: 1000 })).toEqual({ width: 400, height: 200 });
    // 1000x2000 → cap height to 400 → 200x400
    expect(clampImageDims({ width: 1000, height: 2000 })).toEqual({ width: 200, height: 400 });
  });

  it('rounds to integer pixels (no fractional inflow units)', () => {
    // 1234x789 → scale = 400/1234 → height 789*400/1234 ≈ 255.756 → 256
    const dims = clampImageDims({ width: 1234, height: 789 });
    expect(Number.isInteger(dims.width)).toBe(true);
    expect(Number.isInteger(dims.height)).toBe(true);
    expect(dims.width).toBe(400);
    expect(dims.height).toBe(256);
  });

  it('respects a custom max', () => {
    expect(clampImageDims({ width: 200, height: 100 }, 100)).toEqual({ width: 100, height: 50 });
  });

  it('returns IMAGE_DROP_SVG_FALLBACK when natural width is zero', () => {
    // SVG without intrinsic size: <Image>'s naturalWidth is 0.
    expect(clampImageDims({ width: 0, height: 200 })).toEqual({ ...IMAGE_DROP_SVG_FALLBACK });
    expect(clampImageDims({ width: 0, height: 0 })).toEqual({ ...IMAGE_DROP_SVG_FALLBACK });
  });

  it('returns IMAGE_DROP_SVG_FALLBACK when natural height is zero', () => {
    expect(clampImageDims({ width: 200, height: 0 })).toEqual({ ...IMAGE_DROP_SVG_FALLBACK });
  });
});

describe('handleCanvasFileDrop (US-008)', () => {
  const stubRf = (offset = { x: 0, y: 0 }) => ({
    screenToFlowPosition: (p: { x: number; y: number }) => ({
      x: p.x + offset.x,
      y: p.y + offset.y,
    }),
  });

  it('returns false (no dispatch) when the DataTransfer has no acceptable image', async () => {
    const dispatched: CanvasDropDispatchArgs[] = [];
    const result = await handleCanvasFileDrop({
      dataTransfer: dtOf([fileOf('notes.txt')]),
      clientPos: { x: 100, y: 200 },
      rfInstance: stubRf(),
      computeDims: async () => ({ width: 0, height: 0 }),
      dispatch: (args) => dispatched.push(args),
    });
    expect(result).toBe(false);
    expect(dispatched).toHaveLength(0);
  });

  it('returns false (no dispatch) when rfInstance is null', async () => {
    const dispatched: CanvasDropDispatchArgs[] = [];
    const result = await handleCanvasFileDrop({
      dataTransfer: dtOf([fileOf('pic.png')]),
      clientPos: { x: 100, y: 200 },
      rfInstance: null,
      computeDims: async () => ({ width: 200, height: 100 }),
      dispatch: (args) => dispatched.push(args),
    });
    expect(result).toBe(false);
    expect(dispatched).toHaveLength(0);
  });

  it('dispatches with the file + the centered drop position + dims + originalFilename', async () => {
    const dispatched: CanvasDropDispatchArgs[] = [];
    const file = fileOf('Logo.PNG');
    const result = await handleCanvasFileDrop({
      // clientPos (100,200) → rfInstance projects 1:1 (offset 0,0)
      dataTransfer: dtOf([file]),
      clientPos: { x: 100, y: 200 },
      rfInstance: stubRf(),
      computeDims: async () => ({ width: 320, height: 180 }),
      dispatch: (args) => dispatched.push(args),
    });
    expect(result).toBe(true);
    expect(dispatched).toHaveLength(1);
    const arg = dispatched[0];
    if (!arg) throw new Error('expected dispatch');
    expect(arg.file).toBe(file);
    expect(arg.originalFilename).toBe('Logo.PNG');
    expect(arg.dims).toEqual({ width: 320, height: 180 });
    // Center the node on the cursor: 100 - 320/2 = -60, 200 - 180/2 = 110
    expect(arg.position).toEqual({ x: -60, y: 110 });
  });

  it('projects the drop pos through rfInstance.screenToFlowPosition (pan/zoom)', async () => {
    const dispatched: CanvasDropDispatchArgs[] = [];
    await handleCanvasFileDrop({
      dataTransfer: dtOf([fileOf('a.jpg')]),
      clientPos: { x: 50, y: 80 },
      // Pan offset: flow = client + (1000, 2000)
      rfInstance: stubRf({ x: 1000, y: 2000 }),
      computeDims: async () => ({ width: 200, height: 200 }),
      dispatch: (args) => dispatched.push(args),
    });
    const arg = dispatched[0];
    if (!arg) throw new Error('expected dispatch');
    // flow origin (50+1000, 80+2000) = (1050, 2080); minus half dims (100,100)
    // → (950, 1980)
    expect(arg.position).toEqual({ x: 950, y: 1980 });
  });

  it('selects the FIRST acceptable image when multiple files are dropped', async () => {
    const dispatched: CanvasDropDispatchArgs[] = [];
    const txt = fileOf('a.txt');
    const png = fileOf('b.png');
    const jpg = fileOf('c.jpg');
    await handleCanvasFileDrop({
      dataTransfer: dtOf([txt, png, jpg]),
      clientPos: { x: 0, y: 0 },
      rfInstance: stubRf(),
      computeDims: async () => ({ width: 10, height: 10 }),
      dispatch: (args) => dispatched.push(args),
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.file).toBe(png);
  });
});

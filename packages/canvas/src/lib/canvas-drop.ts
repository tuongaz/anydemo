/**
 * US-008: OS-image drag-and-drop helpers. Pure functions consumed by the
 * seeflow-canvas drop handler. The orchestration of upload + optimistic placement
 * + persist + retry lives in `apps/web/src/pages/flow-view.tsx`; this module
 * stays free of API + React dependencies so the helpers are unit-testable
 * without a DOM.
 */

/**
 * Allowed image extensions for OS file drop. Must stay in sync with the
 * server-side `UPLOAD_ALLOWED_EXTS` in `apps/studio/src/api.ts` (US-007).
 */
export const IMAGE_DROP_EXTS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
];

/** US-008: cap the LONGEST side of the dropped image at this many flow-units. */
export const IMAGE_DROP_MAX_LONGEST_SIDE = 400;

/** US-008: SVG without intrinsic dimensions falls back to this square size. */
export const IMAGE_DROP_SVG_FALLBACK = { width: 200, height: 200 } as const;

const lowerExtOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

/**
 * True when the File has an allowed image extension OR an `image/*` MIME type.
 * Mirrors the server-side allowlist; the MIME check is defensive — Safari and
 * Firefox occasionally drop files without `.type` set.
 */
export const isAcceptableImageFile = (file: File): boolean => {
  if (file.type.startsWith('image/')) {
    const subtype = file.type.slice('image/'.length).toLowerCase();
    if (
      subtype === 'png' ||
      subtype === 'jpeg' ||
      subtype === 'jpg' ||
      subtype === 'gif' ||
      subtype === 'webp' ||
      subtype === 'svg+xml'
    ) {
      return true;
    }
  }
  return IMAGE_DROP_EXTS.includes(lowerExtOf(file.name));
};

/**
 * Scan a `DataTransfer.files` list for the first acceptable image file. Returns
 * null when none match (the caller leaves the drop to React Flow's default
 * handlers). Only one image is consumed per drop — multi-file drops keep only
 * the first match.
 */
export const extractImageFile = (dt: DataTransfer | null): File | null => {
  if (!dt) return null;
  const files = dt.files;
  if (!files || files.length === 0) return null;
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i);
    if (f && isAcceptableImageFile(f)) return f;
  }
  return null;
};

/**
 * Collect EVERY acceptable image file from a `DataTransfer.files` list, in drop
 * order. Returns an empty array when none match. The drop handler lays the
 * whole batch out in a grid — one node per image.
 */
export const extractImageFiles = (dt: DataTransfer | null): File[] => {
  if (!dt) return [];
  const files = dt.files;
  if (!files || files.length === 0) return [];
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i);
    if (f && isAcceptableImageFile(f)) out.push(f);
  }
  return out;
};

/**
 * Clamp the LONGEST side of `natural` to `max` (default 400px), preserving
 * aspect ratio. Returns integer dimensions so the canvas renders at clean
 * pixel boundaries.
 *
 * SVGs and other formats that report `naturalWidth === 0` (no intrinsic
 * dimensions) get the IMAGE_DROP_SVG_FALLBACK square instead — passes
 * naturalWidth=0 OR naturalHeight=0.
 */
export const clampImageDims = (
  natural: { width: number; height: number },
  max: number = IMAGE_DROP_MAX_LONGEST_SIDE,
): { width: number; height: number } => {
  if (natural.width <= 0 || natural.height <= 0) {
    return { ...IMAGE_DROP_SVG_FALLBACK };
  }
  const longest = Math.max(natural.width, natural.height);
  if (longest <= max) {
    return { width: Math.round(natural.width), height: Math.round(natural.height) };
  }
  const scale = max / longest;
  return {
    width: Math.round(natural.width * scale),
    height: Math.round(natural.height * scale),
  };
};

export interface CanvasDropDispatchArgs {
  file: File;
  position: { x: number; y: number };
  dims: { width: number; height: number };
  originalFilename: string;
}

export interface HandleCanvasFileDropArgs {
  dataTransfer: DataTransfer | null;
  clientPos: { x: number; y: number };
  rfInstance: {
    screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  } | null;
  computeDims: (file: File) => Promise<{ width: number; height: number }>;
  dispatch: (args: CanvasDropDispatchArgs) => void;
}

/** Gap (flow-units) between adjacent image nodes in a multi-drop grid. */
export const IMAGE_DROP_GRID_GAP = 24;
/** Max columns before a multi-image drop wraps to a new row. */
export const IMAGE_DROP_GRID_MAX_COLS = 4;

/**
 * Lay out N items (each with its own width/height) in a row-major grid whose
 * whole bounding block is CENTERED on `center`. Columns are sized to the widest
 * item in the column and rows to the tallest item in the row, so variable-size
 * images never overlap. Returns each item's top-left position in the same order.
 *
 * A single item collapses to `center - dims/2` — i.e. identical to the legacy
 * "center the node on the cursor" behavior. Pure + exported for unit-testing.
 */
export const layoutImageGrid = (
  items: ReadonlyArray<{ width: number; height: number }>,
  center: { x: number; y: number },
  gap: number = IMAGE_DROP_GRID_GAP,
  maxCols: number = IMAGE_DROP_GRID_MAX_COLS,
): Array<{ x: number; y: number }> => {
  if (items.length === 0) return [];
  const cols = Math.min(items.length, Math.max(1, maxCols));
  const rows = Math.ceil(items.length / cols);
  const colWidth = new Array<number>(cols).fill(0);
  const rowHeight = new Array<number>(rows).fill(0);
  items.forEach((it, k) => {
    const c = k % cols;
    const r = Math.floor(k / cols);
    colWidth[c] = Math.max(colWidth[c] as number, it.width);
    rowHeight[r] = Math.max(rowHeight[r] as number, it.height);
  });
  // Prefix offsets for each column/row (cumulative size + gaps).
  const colX = new Array<number>(cols).fill(0);
  for (let c = 1; c < cols; c++)
    colX[c] = (colX[c - 1] as number) + (colWidth[c - 1] as number) + gap;
  const rowY = new Array<number>(rows).fill(0);
  for (let r = 1; r < rows; r++)
    rowY[r] = (rowY[r - 1] as number) + (rowHeight[r - 1] as number) + gap;
  const totalWidth = colWidth.reduce((a, b) => a + b, 0) + gap * (cols - 1);
  const totalHeight = rowHeight.reduce((a, b) => a + b, 0) + gap * (rows - 1);
  const originX = center.x - totalWidth / 2;
  const originY = center.y - totalHeight / 2;
  return items.map((_, k) => {
    const c = k % cols;
    const r = Math.floor(k / cols);
    return { x: originX + (colX[c] as number), y: originY + (rowY[r] as number) };
  });
};

/**
 * Compose the OS-image drop flow from its primitives so the seeflow-canvas drop
 * handler stays a thin wiring layer over a unit-testable async pipeline.
 * Returns `false` when nothing was dispatched (no image, no rfInstance, etc.)
 * so the caller can decide whether to preventDefault. Promise resolves once
 * every image in the batch has been dispatched (or short-circuited).
 *
 * Multi-file drops dispatch ONE node per acceptable image, laid out in a grid
 * whose block is centered on the cursor (`layoutImageGrid`). A single image
 * collapses to "centered on the cursor", preserving the original behavior.
 */
export const handleCanvasFileDrop = async (args: HandleCanvasFileDropArgs): Promise<boolean> => {
  const files = extractImageFiles(args.dataTransfer);
  if (files.length === 0) return false;
  if (!args.rfInstance) return false;
  const dropFlowOrigin = args.rfInstance.screenToFlowPosition(args.clientPos);
  const dims = await Promise.all(files.map((f) => args.computeDims(f)));
  const positions = layoutImageGrid(dims, dropFlowOrigin);
  files.forEach((file, i) => {
    args.dispatch({
      file,
      position: positions[i] as { x: number; y: number },
      dims: dims[i] as { width: number; height: number },
      originalFilename: file.name,
    });
  });
  return true;
};

/**
 * Resolves with the file's intrinsic dimensions (capped via `clampImageDims`)
 * by loading it through an in-memory Image element backed by a Blob URL.
 * Returns the SVG fallback square when the image fails to decode (broken
 * payload, or SVG without intrinsic size).
 *
 * The Blob URL is revoked in `finally` so we don't leak object URLs across
 * many drops.
 */
export const computeImageDims = (file: File): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    let url: string | null = null;
    const settle = (dims: { width: number; height: number }) => {
      if (url) URL.revokeObjectURL(url);
      resolve(dims);
    };
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve({ ...IMAGE_DROP_SVG_FALLBACK });
      return;
    }
    const img = new Image();
    img.onload = () => {
      settle(clampImageDims({ width: img.naturalWidth, height: img.naturalHeight }));
    };
    img.onerror = () => {
      settle({ ...IMAGE_DROP_SVG_FALLBACK });
    };
    img.src = url;
  });
};

/** US-008: cap the longest side of an uploaded RASTER image at this many pixels
 *  before it leaves the browser. The node renders at <= 400 flow-units anyway,
 *  so storing a full-res phone photo (often 10–50 MP) just bloats the repo and
 *  risks the server-side size cap. 2048 keeps retina-sharp detail headroom. */
export const IMAGE_UPLOAD_MAX_PIXELS = 2048;

/**
 * True when re-encoding the file through a <canvas> is safe + lossless-enough.
 * SVG is vector (rasterizing would destroy it); GIF may be animated (canvas
 * re-encode flattens to the first frame). Everything else we leave to the
 * raster path. Pure — exported for unit-testing the format gate.
 */
export const isRasterDownscalable = (file: File): boolean => {
  const type = file.type.toLowerCase();
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp';
};

/**
 * Re-encode a raster image down so its longest side is <= `maxPixels`,
 * preserving aspect ratio + MIME type. Returns the ORIGINAL file unchanged
 * when: the format isn't safely re-encodable (SVG/GIF/unknown), the image
 * already fits, or anything in the decode/encode path fails. Never throws —
 * a downscale failure must not block the upload (the server cap is the
 * backstop). Browser-only (needs <canvas> + Image); not unit-tested beyond
 * the pure `isRasterDownscalable` gate, mirroring `computeImageDims`.
 */
export const downscaleImageFile = async (
  file: File,
  maxPixels: number = IMAGE_UPLOAD_MAX_PIXELS,
): Promise<File> => {
  if (!isRasterDownscalable(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxPixels) {
      bitmap.close();
      return file;
    }
    const scale = maxPixels / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), file.type);
    });
    if (!blob) return file;
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
};

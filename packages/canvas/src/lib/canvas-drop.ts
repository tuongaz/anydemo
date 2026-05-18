/**
 * US-008: OS-image drag-and-drop helpers. Pure functions consumed by the
 * demo-canvas drop handler. The orchestration of upload + optimistic placement
 * + persist + retry lives in `apps/web/src/pages/demo-view.tsx`; this module
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

/**
 * Compose the OS-image drop flow from its primitives so the demo-canvas drop
 * handler stays a thin wiring layer over a unit-testable async pipeline.
 * Returns `false` when nothing was dispatched (no file, no rfInstance, etc.)
 * so the caller can decide whether to preventDefault. Promise resolves once
 * `dispatch` has been called (or short-circuited).
 *
 * Centers the drop on the cursor by subtracting half the computed dims from
 * the flow-space drop origin — the cursor lands inside the node body rather
 * than at its top-left.
 */
export const handleCanvasFileDrop = async (args: HandleCanvasFileDropArgs): Promise<boolean> => {
  const file = extractImageFile(args.dataTransfer);
  if (!file) return false;
  if (!args.rfInstance) return false;
  const dropFlowOrigin = args.rfInstance.screenToFlowPosition(args.clientPos);
  const dims = await args.computeDims(file);
  args.dispatch({
    file,
    position: { x: dropFlowOrigin.x - dims.width / 2, y: dropFlowOrigin.y - dims.height / 2 },
    dims,
    originalFilename: file.name,
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

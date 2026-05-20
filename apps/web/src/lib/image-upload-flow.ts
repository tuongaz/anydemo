import type { FlowNode, ImageNodeData } from '@/lib/api';
import {
  type ImageDataDefaults,
  type NodeCreateInput,
  type NodeStylePatch,
  buildNewImageData,
} from '@seeflow/canvas';

/**
 * US-008: pure orchestration for the OS-image-drop upload flow. Sits between
 * demo-view's optimistic-override state and the upload + createNode API
 * surface. Extracted into its own module so it can be unit-tested without
 * spinning up the React tree.
 *
 * The flow:
 *   1. setOverride(nodeId, optimistic with `_uploading: true`)
 *   2. upload(projectId, file, originalFilename)
 *   3a. On success: setOverride(nodeId, real data, `_uploading` cleared);
 *       createNode(...); push undo entry.
 *   3b. On failure: setOverride(nodeId, real dims + `_uploadError`); leave
 *       node on the canvas for the user to retry. NEVER auto-delete.
 *
 * The exported function returns a Promise that resolves once the persisted
 * createNode succeeds, or rejects on upload/createNode error. demo-view's
 * caller ignores rejections in practice (the error UX is the retry
 * placeholder), but tests use the promise to await the full chain.
 */

export interface PerformImageDropUploadArgs {
  /** Pre-allocated client-side node id, shared by override + createNode. */
  nodeId: string;
  /** flowId (== projectId in the studio's registry). */
  flowId: string;
  /** Source File for upload. */
  file: File;
  /** Override the File's own .name when posting (used on retry to preserve
   *  the user-visible filename through repeated attempts). */
  originalFilename: string;
  /** Drop position in flow space (top-left of the new image node). */
  position: { x: number; y: number };
  /** Capped natural dims of the image (longest side <= 400). */
  dims: { width: number; height: number };
  /** Last-used node style overlay (docs/plans/2026-05-13-last-used-style-design.md).
   *  Filtered to image-accepted fields inside `buildNewImageData`. */
  lastUsed?: Partial<NodeStylePatch>;
}

export interface PerformImageDropUploadDeps {
  upload: (
    projectId: string,
    nodeId: string,
    file: File,
    filename: string,
  ) => Promise<{ path: string }>;
  createNode: (flowId: string, body: NodeCreateInput) => Promise<{ id: string }>;
  deleteNode: (flowId: string, nodeId: string) => Promise<{ ok: true }>;
  setOverride: (id: string, partial: Partial<FlowNode>) => void;
  /** Push the create-undo entry on success. Absent → undo not wired. */
  pushUndo?: (entry: { do: () => Promise<void>; undo: () => Promise<void> }) => void;
  /** Stash the upload args for a possible retry after failure. */
  rememberRetry: (
    nodeId: string,
    args: {
      file: File;
      originalFilename: string;
      position: { x: number; y: number };
      dims: { width: number; height: number };
    },
  ) => void;
  /** Drop the retry entry once the upload succeeds. */
  forgetRetry: (nodeId: string) => void;
}

/** Build the optimistic override placed BEFORE the upload completes. Carries
 *  `_uploading: true` so image-node.tsx renders the 'Loading…' placeholder
 *  in place of the actual <img>. Exported for unit-testing. */
export const buildUploadingOverride = (args: {
  position: { x: number; y: number };
  dims: { width: number; height: number };
  originalFilename: string;
}): Partial<FlowNode> => ({
  type: 'imageNode',
  position: args.position,
  data: {
    path: '',
    alt: args.originalFilename,
    width: args.dims.width,
    height: args.dims.height,
    _uploading: true,
  } as ImageNodeData,
});

/** Build the override placed AFTER the upload succeeds. Matches the data that
 *  createNode persists so usePendingOverrides.pruneAgainst() can drop the
 *  entry as soon as the SSE-driven reload lands. Exported for unit-testing. */
export const buildUploadedOverride = (args: {
  path: string;
  dims: { width: number; height: number };
  originalFilename: string;
  lastUsed?: Partial<NodeStylePatch>;
}): Partial<FlowNode> => ({
  type: 'imageNode',
  data: buildUploadedImageData(args),
});

/** Build the override placed when the upload FAILED. Carries `_uploadError`
 *  so image-node.tsx renders the 'Upload failed (click to retry)' placeholder. */
export const buildFailedOverride = (args: {
  position: { x: number; y: number };
  dims: { width: number; height: number };
  originalFilename: string;
  message: string;
}): Partial<FlowNode> => ({
  type: 'imageNode',
  position: args.position,
  data: {
    path: '',
    alt: args.originalFilename,
    width: args.dims.width,
    height: args.dims.height,
    _uploadError: args.message,
  } as ImageNodeData,
});

const buildUploadedImageData = (args: {
  path: string;
  dims: { width: number; height: number };
  originalFilename: string;
  lastUsed?: Partial<NodeStylePatch>;
}): ImageDataDefaults & { alt: string } => ({
  ...buildNewImageData(args.path, args.dims, args.lastUsed),
  alt: args.originalFilename,
});

/**
 * Execute the upload-and-persist flow. See module docstring.
 */
export const performImageDropUpload = async (
  args: PerformImageDropUploadArgs,
  deps: PerformImageDropUploadDeps,
): Promise<void> => {
  const { nodeId, flowId, file, originalFilename, position, dims, lastUsed } = args;
  // 1. Stash retry args BEFORE the upload starts. If the user reloads the page
  //    mid-upload the retry context is lost (we don't persist it across page
  //    reloads), but if the upload fails synchronously the placeholder can
  //    still find its file reference.
  deps.rememberRetry(nodeId, { file, originalFilename, position, dims });
  // 2. Optimistic placement.
  deps.setOverride(nodeId, buildUploadingOverride({ position, dims, originalFilename }));

  let path: string;
  try {
    const result = await deps.upload(flowId, nodeId, file, originalFilename);
    path = result.path;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.setOverride(nodeId, buildFailedOverride({ position, dims, originalFilename, message }));
    throw err;
  }

  // 3. Update override to the final data (so pruneAgainst can drop it once the
  //    server echo lands) and persist via createNode.
  deps.setOverride(nodeId, buildUploadedOverride({ path, dims, originalFilename, lastUsed }));
  const data = buildUploadedImageData({ path, dims, originalFilename, lastUsed });
  const payload: NodeCreateInput = {
    id: nodeId,
    type: 'imageNode',
    position,
    data,
  };
  const { id: returnedId } = await deps.createNode(flowId, payload);
  // 4. Upload + persist both succeeded — drop the retry entry.
  deps.forgetRetry(nodeId);
  // 5. Push the undo entry bound to the server-issued id (matches
  //    onCreateShapeNode's pattern in demo-view.tsx).
  if (deps.pushUndo) {
    deps.pushUndo({
      do: async () => {
        await deps.createNode(flowId, { ...payload, id: returnedId });
      },
      undo: async () => {
        await deps.deleteNode(flowId, returnedId);
      },
    });
  }
};

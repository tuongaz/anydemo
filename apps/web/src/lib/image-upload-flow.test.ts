import { describe, expect, it } from 'bun:test';
import type { CreateNodeBody, DemoNode } from '@/lib/api';
import {
  buildFailedOverride,
  buildUploadedOverride,
  buildUploadingOverride,
  performImageDropUpload,
} from '@/lib/image-upload-flow';
import { NEW_NODE_BORDER_WIDTH } from '@seeflow/canvas';

interface OverrideEvent {
  id: string;
  partial: Partial<DemoNode>;
}

const stubFile = (name = 'pic.png', type = 'image/png'): File =>
  new File([new Uint8Array([0])], name, { type });

const buildDeps = (overrides?: {
  upload?: (projectId: string, file: File, filename: string) => Promise<{ path: string }>;
  createNode?: (demoId: string, body: CreateNodeBody) => Promise<{ id: string }>;
}) => {
  const overrideEvents: OverrideEvent[] = [];
  const uploadCalls: { projectId: string; file: File; filename: string }[] = [];
  const createCalls: { demoId: string; body: CreateNodeBody }[] = [];
  const deleteCalls: { demoId: string; nodeId: string }[] = [];
  const undoCalls: { do: () => Promise<void>; undo: () => Promise<void> }[] = [];
  const retryRemembered: { nodeId: string; args: unknown }[] = [];
  const retryForgotten: string[] = [];

  const deps = {
    upload:
      overrides?.upload ??
      (async (projectId: string, file: File, filename: string) => {
        uploadCalls.push({ projectId, file, filename });
        return { path: `assets/${filename.toLowerCase()}` };
      }),
    createNode:
      overrides?.createNode ??
      (async (demoId: string, body: CreateNodeBody) => {
        createCalls.push({ demoId, body });
        return { id: body.id ?? 'server-generated' };
      }),
    deleteNode: async (demoId: string, nodeId: string) => {
      deleteCalls.push({ demoId, nodeId });
      return { ok: true as const };
    },
    setOverride: (id: string, partial: Partial<DemoNode>) => {
      overrideEvents.push({ id, partial });
    },
    pushUndo: (entry: { do: () => Promise<void>; undo: () => Promise<void> }) => {
      undoCalls.push(entry);
    },
    rememberRetry: (nodeId: string, args: unknown) => {
      retryRemembered.push({ nodeId, args });
    },
    forgetRetry: (nodeId: string) => {
      retryForgotten.push(nodeId);
    },
  };

  return {
    deps,
    overrideEvents,
    uploadCalls,
    createCalls,
    deleteCalls,
    undoCalls,
    retryRemembered,
    retryForgotten,
  };
};

const baseArgs = (overrides: Partial<Parameters<typeof performImageDropUpload>[0]> = {}) => ({
  nodeId: 'node-test-1',
  demoId: 'demo-1',
  file: stubFile('Hero.png'),
  originalFilename: 'Hero.png',
  position: { x: 100, y: 200 },
  dims: { width: 320, height: 180 },
  ...overrides,
});

describe('performImageDropUpload (US-008)', () => {
  it('places an _uploading optimistic override BEFORE calling upload', async () => {
    let uploadSawOverride = false;
    const ctx = buildDeps({
      upload: async () => {
        // setOverride must have already been called by the time upload runs.
        uploadSawOverride = ctx.overrideEvents.length > 0;
        return { path: 'assets/hero.png' };
      },
    });
    await performImageDropUpload(baseArgs(), ctx.deps);
    expect(uploadSawOverride).toBe(true);
    // The first override carries `_uploading: true` and an empty path.
    const first = ctx.overrideEvents[0];
    expect(first?.id).toBe('node-test-1');
    const firstData = (first?.partial as { data?: Record<string, unknown> }).data ?? {};
    expect(firstData._uploading).toBe(true);
    expect(firstData.path).toBe('');
    expect(firstData.width).toBe(320);
    expect(firstData.height).toBe(180);
    expect(firstData.alt).toBe('Hero.png');
  });

  it('stashes retry args via rememberRetry BEFORE the upload runs', async () => {
    const probe: { beforeUpload: number } = { beforeUpload: -1 };
    const ctx = buildDeps({
      upload: async () => {
        probe.beforeUpload = ctx.retryRemembered.length;
        return { path: 'assets/hero.png' };
      },
    });
    await performImageDropUpload(baseArgs(), ctx.deps);
    expect(probe.beforeUpload).toBe(1);
    expect(ctx.retryRemembered[0]?.nodeId).toBe('node-test-1');
  });

  it('calls upload with demoId + file + originalFilename in order', async () => {
    const ctx = buildDeps();
    const file = stubFile('Logo.SVG', 'image/svg+xml');
    await performImageDropUpload(baseArgs({ file, originalFilename: 'Logo.SVG' }), ctx.deps);
    expect(ctx.uploadCalls).toHaveLength(1);
    expect(ctx.uploadCalls[0]?.projectId).toBe('demo-1');
    expect(ctx.uploadCalls[0]?.file).toBe(file);
    expect(ctx.uploadCalls[0]?.filename).toBe('Logo.SVG');
  });

  it('PATCHes the override with the real path + clears _uploading after upload resolves', async () => {
    const ctx = buildDeps({
      upload: async () => ({ path: 'assets/hero.png' }),
    });
    await performImageDropUpload(baseArgs(), ctx.deps);
    // Two override calls expected: uploading → uploaded.
    expect(ctx.overrideEvents.length).toBeGreaterThanOrEqual(2);
    const second = ctx.overrideEvents[1];
    const data = (second?.partial as { data?: Record<string, unknown> }).data ?? {};
    expect(data.path).toBe('assets/hero.png');
    expect(data.alt).toBe('Hero.png');
    expect(data.width).toBe(320);
    expect(data.height).toBe(180);
    expect(data._uploading).toBeUndefined();
    expect(data._uploadError).toBeUndefined();
  });

  it('calls createNode with the uploaded image data + the pre-allocated id', async () => {
    const ctx = buildDeps();
    await performImageDropUpload(baseArgs(), ctx.deps);
    expect(ctx.createCalls).toHaveLength(1);
    expect(ctx.createCalls[0]?.demoId).toBe('demo-1');
    expect(ctx.createCalls[0]?.body.id).toBe('node-test-1');
    expect(ctx.createCalls[0]?.body.type).toBe('imageNode');
    expect(ctx.createCalls[0]?.body.position).toEqual({ x: 100, y: 200 });
    const data = ctx.createCalls[0]?.body.data as Record<string, unknown>;
    expect(data.path).toBe('assets/hero.png');
    expect(data.alt).toBe('Hero.png');
    expect(data.width).toBe(320);
    expect(data.height).toBe(180);
    // Default border width for new image nodes — comes from node-defaults.
    expect(data.borderWidth).toBe(NEW_NODE_BORDER_WIDTH);
    // Transient flags must not leak into the persisted payload.
    expect(data._uploading).toBeUndefined();
    expect(data._uploadError).toBeUndefined();
  });

  it('forgets the retry entry after createNode succeeds', async () => {
    const ctx = buildDeps();
    await performImageDropUpload(baseArgs(), ctx.deps);
    expect(ctx.retryForgotten).toEqual(['node-test-1']);
  });

  it('pushes an undo entry whose undo() calls deleteNode with the server-issued id', async () => {
    const ctx = buildDeps({
      createNode: async () => ({ id: 'server-id-42' }),
    });
    await performImageDropUpload(baseArgs(), ctx.deps);
    expect(ctx.undoCalls).toHaveLength(1);
    const entry = ctx.undoCalls[0];
    if (!entry) throw new Error('expected one undo entry');
    await entry.undo();
    expect(ctx.deleteCalls).toEqual([{ demoId: 'demo-1', nodeId: 'server-id-42' }]);
  });

  it('on upload FAILURE: sets _uploadError override, does NOT call createNode, keeps retry entry', async () => {
    const ctx = buildDeps({
      upload: async () => {
        throw new Error('network down');
      },
    });
    let caught: unknown = null;
    try {
      await performImageDropUpload(baseArgs(), ctx.deps);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error | null)?.message).toBe('network down');
    // Two overrides: uploading → failed.
    const failed = ctx.overrideEvents[1];
    const data = (failed?.partial as { data?: Record<string, unknown> }).data ?? {};
    expect(data._uploadError).toBe('network down');
    expect(data._uploading).toBeUndefined();
    expect(data.width).toBe(320);
    expect(data.height).toBe(180);
    // createNode should not have been called at all.
    expect(ctx.createCalls).toHaveLength(0);
    // Retry entry stays — the user can click to retry.
    expect(ctx.retryForgotten).toHaveLength(0);
    expect(ctx.retryRemembered).toHaveLength(1);
  });

  it('on createNode FAILURE (after upload succeeded): does NOT forget retry, does NOT push undo', async () => {
    const ctx = buildDeps({
      createNode: async () => {
        throw new Error('PATCH 500');
      },
    });
    let caught: unknown = null;
    try {
      await performImageDropUpload(baseArgs(), ctx.deps);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error | null)?.message).toBe('PATCH 500');
    // Upload succeeded → uploaded override was applied.
    expect(ctx.overrideEvents.length).toBeGreaterThanOrEqual(2);
    // But createNode failed → retry NOT forgotten and no undo pushed.
    expect(ctx.retryForgotten).toHaveLength(0);
    expect(ctx.undoCalls).toHaveLength(0);
  });
});

describe('override builders (US-008)', () => {
  it('buildUploadingOverride yields type=imageNode + _uploading=true + empty path', () => {
    const o = buildUploadingOverride({
      position: { x: 1, y: 2 },
      dims: { width: 10, height: 20 },
      originalFilename: 'A.PNG',
    });
    expect(o.type).toBe('imageNode');
    expect(o.position).toEqual({ x: 1, y: 2 });
    const data = (o.data ?? {}) as Record<string, unknown>;
    expect(data._uploading).toBe(true);
    expect(data.path).toBe('');
    expect(data.alt).toBe('A.PNG');
    expect(data.width).toBe(10);
    expect(data.height).toBe(20);
  });

  it('buildUploadedOverride omits _uploading + has the real path + borderWidth default', () => {
    const o = buildUploadedOverride({
      path: 'assets/x.png',
      dims: { width: 10, height: 20 },
      originalFilename: 'X.png',
    });
    const data = (o.data ?? {}) as Record<string, unknown>;
    expect(data._uploading).toBeUndefined();
    expect(data._uploadError).toBeUndefined();
    expect(data.path).toBe('assets/x.png');
    expect(data.borderWidth).toBe(NEW_NODE_BORDER_WIDTH);
  });

  it('buildFailedOverride yields _uploadError with the message', () => {
    const o = buildFailedOverride({
      position: { x: 0, y: 0 },
      dims: { width: 10, height: 20 },
      originalFilename: 'A.png',
      message: 'boom',
    });
    const data = (o.data ?? {}) as Record<string, unknown>;
    expect(data._uploadError).toBe('boom');
    expect(data._uploading).toBeUndefined();
  });
});

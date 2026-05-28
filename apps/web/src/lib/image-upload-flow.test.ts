import { describe, expect, it } from 'bun:test';
import type { FlowNode } from '@/lib/api';
import {
  buildFailedOverride,
  buildUploadedOverride,
  buildUploadingOverride,
  performImageDropUpload,
} from '@/lib/image-upload-flow';
import { NEW_NODE_BORDER_WIDTH, type NodeCreateInput } from '@seeflow/canvas';

interface OverrideEvent {
  id: string;
  partial: Partial<FlowNode>;
}

interface BatchCall {
  name: string;
  resolved: boolean;
  rejected: boolean;
}

const stubFile = (name = 'pic.png', type = 'image/png'): File =>
  new File([new Uint8Array([0])], name, { type });

const buildDeps = (overrides?: {
  upload?: (
    projectId: string,
    nodeId: string,
    file: File,
    filename: string,
  ) => Promise<{ path: string }>;
  createNode?: (flowId: string, body: NodeCreateInput) => Promise<{ id: string }>;
  withHistory?: boolean;
}) => {
  const overrideEvents: OverrideEvent[] = [];
  const uploadCalls: { projectId: string; nodeId: string; file: File; filename: string }[] = [];
  const createCalls: { flowId: string; body: NodeCreateInput }[] = [];
  const retryRemembered: { nodeId: string; args: unknown }[] = [];
  const retryForgotten: string[] = [];
  const batchCalls: BatchCall[] = [];

  const history = {
    batch: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const call: BatchCall = { name, resolved: false, rejected: false };
      batchCalls.push(call);
      try {
        const result = await fn();
        call.resolved = true;
        return result;
      } catch (err) {
        call.rejected = true;
        throw err;
      }
    },
  };

  const deps = {
    upload:
      overrides?.upload ??
      (async (projectId: string, nodeId: string, file: File, filename: string) => {
        uploadCalls.push({ projectId, nodeId, file, filename });
        return { path: `nodes/${nodeId}/${filename.toLowerCase()}` };
      }),
    createNode:
      overrides?.createNode ??
      (async (flowId: string, body: NodeCreateInput) => {
        createCalls.push({ flowId, body });
        return { id: body.id ?? 'server-generated' };
      }),
    setOverride: (id: string, partial: Partial<FlowNode>) => {
      overrideEvents.push({ id, partial });
    },
    ...(overrides?.withHistory === false ? {} : { history }),
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
    retryRemembered,
    retryForgotten,
    batchCalls,
  };
};

const baseArgs = (overrides: Partial<Parameters<typeof performImageDropUpload>[0]> = {}) => ({
  nodeId: 'node-test-1',
  flowId: 'demo-1',
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

  it('calls upload with flowId + file + originalFilename in order', async () => {
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
    expect(ctx.createCalls[0]?.flowId).toBe('demo-1');
    expect(ctx.createCalls[0]?.body.id).toBe('node-test-1');
    expect(ctx.createCalls[0]?.body.type).toBe('image');
    expect(ctx.createCalls[0]?.body.position).toEqual({ x: 100, y: 200 });
    const data = ctx.createCalls[0]?.body.data as Record<string, unknown>;
    expect(data.path).toBe('nodes/node-test-1/hero.png');
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

  it("wraps the upload + createNode pair in history.batch('insert-image')", async () => {
    const ctx = buildDeps();
    await performImageDropUpload(baseArgs(), ctx.deps);
    expect(ctx.batchCalls).toHaveLength(1);
    expect(ctx.batchCalls[0]?.name).toBe('insert-image');
    expect(ctx.batchCalls[0]?.resolved).toBe(true);
    expect(ctx.batchCalls[0]?.rejected).toBe(false);
    // Inside the batch the createNode lands — undo for that batch is the
    // wrapped adapter's createNode→deleteNode inverse (covered in
    // wrap-adapter.test.ts), not asserted here.
    expect(ctx.createCalls).toHaveLength(1);
  });

  it('runs the upload + createNode pair without a batch when history is omitted', async () => {
    const ctx = buildDeps({ withHistory: false });
    await performImageDropUpload(baseArgs(), ctx.deps);
    expect(ctx.batchCalls).toHaveLength(0);
    // The pair still executes.
    expect(ctx.uploadCalls).toHaveLength(1);
    expect(ctx.createCalls).toHaveLength(1);
    expect(ctx.retryForgotten).toEqual(['node-test-1']);
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

  it('on createNode FAILURE (after upload succeeded): batch rejects, does NOT forget retry', async () => {
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
    // But createNode failed → retry NOT forgotten; the batch reports the
    // rejection so the wrapped adapter's batch rollback fires.
    expect(ctx.retryForgotten).toHaveLength(0);
    expect(ctx.batchCalls).toHaveLength(1);
    expect(ctx.batchCalls[0]?.rejected).toBe(true);
  });
});

describe('override builders (US-008)', () => {
  it('buildUploadingOverride yields type=image + _uploading=true + empty path', () => {
    const o = buildUploadingOverride({
      position: { x: 1, y: 2 },
      dims: { width: 10, height: 20 },
      originalFilename: 'A.PNG',
    });
    expect(o.type).toBe('image');
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

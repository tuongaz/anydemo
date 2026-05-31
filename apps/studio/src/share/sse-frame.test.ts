import { describe, expect, test } from 'bun:test';
import type { StudioEvent } from '../events.ts';
import { SSE_EVENT_TYPES, SsePayloadSchema, isSseEventType, wrapAsSseFrame } from './sse-frame.ts';

describe('SsePayloadSchema', () => {
  test('parses one valid payload per supported event type', () => {
    for (const t of SSE_EVENT_TYPES) {
      const payload = {
        t,
        flowId: 'flow-a',
        ts: 1_700_000_000_000,
        data: { nodeId: 'node-aaaaaaaaaa', detail: 'ok' },
        seq: 7,
      };
      const result = SsePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.t).toBe(t);
        expect(result.data.data).toEqual({ nodeId: 'node-aaaaaaaaaa', detail: 'ok' });
      }
    }
  });

  test('rejects unknown event types', () => {
    const payload = {
      t: 'node:rumored',
      flowId: 'flow-a',
      ts: 1,
      data: null,
      seq: 0,
    };
    expect(SsePayloadSchema.safeParse(payload).success).toBe(false);
  });

  test('rejects payload missing seq', () => {
    const payload = {
      t: 'node:done',
      flowId: 'flow-a',
      ts: 1,
      data: null,
    };
    expect(SsePayloadSchema.safeParse(payload).success).toBe(false);
  });

  test('rejects negative ts or seq', () => {
    expect(
      SsePayloadSchema.safeParse({
        t: 'node:done',
        flowId: 'flow-a',
        ts: -1,
        data: null,
        seq: 1,
      }).success,
    ).toBe(false);
    expect(
      SsePayloadSchema.safeParse({
        t: 'node:done',
        flowId: 'flow-a',
        ts: 1,
        data: null,
        seq: -1,
      }).success,
    ).toBe(false);
  });

  test('rejects empty flowId', () => {
    expect(
      SsePayloadSchema.safeParse({
        t: 'node:done',
        flowId: '',
        ts: 1,
        data: null,
        seq: 0,
      }).success,
    ).toBe(false);
  });

  test('preserves opaque data pass-through (string, object, null, array)', () => {
    const cases: unknown[] = ['plain string', { nested: { value: 42 } }, null, [1, 2, 3]];
    for (const data of cases) {
      const parsed = SsePayloadSchema.parse({
        t: 'node:status',
        flowId: 'flow-a',
        ts: 1,
        data,
        seq: 1,
      });
      expect(parsed.data).toEqual(data);
    }
  });
});

describe('wrapAsSseFrame', () => {
  test('wraps a StudioEvent into a v=1, type=sse, from=host, to=all envelope', () => {
    const event: StudioEvent = {
      type: 'node:running',
      flowId: 'flow-a',
      payload: { nodeId: 'node-aaaaaaaaaa' },
      ts: 1_700_000_000_000,
    };
    const frame = wrapAsSseFrame(event, 11);
    expect(frame).not.toBeNull();
    expect(frame).toEqual({
      v: 1,
      type: 'sse',
      from: 'host',
      to: 'all',
      payload: {
        t: 'node:running',
        flowId: 'flow-a',
        ts: 1_700_000_000_000,
        data: { nodeId: 'node-aaaaaaaaaa' },
        seq: 11,
      },
    });
  });

  test('output payload validates against SsePayloadSchema for every supported type', () => {
    let seq = 0;
    for (const t of SSE_EVENT_TYPES) {
      const frame = wrapAsSseFrame(
        { type: t, flowId: 'flow-a', payload: { i: seq }, ts: seq + 1 },
        seq,
      );
      expect(frame).not.toBeNull();
      const parsed = SsePayloadSchema.safeParse(frame?.payload);
      expect(parsed.success).toBe(true);
      seq += 1;
    }
  });

  test('returns null for non-bridged event types (file:changed, registry:reload)', () => {
    const fileEvt: StudioEvent = {
      type: 'file:changed',
      flowId: 'flow-a',
      payload: {},
      ts: 1,
    };
    const regEvt: StudioEvent = {
      type: 'registry:reload',
      flowId: '*',
      payload: {},
      ts: 1,
    };
    expect(wrapAsSseFrame(fileEvt, 1)).toBeNull();
    expect(wrapAsSseFrame(regEvt, 2)).toBeNull();
  });
});

describe('isSseEventType', () => {
  test('returns true only for bridged event types', () => {
    for (const t of SSE_EVENT_TYPES) {
      expect(isSseEventType(t)).toBe(true);
    }
    expect(isSseEventType('file:changed')).toBe(false);
    expect(isSseEventType('registry:reload')).toBe(false);
    expect(isSseEventType('node:made-up')).toBe(false);
  });
});

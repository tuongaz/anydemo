import { describe, expect, it } from 'bun:test';
import { type StudioEvent, toFlowReloadPayload } from '@/hooks/use-studio-events';

const event = (extra: Partial<StudioEvent> = {}): StudioEvent => ({
  type: 'flow:reload',
  ts: 0,
  ...extra,
});

describe('toFlowReloadPayload', () => {
  it('narrows a valid:true event to {valid:true, flow}', () => {
    const flow = { version: 2 as const, name: 'X', nodes: [], connectors: [] };
    const out = toFlowReloadPayload(event({ valid: true, flow }));
    expect(out).toEqual({ valid: true, flow });
  });

  it('narrows a valid:false event to {valid:false, error}', () => {
    const out = toFlowReloadPayload(event({ valid: false, error: 'bad json' }));
    expect(out).toEqual({ valid: false, error: 'bad json' });
  });

  it('returns null for an empty payload (legacy layout endpoint)', () => {
    const out = toFlowReloadPayload(event());
    expect(out).toBeNull();
  });

  it('returns null when valid:true but flow is missing', () => {
    const out = toFlowReloadPayload(event({ valid: true }));
    expect(out).toBeNull();
  });

  it('returns null when valid:false but error is missing', () => {
    const out = toFlowReloadPayload(event({ valid: false }));
    expect(out).toBeNull();
  });
});

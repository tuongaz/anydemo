import { describe, expect, it } from 'bun:test';
import { type Envelope, makeEnvelope, parseEnvelope } from './share-envelope.ts';

describe('parseEnvelope', () => {
  it('accepts a valid rpc frame', () => {
    const raw = {
      v: 1,
      type: 'rpc',
      id: 'r-1',
      from: 'peer-abc',
      to: 'host',
      payload: { method: 'flow.patch', args: [] },
    };
    const result = parseEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.type).toBe('rpc');
      expect(result.envelope.id).toBe('r-1');
    }
  });

  it('rejects an envelope with wrong v', () => {
    const raw = { v: 2, type: 'rpc', from: 'peer-abc', payload: {} };
    const result = parseEnvelope(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/v/);
    }
  });

  it('rejects an envelope with unknown type', () => {
    const raw = { v: 1, type: 'mystery', from: 'peer-abc', payload: {} };
    const result = parseEnvelope(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/type/);
    }
  });

  it('accepts an auth-host frame', () => {
    const raw = {
      v: 1,
      type: 'auth-host',
      from: 'host',
      payload: { sessionId: 's-1', hostKey: 'hk' },
    };
    const result = parseEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.type).toBe('auth-host');
    }
  });

  it('accepts an auth-peer frame', () => {
    const raw = {
      v: 1,
      type: 'auth-peer',
      from: 'peer-abc',
      payload: { peerJwt: 'jwt.value' },
    };
    const result = parseEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.type).toBe('auth-peer');
    }
  });

  it('rejects non-object input', () => {
    const result = parseEnvelope('hello');
    expect(result.ok).toBe(false);
  });
});

describe('makeEnvelope', () => {
  it('defaults from to "host" and sets v=1', () => {
    const env: Envelope = makeEnvelope('sse', { type: 'node:running' });
    expect(env.v).toBe(1);
    expect(env.type).toBe('sse');
    expect(env.from).toBe('host');
    expect(env.id).toBeUndefined();
    expect(env.to).toBeUndefined();
    expect(env.payload).toEqual({ type: 'node:running' });
  });

  it('respects provided id, to, and from overrides', () => {
    const env = makeEnvelope(
      'rpc-result',
      { ok: true },
      { id: 'r-7', to: 'peer-xyz', from: 'host' },
    );
    expect(env.id).toBe('r-7');
    expect(env.to).toBe('peer-xyz');
    expect(env.from).toBe('host');
  });

  it('produces a frame that round-trips through parseEnvelope', () => {
    const env = makeEnvelope('kick', { peerId: 'p-1' }, { to: 'p-1' });
    const result = parseEnvelope(env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope).toEqual(env);
    }
  });
});

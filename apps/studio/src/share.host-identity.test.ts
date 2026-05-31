import { describe, expect, it } from 'bun:test';
import { userInfo } from 'node:os';
import type { AuditLog, AuditLogOpts } from './share-audit.ts';
import type { Envelope } from './share-envelope.ts';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { createShareController, resolveHostDisplayName } from './share.ts';

const noopAuditFactory = (_opts: AuditLogOpts): AuditLog => ({
  append: () => {},
  close: async () => {},
});

const baseDeps = {
  relayHttpUrl: 'https://relay.example',
  shareUrlBase: 'https://share.example',
  auditLogFactory: noopAuditFactory,
};

function makeFakeTransport(autoEmit: ShareTransportState[]): {
  factory: (opts: ShareTransportOpts) => ShareTransport;
} {
  const factory = (opts: ShareTransportOpts): ShareTransport => {
    const t: ShareTransport = {
      send(_frame: Envelope) {},
      close() {},
      isOpen() {
        return true;
      },
    };
    for (const s of autoEmit) opts.onStateChange(s);
    return t;
  };
  return { factory };
}

function mockFetch(body: unknown): typeof fetch {
  const fake = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as unknown as Response;
  return fake as unknown as typeof fetch;
}

describe('resolveHostDisplayName', () => {
  it('returns the running OS user username when available', () => {
    const expected = userInfo().username.trim();
    if (!expected) {
      // Sandboxed environment with no username — verify the fallback fires
      // instead. Most dev / CI machines hit the happy path.
      expect(resolveHostDisplayName()).toBe('Host');
      return;
    }
    expect(resolveHostDisplayName()).toBe(expected);
  });

  it("never returns an empty string — falls back to 'Host' when userInfo would be empty", () => {
    const result = resolveHostDisplayName();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('createShareController hostDisplayName auto-derive', () => {
  it('defaults hostDisplayName to os.userInfo().username and exposes it on state().hostDisplayName', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        sessionId: 'sess-1',
        token: 'tok-1',
        hostKey: 'hk-1',
        wsUrl: 'wss://relay/ws',
      }),
      transportFactory: fake.factory,
    });
    await ctrl.start();
    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active');
    expect(s.hostDisplayName).toBe(resolveHostDisplayName());
  });

  it('explicit hostDisplayName dep overrides the OS-derived default', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      hostDisplayName: 'CustomHost',
      fetch: mockFetch({
        sessionId: 'sess-2',
        token: 'tok-2',
        hostKey: 'hk-2',
        wsUrl: 'wss://relay/ws',
      }),
      transportFactory: fake.factory,
    });
    await ctrl.start();
    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active');
    expect(s.hostDisplayName).toBe('CustomHost');
  });
});

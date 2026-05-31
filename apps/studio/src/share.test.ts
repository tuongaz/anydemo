import { describe, expect, it } from 'bun:test';
import { type ShareState, createShareController } from './share.ts';

const baseDeps = {
  relayHttpUrl: 'https://relay.example',
  shareUrlBase: 'https://share.example',
};

describe('createShareController', () => {
  it('starts in idle state', () => {
    const ctrl = createShareController(baseDeps);
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('subscribe is invoked synchronously with the current state', () => {
    const ctrl = createShareController(baseDeps);
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ status: 'idle' });
  });

  it('subscribe returns a working unsubscribe', () => {
    const ctrl = createShareController(baseDeps);
    let count = 0;
    const off = ctrl.subscribe(() => {
      count++;
    });
    expect(count).toBe(1);
    off();
    // Calling unsubscribe again must be a no-op.
    off();
    expect(count).toBe(1);
  });

  it('calling start twice in idle (with stub) does not corrupt state', async () => {
    const ctrl = createShareController(baseDeps);
    await expect(ctrl.start()).rejects.toThrow('not-implemented');
    await expect(ctrl.start()).rejects.toThrow('not-implemented');
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('stub stop/kick/rotateUrl throw not-implemented without mutating state', async () => {
    const ctrl = createShareController(baseDeps);
    await expect(ctrl.stop()).rejects.toThrow('not-implemented');
    await expect(ctrl.kick('peer-1')).rejects.toThrow('not-implemented');
    await expect(ctrl.rotateUrl()).rejects.toThrow('not-implemented');
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('state() never exposes a hostKey field', () => {
    const ctrl = createShareController(baseDeps);
    const snapshot = ctrl.state() as Record<string, unknown>;
    expect(snapshot.hostKey).toBeUndefined();
  });
});

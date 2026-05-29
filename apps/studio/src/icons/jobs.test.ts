import { describe, expect, it } from 'bun:test';
import { createJobRegistry } from './jobs.ts';

describe('createJobRegistry', () => {
  it('issues distinct ids and stores events in order', () => {
    const reg = createJobRegistry();
    const id = reg.create('aws');
    reg.append(id, { type: 'extracting', vendor: 'aws' });
    reg.append(id, { type: 'done', vendor: 'aws', version: 'v', iconCount: 1 });
    const j = reg.get(id);
    expect(j?.events.map((e) => e.type)).toEqual(['extracting', 'done']);
    expect(j?.vendor).toBe('aws');
  });

  it('refuses to start a second job for the same vendor while one is in flight', () => {
    const reg = createJobRegistry();
    const first = reg.create('aws');
    expect(() => reg.create('aws')).toThrow(/already in flight/);
    reg.markComplete(first);
    expect(() => reg.create('aws')).not.toThrow();
  });

  it('inFlightFor returns the active job id then undefined after completion', () => {
    const reg = createJobRegistry();
    expect(reg.inFlightFor('aws')).toBeUndefined();
    const id = reg.create('aws');
    expect(reg.inFlightFor('aws')).toBe(id);
    expect(reg.inFlightFor('gcp')).toBeUndefined();
    reg.markComplete(id);
    expect(reg.inFlightFor('aws')).toBeUndefined();
  });

  it('subscribe replays buffered events then fans out live appends and endSubscriber on markComplete', () => {
    const reg = createJobRegistry();
    const id = reg.create('aws');
    reg.append(id, { type: 'extracting', vendor: 'aws' });

    const received: string[] = [];
    let ended = false;
    const unsubscribe = reg.subscribe(
      id,
      (ev) => received.push(ev.type),
      () => {
        ended = true;
      },
    );

    // Replay was synchronous.
    expect(received).toEqual(['extracting']);
    expect(ended).toBe(false);

    reg.append(id, { type: 'done', vendor: 'aws', version: 'v', iconCount: 1 });
    expect(received).toEqual(['extracting', 'done']);

    reg.markComplete(id);
    expect(ended).toBe(true);

    // Unsubscribe is idempotent and prevents further fanout.
    unsubscribe();
    reg.append(id, { type: 'error', vendor: 'aws', message: 'late' });
    expect(received).toEqual(['extracting', 'done']);
  });

  it('subscribe to an already-complete job replays events and invokes onEnd immediately', () => {
    const reg = createJobRegistry();
    const id = reg.create('aws');
    reg.append(id, { type: 'done', vendor: 'aws', version: 'v', iconCount: 0 });
    reg.markComplete(id);

    const received: string[] = [];
    let ended = false;
    reg.subscribe(
      id,
      (ev) => received.push(ev.type),
      () => {
        ended = true;
      },
    );
    expect(received).toEqual(['done']);
    expect(ended).toBe(true);
  });

  it('subscribe to an unknown id is a no-op and returns a noop unsubscribe', () => {
    const reg = createJobRegistry();
    let touched = false;
    const off = reg.subscribe(
      'unknown',
      () => {
        touched = true;
      },
      () => {
        touched = true;
      },
    );
    expect(touched).toBe(false);
    expect(() => off()).not.toThrow();
  });
});

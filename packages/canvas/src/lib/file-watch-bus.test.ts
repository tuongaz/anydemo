import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetFileWatchBusForTest,
  _setEventSourceFactoryForTest,
  subscribeFileChanged,
} from './file-watch-bus.ts';

/** Minimal mock that records every addEventListener call so the test can
 *  invoke the file:changed handler directly. */
function makeMockSource(): {
  source: {
    close: () => void;
    addEventListener: (type: string, handler: (e: MessageEvent) => void) => void;
  };
  emit: (type: string, data: unknown) => void;
  closed: { value: boolean };
} {
  const handlers = new Map<string, Set<(e: MessageEvent) => void>>();
  const closed = { value: false };
  const source = {
    close: () => {
      closed.value = true;
    },
    addEventListener: (type: string, handler: (e: MessageEvent) => void) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
    },
  };
  const emit = (type: string, data: unknown) => {
    const set = handlers.get(type);
    if (!set) return;
    const event = { data: JSON.stringify(data) } as unknown as MessageEvent;
    for (const h of set) h(event);
  };
  return { source, emit, closed };
}

afterEach(() => {
  _setEventSourceFactoryForTest(null);
  _resetFileWatchBusForTest();
});

describe('subscribeFileChanged (US-014)', () => {
  it('opens exactly one EventSource per projectId regardless of subscriber count', () => {
    let opens = 0;
    const mock = makeMockSource();
    _setEventSourceFactoryForTest(() => {
      opens += 1;
      return mock.source;
    });
    const unsub1 = subscribeFileChanged('p1', () => {});
    const unsub2 = subscribeFileChanged('p1', () => {});
    const unsub3 = subscribeFileChanged('p1', () => {});
    expect(opens).toBe(1);
    unsub1();
    unsub2();
    unsub3();
  });

  it('emits the changed path to every listener subscribed to that project', () => {
    const mock = makeMockSource();
    _setEventSourceFactoryForTest(() => mock.source);
    const seen: string[] = [];
    const unsub1 = subscribeFileChanged('p1', (path) => seen.push(`a:${path}`));
    const unsub2 = subscribeFileChanged('p1', (path) => seen.push(`b:${path}`));
    mock.emit('file:changed', { path: 'assets/foo.png' });
    expect(seen).toEqual(['a:assets/foo.png', 'b:assets/foo.png']);
    unsub1();
    unsub2();
  });

  it('closes the underlying EventSource when the last subscriber unsubscribes', () => {
    const mock = makeMockSource();
    _setEventSourceFactoryForTest(() => mock.source);
    const unsub1 = subscribeFileChanged('p1', () => {});
    const unsub2 = subscribeFileChanged('p1', () => {});
    unsub1();
    expect(mock.closed.value).toBe(false);
    unsub2();
    expect(mock.closed.value).toBe(true);
  });

  it('opens a fresh EventSource on a re-subscribe after the previous source closed', () => {
    let opens = 0;
    let lastMock = makeMockSource();
    _setEventSourceFactoryForTest(() => {
      opens += 1;
      lastMock = makeMockSource();
      return lastMock.source;
    });
    const unsubA = subscribeFileChanged('p1', () => {});
    unsubA();
    const unsubB = subscribeFileChanged('p1', () => {});
    expect(opens).toBe(2);
    unsubB();
  });

  it('isolates projects — a file:changed on p1 does NOT reach p2 listeners', () => {
    const mockP1 = makeMockSource();
    const mockP2 = makeMockSource();
    let i = 0;
    _setEventSourceFactoryForTest(() => (i++ === 0 ? mockP1.source : mockP2.source));
    const seen: string[] = [];
    const unsub1 = subscribeFileChanged('p1', (p) => seen.push(`p1:${p}`));
    const unsub2 = subscribeFileChanged('p2', (p) => seen.push(`p2:${p}`));
    mockP1.emit('file:changed', { path: 'blocks/a.html' });
    expect(seen).toEqual(['p1:blocks/a.html']);
    unsub1();
    unsub2();
  });

  it('ignores malformed payloads (non-string path / non-JSON data)', () => {
    const mock = makeMockSource();
    _setEventSourceFactoryForTest(() => mock.source);
    const seen: string[] = [];
    const unsub = subscribeFileChanged('p1', (p) => seen.push(p));
    mock.emit('file:changed', { path: 42 });
    mock.emit('file:changed', { not_path: 'x' });
    expect(seen).toEqual([]);
    unsub();
  });

  it('returns a no-op unsubscribe when the factory returns null (SSR / non-browser)', () => {
    _setEventSourceFactoryForTest(() => null);
    const unsub = subscribeFileChanged('p1', () => {});
    expect(() => unsub()).not.toThrow();
  });
});

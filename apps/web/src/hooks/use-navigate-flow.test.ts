import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type FlowStackEntry,
  __getFlowStackForTests,
  __setFlowStackForTests,
  computePopState,
  computePushLink,
  computeResetStack,
  initialStackFromPath,
  popBack,
  pushLink,
  reset,
  toFlowStackEntry,
} from '@/hooks/use-navigate-flow';

// apps/web tests run without a DOM. The pure helpers don't touch window;
// the effectful pushLink/popBack/reset do — stub the bits they read/write.

interface FakeHistoryEntry {
  state: unknown;
  url: string;
}

interface FakeWindow {
  history: {
    state: unknown;
    pushState: (state: unknown, _title: string, url: string) => void;
    replaceState: (state: unknown, _title: string, url: string) => void;
    back: () => void;
  };
  location: { pathname: string; search: string; hash: string };
  events: string[];
  pushStack: FakeHistoryEntry[];
  replaceStack: FakeHistoryEntry[];
  backCalls: number;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  dispatchEvent: (event: Event) => boolean;
}

const makeFakeWindow = (
  initial: { pathname: string; state?: unknown } = { pathname: '/' },
): FakeWindow => {
  const w: FakeWindow = {
    events: [],
    pushStack: [],
    replaceStack: [],
    backCalls: 0,
    location: { pathname: initial.pathname, search: '', hash: '' },
    history: {
      state: initial.state ?? null,
      pushState(state, _title, url) {
        this.state = state;
        w.location.pathname = url;
        w.pushStack.push({ state, url });
      },
      replaceState(state, _title, url) {
        this.state = state;
        w.location.pathname = url || w.location.pathname;
        w.replaceStack.push({ state, url });
      },
      back() {
        w.backCalls += 1;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) {
      w.events.push(event.type);
      return true;
    },
  };
  return w;
};

let restoreWindow: (() => void) | null = null;

const installWindow = (fake: FakeWindow): void => {
  const g = globalThis as { window?: unknown };
  const prev = g.window;
  g.window = fake;
  restoreWindow = () => {
    g.window = prev;
  };
};

beforeEach(() => {
  __setFlowStackForTests([]);
});

afterEach(() => {
  if (restoreWindow) {
    restoreWindow();
    restoreWindow = null;
  }
  __setFlowStackForTests([]);
});

describe('toFlowStackEntry', () => {
  it('builds slug from project + flow', () => {
    expect(toFlowStackEntry({ project: 'foo', flow: 'bar' })).toEqual({
      project: 'foo',
      flow: 'bar',
      slug: 'foo/bar',
    });
  });
});

describe('initialStackFromPath', () => {
  it('returns a single entry for a /projects/:p/flows/:f path', () => {
    expect(initialStackFromPath('/projects/foo/flows/bar')).toEqual([
      { project: 'foo', flow: 'bar', slug: 'foo/bar' },
    ]);
  });

  it('returns an empty stack for the home path', () => {
    expect(initialStackFromPath('/')).toEqual([]);
  });

  it('returns an empty stack for a /projects/:p (no flow) path', () => {
    expect(initialStackFromPath('/projects/foo')).toEqual([]);
  });

  it('decodes percent-encoded slug segments', () => {
    expect(initialStackFromPath('/projects/foo%20bar/flows/baz')).toEqual([
      { project: 'foo bar', flow: 'baz', slug: 'foo bar/baz' },
    ]);
  });

  describe('boot mode', () => {
    const boot = { base: '/p/abc', projectSlug: 'meally', flowId: 'main', mode: 'edit' as const };

    it('seeds the project default flow from the base root "/"', () => {
      expect(initialStackFromPath('/', boot)).toEqual([
        { project: 'meally', flow: 'main', slug: 'meally/main' },
      ]);
    });

    it('seeds the boot project + parsed flow from /flows/<flow>', () => {
      expect(initialStackFromPath('/flows/retry', boot)).toEqual([
        { project: 'meally', flow: 'retry', slug: 'meally/retry' },
      ]);
    });
  });
});

describe('computePushLink', () => {
  it('appends a new entry without mutating the input', () => {
    const stack: FlowStackEntry[] = [{ project: 'a', flow: '1', slug: 'a/1' }];
    const next = computePushLink(stack, { project: 'b', flow: '2' });
    expect(next).toEqual([
      { project: 'a', flow: '1', slug: 'a/1' },
      { project: 'b', flow: '2', slug: 'b/2' },
    ]);
    expect(stack).toEqual([{ project: 'a', flow: '1', slug: 'a/1' }]);
  });

  it('allows duplicate slugs (A→B→A)', () => {
    const stack: FlowStackEntry[] = [
      { project: 'a', flow: '1', slug: 'a/1' },
      { project: 'b', flow: '2', slug: 'b/2' },
    ];
    const next = computePushLink(stack, { project: 'a', flow: '1' });
    expect(next.length).toBe(3);
    expect(next.at(-1)?.slug).toBe('a/1');
  });
});

describe('computeResetStack', () => {
  it('returns a single-entry stack for a non-null target', () => {
    expect(computeResetStack({ project: 'p', flow: 'f' })).toEqual([
      { project: 'p', flow: 'f', slug: 'p/f' },
    ]);
  });

  it('returns an empty stack for a null target', () => {
    expect(computeResetStack(null)).toEqual([]);
  });
});

describe('computePopState', () => {
  const a: FlowStackEntry = { project: 'a', flow: '1', slug: 'a/1' };
  const b: FlowStackEntry = { project: 'b', flow: '2', slug: 'b/2' };
  const c: FlowStackEntry = { project: 'c', flow: '3', slug: 'c/3' };

  it('truncates to the recorded depth when the URL still matches the top', () => {
    expect(computePopState([a, b, c], 2, { project: 'b', flow: '2' })).toEqual([a, b]);
  });

  it('returns the empty stack when depth is 0 and the path no longer matches a flow', () => {
    expect(computePopState([a, b], 0, null)).toEqual([]);
  });

  it('returns null when depth is recorded but exceeds the live stack length (history drift)', () => {
    expect(computePopState([a], 5, { project: 'a', flow: '1' })).toBeNull();
  });

  it('returns null when depth is missing (legacy entry without stackDepth)', () => {
    expect(computePopState([a], undefined, { project: 'a', flow: '1' })).toBeNull();
  });

  it('returns null when truncated top mismatches the URL (forward-fix required)', () => {
    expect(computePopState([a, b], 2, { project: 'c', flow: '3' })).toBeNull();
  });

  it('returns null when depth>0 but the path is non-flow (drifted to /)', () => {
    expect(computePopState([a], 1, null)).toBeNull();
  });
});

describe('pushLink (effectful)', () => {
  it('appends the entry, pushes /projects/p/flows/f, stamps stackDepth, fires events', () => {
    const w = makeFakeWindow({ pathname: '/projects/a/flows/1', state: { stackDepth: 1 } });
    installWindow(w);
    __setFlowStackForTests([{ project: 'a', flow: '1', slug: 'a/1' }]);

    pushLink({ project: 'b', flow: '2' });

    expect(__getFlowStackForTests()).toEqual([
      { project: 'a', flow: '1', slug: 'a/1' },
      { project: 'b', flow: '2', slug: 'b/2' },
    ]);
    expect(w.pushStack).toEqual([{ state: { stackDepth: 2 }, url: '/projects/b/flows/2' }]);
    expect(w.events).toEqual(['seeflow:navigate', 'seeflow:flow-stack']);
  });
});

describe('popBack (effectful)', () => {
  it('delegates to window.history.back without touching the local stack', () => {
    const w = makeFakeWindow({ pathname: '/projects/a/flows/1', state: { stackDepth: 1 } });
    installWindow(w);
    __setFlowStackForTests([{ project: 'a', flow: '1', slug: 'a/1' }]);

    popBack();

    expect(w.backCalls).toBe(1);
    expect(__getFlowStackForTests()).toEqual([{ project: 'a', flow: '1', slug: 'a/1' }]);
    expect(w.pushStack).toEqual([]);
  });
});

describe('reset (effectful)', () => {
  it('replaces stack with [target] and pushes the new URL when pathname differs', () => {
    const w = makeFakeWindow({ pathname: '/projects/a/flows/1', state: { stackDepth: 1 } });
    installWindow(w);
    __setFlowStackForTests([{ project: 'a', flow: '1', slug: 'a/1' }]);

    reset({ project: 'b', flow: '2' });

    expect(__getFlowStackForTests()).toEqual([{ project: 'b', flow: '2', slug: 'b/2' }]);
    expect(w.pushStack).toEqual([{ state: { stackDepth: 1 }, url: '/projects/b/flows/2' }]);
    expect(w.replaceStack).toEqual([]);
    expect(w.events).toEqual(['seeflow:navigate', 'seeflow:flow-stack']);
  });

  it('replaces (not pushes) when pathname already matches the target — no new history entry', () => {
    const w = makeFakeWindow({ pathname: '/projects/b/flows/2', state: { stackDepth: 5 } });
    installWindow(w);
    __setFlowStackForTests([
      { project: 'a', flow: '1', slug: 'a/1' },
      { project: 'b', flow: '2', slug: 'b/2' },
    ]);

    reset({ project: 'b', flow: '2' });

    expect(__getFlowStackForTests()).toEqual([{ project: 'b', flow: '2', slug: 'b/2' }]);
    expect(w.pushStack).toEqual([]);
    expect(w.replaceStack).toEqual([{ state: { stackDepth: 1 }, url: '/projects/b/flows/2' }]);
    // navigate event suppressed (URL unchanged) but stack event fires (depth shrunk).
    expect(w.events).toEqual(['seeflow:flow-stack']);
  });

  it('clears stack to [] and pushes "/" when target is null', () => {
    const w = makeFakeWindow({ pathname: '/projects/a/flows/1', state: { stackDepth: 1 } });
    installWindow(w);
    __setFlowStackForTests([{ project: 'a', flow: '1', slug: 'a/1' }]);

    reset(null);

    expect(__getFlowStackForTests()).toEqual([]);
    expect(w.pushStack).toEqual([{ state: { stackDepth: 0 }, url: '/' }]);
    expect(w.events).toEqual(['seeflow:navigate', 'seeflow:flow-stack']);
  });

  it('on null target with pathname already "/", replaces state and suppresses navigate event', () => {
    const w = makeFakeWindow({ pathname: '/', state: { stackDepth: 1 } });
    installWindow(w);
    __setFlowStackForTests([{ project: 'a', flow: '1', slug: 'a/1' }]);

    reset(null);

    expect(__getFlowStackForTests()).toEqual([]);
    expect(w.pushStack).toEqual([]);
    expect(w.replaceStack).toEqual([{ state: { stackDepth: 0 }, url: '/' }]);
    expect(w.events).toEqual(['seeflow:flow-stack']);
  });
});

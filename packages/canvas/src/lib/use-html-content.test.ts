import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import {
  type HtmlContentState,
  _clearHtmlContentCacheForTest,
  _setHtmlContentForTest,
} from './use-html-content.ts';

/** Hook-shim renderer — drives `useState`'s lazy initializer once and returns
 *  whatever the hook returned. The `useEffect` shim makes the fetch path a
 *  no-op so we observe the snapshot the hook would render on its first paint
 *  (i.e. the cache lookup result). */
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useEffect: () => void;
};

function callHook<T>(fn: () => T): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = {
    useState: <S>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useEffect: () => {},
  };
  try {
    return fn();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

const { useHtmlContent } = await import('./use-html-content.ts');

beforeEach(() => {
  _clearHtmlContentCacheForTest();
});

afterEach(() => {
  _clearHtmlContentCacheForTest();
});

describe('useHtmlContent — cache lookup on first render (US-014)', () => {
  it('returns { kind: loading } when no cache entry exists', () => {
    const state = callHook<HtmlContentState>(() => useHtmlContent('p1', 'blocks/x.html'));
    expect(state.kind).toBe('loading');
  });

  it('returns a cached loaded state without fetching', () => {
    _setHtmlContentForTest('p1', 'blocks/x.html', {
      kind: 'loaded',
      html: '<p>cached</p>',
    });
    const state = callHook<HtmlContentState>(() => useHtmlContent('p1', 'blocks/x.html'));
    expect(state).toEqual({ kind: 'loaded', html: '<p>cached</p>' });
  });

  it('returns cached missing state for unknown htmlPaths', () => {
    _setHtmlContentForTest('p1', 'blocks/x.html', { kind: 'missing' });
    const state = callHook<HtmlContentState>(() => useHtmlContent('p1', 'blocks/x.html'));
    expect(state).toEqual({ kind: 'missing' });
  });

  it('returns { kind: loading } when projectId is undefined (waiting on runtime data)', () => {
    _setHtmlContentForTest('p1', 'blocks/x.html', {
      kind: 'loaded',
      html: '<p>x</p>',
    });
    const state = callHook<HtmlContentState>(() => useHtmlContent(undefined, 'blocks/x.html'));
    expect(state.kind).toBe('loading');
  });

  it('returns { kind: loading } when htmlPath is undefined', () => {
    const state = callHook<HtmlContentState>(() => useHtmlContent('p1', undefined));
    expect(state.kind).toBe('loading');
  });

  it('caches per (projectId, htmlPath) — different paths give independent results', () => {
    _setHtmlContentForTest('p1', 'a.html', { kind: 'loaded', html: 'A' });
    _setHtmlContentForTest('p1', 'b.html', { kind: 'loaded', html: 'B' });
    const a = callHook<HtmlContentState>(() => useHtmlContent('p1', 'a.html'));
    const b = callHook<HtmlContentState>(() => useHtmlContent('p1', 'b.html'));
    expect(a).toEqual({ kind: 'loaded', html: 'A' });
    expect(b).toEqual({ kind: 'loaded', html: 'B' });
  });

  it('caches per project — same htmlPath on different projects is keyed separately', () => {
    _setHtmlContentForTest('p1', 'x.html', { kind: 'loaded', html: 'one' });
    _setHtmlContentForTest('p2', 'x.html', { kind: 'loaded', html: 'two' });
    const a = callHook<HtmlContentState>(() => useHtmlContent('p1', 'x.html'));
    const b = callHook<HtmlContentState>(() => useHtmlContent('p2', 'x.html'));
    expect(a).toEqual({ kind: 'loaded', html: 'one' });
    expect(b).toEqual({ kind: 'loaded', html: 'two' });
  });

  it('_clearHtmlContentCacheForTest drops every cache entry', () => {
    _setHtmlContentForTest('p1', 'x.html', { kind: 'loaded', html: '<p>1</p>' });
    _clearHtmlContentCacheForTest();
    const state = callHook<HtmlContentState>(() => useHtmlContent('p1', 'x.html'));
    expect(state.kind).toBe('loading');
  });
});

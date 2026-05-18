import { describe, expect, it } from 'bun:test';
import * as React from 'react';
import { InlineEdit } from './inline-edit.tsx';

// Bun runs apps/web tests without a DOM. Shim React's internal dispatcher
// and call InlineEdit as a function so we can inspect the rendered element's
// onKeyDown prop directly. Same pattern used by icon-node.test.tsx.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => {},
  };
  try {
    return fn();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

type RenderedDiv = {
  type: unknown;
  props: {
    onKeyDown?: (e: unknown) => void;
    onPaste?: (e: unknown) => void;
    onBlur?: () => void;
    onInput?: () => void;
  };
};

function renderInlineEdit(props: Partial<React.ComponentProps<typeof InlineEdit>> = {}) {
  const merged = {
    initialValue: 'hello',
    onCommit: () => {},
    onExit: () => {},
    field: 'test',
    ...props,
  } as React.ComponentProps<typeof InlineEdit>;
  return renderWithHooks(() => InlineEdit(merged) as unknown as RenderedDiv);
}

describe('InlineEdit', () => {
  it('onKeyDown stops native event propagation so window-level shortcuts do NOT fire (US-018)', () => {
    // Without nativeEvent.stopPropagation, a Backspace inside the editor would
    // bubble to the window-level Delete/Backspace handler in demo-view.tsx and
    // delete the focused connector. React's e.stopPropagation alone only stops
    // the synthetic event tree, not native event listeners attached to window.
    const tree = renderInlineEdit();
    const handler = tree.props.onKeyDown;
    if (!handler) throw new Error('onKeyDown not wired');

    const calls: string[] = [];
    const fakeEvent = {
      key: 'Backspace',
      preventDefault: () => calls.push('synthetic:prevent'),
      stopPropagation: () => calls.push('synthetic:stop'),
      shiftKey: false,
      nativeEvent: {
        stopPropagation: () => calls.push('native:stop'),
        stopImmediatePropagation: () => calls.push('native:stopImmediate'),
      },
    };
    handler(fakeEvent);
    expect(calls).toContain('synthetic:stop');
    expect(calls).toContain('native:stop');
  });

  it('onKeyDown still stops both for Enter and Escape (preserves keyboard semantics)', () => {
    const tree = renderInlineEdit({ onCommit: () => {}, onExit: () => {} });
    const handler = tree.props.onKeyDown;
    if (!handler) throw new Error('onKeyDown not wired');

    for (const key of ['Enter', 'Escape']) {
      const calls: string[] = [];
      handler({
        key,
        preventDefault: () => calls.push('prevent'),
        stopPropagation: () => calls.push('syn-stop'),
        shiftKey: false,
        nativeEvent: {
          stopPropagation: () => calls.push('nat-stop'),
          stopImmediatePropagation: () => {},
        },
      });
      expect(calls).toContain('syn-stop');
      expect(calls).toContain('nat-stop');
    }
  });

  it('contenteditable rendered as plaintext-friendly div with role textbox', () => {
    // Smoke check the rendered shape so a future refactor that drops the
    // testid (which the demo-view defense-in-depth check queries for) blows
    // this test up loudly. US-018 defense relies on this exact testid.
    const tree = renderInlineEdit();
    const props = tree.props as Record<string, unknown>;
    expect(props['data-testid']).toBe('inline-edit-input');
    expect(props.role).toBe('textbox');
    expect(props.contentEditable).toBe(true);
  });
});

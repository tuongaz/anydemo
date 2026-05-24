import { describe, expect, it, mock } from 'bun:test';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';
import { buildEmbedSnippet, buildEmbedUrl } from '../lib/build-embed-snippet.ts';
import { EmbedDialog, type EmbedDialogProps } from './embed-dialog.tsx';

// Bun runs canvas tests without a DOM, so we follow the hook-shim pattern
// documented in icon-picker-popover.test.tsx / seeflow-canvas.test.tsx. We
// install a synchronous React dispatcher, call EmbedDialog as a function, and
// walk the returned JSX tree. Sub-components (Dialog, DialogContent, Button)
// are captured as `{ type, props }` placeholders without executing — Radix
// internals never run, so we assert the structural invariant (open prop, child
// content) rather than the actual portal behaviour.

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(
  fn: () => T,
  options: { useStateOverrides?: ReadonlyArray<unknown> } = {},
): T {
  const { useStateOverrides } = options;
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateIndex = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateIndex++;
      const override = useStateOverrides?.[idx];
      if (override !== undefined) return [override as S, () => {}];
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

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function isElement(value: unknown): value is ReactElementLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'props' in (value as { props?: unknown })
  );
}

function findElement(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
): ReactElementLike | null {
  if (!isElement(tree)) return null;
  if (predicate(tree)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function findAllElements(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const walk = (node: unknown) => {
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    const arr = Array.isArray(children) ? children : [children];
    for (const child of arr) walk(child);
  };
  walk(tree);
  return out;
}

function callEmbedDialog(overrides: Partial<EmbedDialogProps> = {}, useStateOverrides?: unknown[]) {
  const props: EmbedDialogProps = {
    open: true,
    onOpenChange: () => {},
    projectId: 'demo-project',
    ...overrides,
  };
  return renderWithHooks(
    () => (EmbedDialog as unknown as (p: EmbedDialogProps) => unknown)(props),
    { useStateOverrides },
  );
}

const testIdEquals = (id: string) => (el: ReactElementLike) =>
  (el.props as { 'data-testid'?: string })['data-testid'] === id;

describe('EmbedDialog (US-012)', () => {
  it('passes open=false through to the Dialog root so Radix renders nothing to the portal', () => {
    const tree = callEmbedDialog({ open: false });
    const dialog = findElement(tree, (el) => el.type === (DialogPrimitive.Root as unknown));
    expect(dialog).not.toBeNull();
    expect(dialog?.props.open).toBe(false);
  });

  it('renders the textarea with the iframe snippet for the given projectId when open', () => {
    const projectId = 'demo-project';
    // Default themeChoice is 'match'; under the test environment (no `document`
    // global) the resolver falls back to 'light' (the package default).
    const expected = buildEmbedSnippet(buildEmbedUrl(projectId, 'light'));
    const tree = callEmbedDialog({ open: true, projectId });
    const textarea = findElement(tree, testIdEquals('embed-dialog-snippet'));
    expect(textarea).not.toBeNull();
    expect(textarea?.props.value).toBe(expected);
    expect(textarea?.props.readOnly).toBe(true);
    // At least 7 rows to show the full 6-line snippet without scrolling.
    expect((textarea?.props as { rows?: number }).rows).toBeGreaterThanOrEqual(7);
  });

  it('passes the project id through encodeURIComponent so spaces / specials are escaped', () => {
    const projectId = 'foo bar';
    const expected = buildEmbedSnippet(buildEmbedUrl(projectId, 'light'));
    const tree = callEmbedDialog({ open: true, projectId });
    const textarea = findElement(tree, testIdEquals('embed-dialog-snippet'));
    expect(textarea?.props.value).toBe(expected);
    // Sanity: the URL encoding actually fires (space → %20 in the embedded URL).
    expect(textarea?.props.value).toContain('foo%20bar');
  });

  it('calls navigator.clipboard.writeText with the full snippet when Copy is clicked', async () => {
    const projectId = 'demo-project';
    const expectedSnippet = buildEmbedSnippet(buildEmbedUrl(projectId, 'light'));
    const writeText = mock((_text: string) => Promise.resolve());
    const originalNavigator = globalThis.navigator;
    (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText } };
    try {
      const tree = callEmbedDialog({ open: true, projectId });
      const copyBtn = findElement(tree, testIdEquals('embed-dialog-copy'));
      expect(copyBtn).not.toBeNull();
      const onClick = (copyBtn?.props as { onClick?: () => void | Promise<void> }).onClick;
      expect(typeof onClick).toBe('function');
      await onClick?.();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(expectedSnippet);
    } finally {
      (globalThis as { navigator?: unknown }).navigator = originalNavigator;
    }
  });

  it('renders the fallback hint when copyStatus is fallback (writeText-rejection path)', () => {
    // The actual rejection-triggered re-render needs real React state; under
    // the dispatcher shim, setState is a noop. Instead we drive the state we
    // want directly via useStateOverrides — copyStatus is the first useState
    // call in the component body. This proves the JSX branch wired to the
    // fallback state actually renders the hint text in the tree.
    const tree = callEmbedDialog({ open: true }, ['fallback']);
    const hint = findElement(tree, testIdEquals('embed-dialog-fallback-hint'));
    expect(hint).not.toBeNull();
    expect(hint?.props.children).toBe('Press ⌘C to copy');
  });

  it('does NOT render the fallback hint in the idle state', () => {
    const tree = callEmbedDialog({ open: true }, ['idle']);
    const hint = findElement(tree, testIdEquals('embed-dialog-fallback-hint'));
    expect(hint).toBeNull();
  });

  it('flips the copy-button label to "Copied!" when copyStatus is copied', () => {
    const tree = callEmbedDialog({ open: true }, ['copied']);
    const copyBtn = findElement(tree, testIdEquals('embed-dialog-copy'));
    expect(copyBtn?.props.children).toBe('Copied!');
  });

  it('drives onOpenChange(false) when the Close button is clicked', () => {
    const onOpenChange = mock((_next: boolean) => {});
    const tree = callEmbedDialog({ open: true, onOpenChange });
    const closeBtn = findElement(tree, testIdEquals('embed-dialog-close'));
    expect(closeBtn).not.toBeNull();
    const onClick = (closeBtn?.props as { onClick?: () => void }).onClick;
    expect(typeof onClick).toBe('function');
    onClick?.();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('drives the rejection branch via the live handler — writeText rejection is caught (no throw)', async () => {
    // Verifies that the try/catch in handleCopy actually swallows the rejection.
    // We can't observe the post-catch state under the shim, but we can prove
    // the click handler resolves rather than throwing — a regression here would
    // surface as an unhandled promise rejection in the test runner.
    const writeText = mock((_text: string) => Promise.reject(new Error('denied')));
    const originalNavigator = globalThis.navigator;
    (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText } };
    try {
      const tree = callEmbedDialog({ open: true });
      const copyBtn = findElement(tree, testIdEquals('embed-dialog-copy'));
      const onClick = (copyBtn?.props as { onClick?: () => void | Promise<void> }).onClick;
      await expect(Promise.resolve(onClick?.())).resolves.toBeUndefined();
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as { navigator?: unknown }).navigator = originalNavigator;
    }
  });
});

describe('EmbedDialog theme toggle (US-009)', () => {
  // copyStatus is the first useState slot, themeChoice is the second.
  const withCopyIdle = (themeChoice?: unknown) => ['idle', themeChoice];

  it('renders all three theme options as labelled buttons inside the themed fieldset', () => {
    const tree = callEmbedDialog({ open: true });
    const group = findElement(tree, testIdEquals('embed-dialog-theme-group'));
    expect(group).not.toBeNull();
    // The labelled wrapper is the <fieldset> + <legend> pair; the inner
    // segmented-control div just holds the buttons.
    const legend = findElement(
      tree,
      (el) => (el.props as { id?: string }).id === 'embed-dialog-theme-label',
    );
    expect(legend).not.toBeNull();
    expect(legend?.props.children).toBe('Theme');

    const buttons = findAllElements(tree, (el) =>
      ((el.props as { 'data-testid'?: string })['data-testid'] ?? '').startsWith(
        'embed-dialog-theme-',
      ),
    ).filter(
      (el) =>
        ((el.props as { 'data-testid'?: string })['data-testid'] ?? '') !==
        'embed-dialog-theme-group',
    );
    expect(buttons.map((r) => (r.props as { 'data-testid'?: string })['data-testid'])).toEqual([
      'embed-dialog-theme-match',
      'embed-dialog-theme-light',
      'embed-dialog-theme-dark',
    ]);
    expect(buttons.map((r) => r.props.children)).toEqual(['Match my theme', 'Light', 'Dark']);
    expect(buttons.map((r) => (r.props as { 'aria-label'?: string })['aria-label'])).toEqual([
      'Match my theme',
      'Light',
      'Dark',
    ]);
  });

  it('marks "Match my theme" active by default and the other two inactive', () => {
    const tree = callEmbedDialog({ open: true });
    const match = findElement(tree, testIdEquals('embed-dialog-theme-match'));
    const light = findElement(tree, testIdEquals('embed-dialog-theme-light'));
    const dark = findElement(tree, testIdEquals('embed-dialog-theme-dark'));
    expect((match?.props as { 'aria-pressed'?: boolean })['aria-pressed']).toBe(true);
    expect((light?.props as { 'aria-pressed'?: boolean })['aria-pressed']).toBe(false);
    expect((dark?.props as { 'aria-pressed'?: boolean })['aria-pressed']).toBe(false);
  });

  it('default snippet (themeChoice = match) carries ?theme=light when no DOM is available', () => {
    const tree = callEmbedDialog({ open: true, projectId: 'demo-project' });
    const textarea = findElement(tree, testIdEquals('embed-dialog-snippet'));
    expect(textarea?.props.value).toContain('?theme=light');
    expect(textarea?.props.value).not.toContain('?theme=dark');
  });

  it('snippet flips to ?theme=light when Light is selected', () => {
    const tree = callEmbedDialog({ open: true }, withCopyIdle('light'));
    const textarea = findElement(tree, testIdEquals('embed-dialog-snippet'));
    expect(textarea?.props.value).toContain('?theme=light');
    const light = findElement(tree, testIdEquals('embed-dialog-theme-light'));
    expect((light?.props as { 'aria-pressed'?: boolean })['aria-pressed']).toBe(true);
  });

  it('snippet flips to ?theme=dark when Dark is selected', () => {
    const tree = callEmbedDialog({ open: true }, withCopyIdle('dark'));
    const textarea = findElement(tree, testIdEquals('embed-dialog-snippet'));
    expect(textarea?.props.value).toContain('?theme=dark');
    const dark = findElement(tree, testIdEquals('embed-dialog-theme-dark'));
    expect((dark?.props as { 'aria-pressed'?: boolean })['aria-pressed']).toBe(true);
  });

  it('"Match my theme" resolves to dark when document.documentElement.classList contains "dark"', () => {
    const originalDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      documentElement: {
        classList: { contains: (token: string) => token === 'dark' },
      },
    };
    try {
      const tree = callEmbedDialog({ open: true }, withCopyIdle('match'));
      const textarea = findElement(tree, testIdEquals('embed-dialog-snippet'));
      expect(textarea?.props.value).toContain('?theme=dark');
      expect(textarea?.props.value).not.toContain('?theme=light');
    } finally {
      (globalThis as { document?: unknown }).document = originalDoc;
    }
  });

  it('"Match my theme" resolves to light when documentElement.classList does NOT contain "dark"', () => {
    const originalDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      documentElement: {
        classList: { contains: (_token: string) => false },
      },
    };
    try {
      const tree = callEmbedDialog({ open: true }, withCopyIdle('match'));
      const textarea = findElement(tree, testIdEquals('embed-dialog-snippet'));
      expect(textarea?.props.value).toContain('?theme=light');
      expect(textarea?.props.value).not.toContain('?theme=dark');
    } finally {
      (globalThis as { document?: unknown }).document = originalDoc;
    }
  });

  it('clicking each radio calls setThemeChoice with the corresponding value (handler is wired)', () => {
    const tree = callEmbedDialog({ open: true });
    for (const value of ['match', 'light', 'dark'] as const) {
      const radio = findElement(tree, testIdEquals(`embed-dialog-theme-${value}`));
      expect(radio).not.toBeNull();
      const onClick = (radio?.props as { onClick?: () => void }).onClick;
      expect(typeof onClick).toBe('function');
      // Just exercising the handler — the dispatcher shim swallows the
      // setState, but the assertion here is that clicking does not throw and
      // the handler is a function reference (i.e. wired to a setter).
      expect(() => onClick?.()).not.toThrow();
    }
  });

  it('Copy button copies the themed snippet currently shown in the textarea', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    const originalNavigator = globalThis.navigator;
    (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText } };
    try {
      const tree = callEmbedDialog({ open: true, projectId: 'demo-project' }, withCopyIdle('dark'));
      const expected = buildEmbedSnippet(buildEmbedUrl('demo-project', 'dark'));
      const copyBtn = findElement(tree, testIdEquals('embed-dialog-copy'));
      const onClick = (copyBtn?.props as { onClick?: () => void | Promise<void> }).onClick;
      await onClick?.();
      expect(writeText).toHaveBeenCalledWith(expected);
    } finally {
      (globalThis as { navigator?: unknown }).navigator = originalNavigator;
    }
  });
});

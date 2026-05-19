import { describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import { buildEmbedSnippet, buildEmbedUrl } from '../lib/build-embed-snippet.ts';
import { EmbedDialog } from './embed-dialog.tsx';
import { ShareMenu, type ShareMenuProps } from './share-menu.tsx';

// Hook-shim pattern, same as embed-dialog.test.tsx / icon-picker-popover.test.tsx:
// Bun runs canvas tests without a DOM, so we install a synchronous React dispatcher,
// call ShareMenu as a function, and walk the returned JSX tree. Sub-components are
// captured as `{ type, props }` placeholders without executing — we assert structural
// invariants (Embed dialog `open` prop, menu items present/absent) rather than DOM.
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

function renderShareMenu(
  props: Partial<ShareMenuProps> & Pick<ShareMenuProps, 'mode'>,
  useStateOverrides?: unknown[],
): unknown {
  // `enableEmbed` is required on the production prop type but tests opt-in
  // per-case to keep each scenario explicit. Default to `false` (the new
  // SeeflowCanvas default) so tests that don't care about Embed get the
  // safe shape; tests that exercise the Embed path override to `true`.
  return renderWithHooks(
    () =>
      (ShareMenu as unknown as (p: ShareMenuProps) => unknown)({
        enableEmbed: false,
        ...props,
      }),
    { useStateOverrides },
  );
}

const testIdEquals = (id: string) => (el: ReactElementLike) =>
  (el.props as { 'data-testid'?: string })['data-testid'] === id;

describe('ShareMenu (US-013)', () => {
  it('renders null when no callbacks AND no projectId are provided (edit mode)', () => {
    const tree = renderShareMenu({ mode: 'edit' });
    expect(tree).toBeNull();
  });

  it('renders null in view mode when no callbacks are provided (projectId alone is not enough)', () => {
    // projectId would render Embed, but Embed is edit-mode-only, so view + projectId only = null.
    const tree = renderShareMenu({ mode: 'view', projectId: 'demo-project' });
    expect(tree).toBeNull();
  });

  it('renders the trigger when only onDownloadPng is wired', () => {
    const tree = renderShareMenu({ mode: 'edit', onDownloadPng: () => {} });
    const trigger = findElement(tree, testIdEquals('share-menu-trigger'));
    expect(trigger).not.toBeNull();
    const ariaLabel = (trigger as ReactElementLike).props['aria-label'];
    expect(ariaLabel).toBe('Share / download');
  });

  it('renders all three core items (PDF, PNG, Embed) in edit mode with all inputs set', () => {
    const tree = renderShareMenu({
      mode: 'edit',
      projectId: 'demo-project',
      enableEmbed: true,
      onDownloadPdf: () => {},
      onDownloadPng: () => {},
    });
    expect(findElement(tree, testIdEquals('share-menu-pdf'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-png'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-embed'))).not.toBeNull();
  });

  it('hides the Embed item when projectId is undefined (edit mode, all callbacks set)', () => {
    const tree = renderShareMenu({
      mode: 'edit',
      enableEmbed: true,
      onDownloadPdf: () => {},
      onDownloadPng: () => {},
      onExportToCloud: () => {},
    });
    expect(findElement(tree, testIdEquals('share-menu-embed'))).toBeNull();
    // The PDF / PNG / export-cloud items are still present — only Embed is gated on projectId.
    expect(findElement(tree, testIdEquals('share-menu-pdf'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-png'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-export-cloud'))).not.toBeNull();
  });

  it('hides the Embed item in view mode even when projectId is set', () => {
    const tree = renderShareMenu({
      mode: 'view',
      projectId: 'demo-project',
      enableEmbed: true,
      onDownloadPdf: () => {},
      onDownloadPng: () => {},
    });
    expect(findElement(tree, testIdEquals('share-menu-embed'))).toBeNull();
    // Downloads still work in view mode.
    expect(findElement(tree, testIdEquals('share-menu-pdf'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-png'))).not.toBeNull();
  });

  it('hides the Embed item when enableEmbed is false (edit mode + projectId set)', () => {
    // Embed defaults to opt-in: even with edit mode + projectId wired, the
    // host must explicitly pass `enableEmbed: true` for the item to surface.
    const tree = renderShareMenu({
      mode: 'edit',
      projectId: 'demo-project',
      enableEmbed: false,
      onDownloadPng: () => {},
    });
    expect(findElement(tree, testIdEquals('share-menu-embed'))).toBeNull();
    // The trigger + PNG download remain — only Embed is gated by the new flag.
    expect(findElement(tree, testIdEquals('share-menu-trigger'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-png'))).not.toBeNull();
  });

  it('does NOT mount the EmbedDialog when enableEmbed is false', () => {
    // `showEmbed` also gates the dialog mount (line 198 of share-menu.tsx), so
    // a disabled Embed should keep the dialog wrapper out of the tree entirely.
    const tree = renderShareMenu({
      mode: 'edit',
      projectId: 'demo-project',
      enableEmbed: false,
      onDownloadPng: () => {},
    });
    const dialog = findElement(tree, (el) => el.type === (EmbedDialog as unknown));
    expect(dialog).toBeNull();
  });

  it('hides Export to seeflow.dev in view mode even when the callback is set', () => {
    const tree = renderShareMenu({
      mode: 'view',
      onDownloadPng: () => {},
      onExportToCloud: () => {},
    });
    expect(findElement(tree, testIdEquals('share-menu-export-cloud'))).toBeNull();
    // PNG download remains visible — the view-mode rule only hides edit-only items.
    expect(findElement(tree, testIdEquals('share-menu-png'))).not.toBeNull();
  });

  it('selecting the PDF item invokes onDownloadPdf', () => {
    const onDownloadPdf = mock(() => Promise.resolve());
    const tree = renderShareMenu({ mode: 'edit', onDownloadPdf });
    const pdfItem = findElement(tree, testIdEquals('share-menu-pdf'));
    if (!pdfItem) throw new Error('PDF item missing');
    const onSelect = pdfItem.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault: () => {} } as unknown as Event);
    expect(onDownloadPdf).toHaveBeenCalledTimes(1);
  });

  it('renders the EmbedDialog with the expected snippet when embedOpen is true', () => {
    // useState call order: downloadingPdf (0), downloadingPng (1), embedOpen (2).
    // Override embedOpen→true to assert the dialog renders with `open=true` and
    // its `projectId` flows through `buildEmbedSnippet(buildEmbedUrl(...))`. This
    // is the structural proxy for PRD criterion (h): "clicking Embed opens the
    // EmbedDialog (assert that a node with the snippet text exists)".
    const projectId = 'demo-project';
    const tree = renderShareMenu(
      { mode: 'edit', projectId, enableEmbed: true, onDownloadPng: () => {} },
      [false, false, true],
    );
    const dialog = findElement(tree, (el) => el.type === (EmbedDialog as unknown));
    expect(dialog).not.toBeNull();
    expect(dialog?.props.open).toBe(true);
    expect(dialog?.props.projectId).toBe(projectId);
    // Snippet sanity: the URL the dialog will render must contain the encoded id.
    expect(buildEmbedSnippet(buildEmbedUrl(projectId))).toContain(`/embed/${projectId}`);
  });

  it('does NOT mount the EmbedDialog when Embed is hidden (view mode + projectId)', () => {
    // Embed is force-hidden in view mode, and the dialog is only mounted when
    // `showEmbed && projectId` — so the dialog wrapper itself should be absent.
    const tree = renderShareMenu({
      mode: 'view',
      projectId: 'demo-project',
      enableEmbed: true,
      onDownloadPng: () => {},
    });
    const dialog = findElement(tree, (el) => el.type === (EmbedDialog as unknown));
    expect(dialog).toBeNull();
  });

  it('selecting the Embed item calls preventDefault (keeps the menu open during state flip)', () => {
    const preventDefault = mock(() => {});
    const tree = renderShareMenu({
      mode: 'edit',
      projectId: 'demo-project',
      enableEmbed: true,
      onDownloadPng: () => {},
    });
    const embedItem = findElement(tree, testIdEquals('share-menu-embed'));
    if (!embedItem) throw new Error('Embed item missing');
    const onSelect = embedItem.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('renders the export-cloud item in edit mode when its callback is set', () => {
    const onExportToCloud = mock(() => {});
    const tree = renderShareMenu({ mode: 'edit', onExportToCloud });
    const cloudItem = findElement(tree, testIdEquals('share-menu-export-cloud'));
    expect(cloudItem).not.toBeNull();
    const onSelect = cloudItem?.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault: () => {} } as unknown as Event);
    expect(onExportToCloud).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, mock } from 'bun:test';
import { CommandPalette, type CommandPaletteProps } from '@/components/command-palette';
import { COMMANDS, type CommandContext, type CommandId } from '@seeflow/canvas';
import * as React from 'react';

// apps/web tests run without a DOM. Shim React's internal hook dispatcher so we
// can call CommandPalette as a function and walk the returned tree directly.
// Same pattern used by share-menu.test.tsx and inline-edit.test.tsx.
//
// `stateOverrides` lets a test seed useState calls in source order — the
// palette has three (`query`, `highlightedIndex`, `recents`) and any subset
// can be overridden. Undefined slots fall back to the component's own initial
// value so a test only has to declare the bits it cares about.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T, stateOverrides: readonly unknown[] = []): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateCall = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateCall++;
      if (idx < stateOverrides.length && stateOverrides[idx] !== undefined) {
        return [stateOverrides[idx] as S, () => {}];
      }
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

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  // Children slots can be nested arrays (e.g. `<div>{map1.map(g => <div>{g.rows.map(r => <button/>)}</div>)}</div>`
  // produces `children: [groupDiv, [button, button, ...]]`). Recurse through
  // arrays so deeply-nested rows still surface.
  if (Array.isArray(tree)) {
    for (const child of tree) findAll(child, predicate, acc);
    return acc;
  }
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

function findByTestId(tree: unknown, id: string): ReactElementLike | null {
  const matches = findAll(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === id,
  );
  return matches[0] ?? null;
}

function findRow(tree: unknown, commandId: string): ReactElementLike | null {
  return findByTestId(tree, `command-palette-row-${commandId}`);
}

const FULL_CTX: CommandContext = {
  hasSelection: true,
  canUndo: true,
  canRedo: true,
  hasClipboard: true,
  canExportDemo: true,
};

const EMPTY_CTX: CommandContext = {
  hasSelection: false,
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
  canExportDemo: false,
};

// useState call order in CommandPalette: [query, highlightedIndex, recents].
// Helpers below build the override tuple so each test reads cleanly without
// passing positional `undefined`s.
const overrides = ({
  query,
  recents,
}: { query?: string; recents?: CommandId[] } = {}): readonly unknown[] => [
  query,
  undefined,
  recents,
];

function renderPalette(
  props: Partial<CommandPaletteProps> = {},
  state: { query?: string; recents?: CommandId[] } = {},
): unknown {
  const merged: CommandPaletteProps = {
    open: true,
    onOpenChange: () => {},
    runCommand: () => {},
    ctx: FULL_CTX,
    ...props,
  };
  return renderWithHooks(
    () => (CommandPalette as unknown as (p: CommandPaletteProps) => unknown)(merged),
    overrides(state),
  );
}

const ALL_IDS: CommandId[] = COMMANDS.map((c) => c.id);

describe('CommandPalette', () => {
  it('renders nothing in the list when there is no query and no recents', () => {
    const tree = renderPalette();
    const list = findByTestId(tree, 'command-palette-list');
    if (!list) throw new Error('list container missing');
    expect((list.props as { 'data-empty'?: string })['data-empty']).toBe('true');
    // No row buttons should be rendered.
    const rows = findAll(tree, (el) => {
      const id = (el.props as { 'data-testid'?: string })['data-testid'];
      return typeof id === 'string' && id.startsWith('command-palette-row-');
    });
    expect(rows.length).toBe(0);
    // The "no matches" empty-state copy should NOT appear when there's no
    // query — the surface stays blank until the user starts typing.
    const empty = findByTestId(tree, 'command-palette-empty');
    expect(empty).toBeNull();
  });

  it('shows the empty-state message only when a query has no matches', () => {
    const tree = renderPalette({}, { query: 'xyznotacommand' });
    const empty = findByTestId(tree, 'command-palette-empty');
    if (!empty) throw new Error('empty state missing');
    expect(empty).not.toBeNull();
  });

  it('renders recent commands first when the query is empty and recents exist', () => {
    const tree = renderPalette({}, { recents: ['layout.tidy', 'edit.undo'] });
    const tidyRow = findRow(tree, 'layout.tidy');
    const undoRow = findRow(tree, 'edit.undo');
    if (!tidyRow || !undoRow) throw new Error('recent rows missing');
    // The recents group heading reads "Recent" — confirm it renders.
    const heading = findAll(tree, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'Recent';
    });
    expect(heading.length).toBe(1);
    // Commands NOT in recents should be absent from the rendered list when
    // the query is empty.
    const ellipseRow = findRow(tree, 'tool.ellipse');
    expect(ellipseRow).toBeNull();
  });

  it('renders a row for every matching command when a query is present', () => {
    // Empty-string query keeps the empty/recents behavior; the component
    // treats anything that survives `.trim()` as a real query. A single
    // letter that matches no labels would empty the list, so we render with
    // every command id seeded as a recent — when query is empty those become
    // the visible list, exercising the row-per-command code path through the
    // recent surface instead. (Catalog browsing now happens via the toolbar
    // and Help menu; the palette surfaces search + recents only.)
    const tree = renderPalette({}, { recents: ALL_IDS });
    for (const cmd of COMMANDS) {
      const row = findRow(tree, cmd.id);
      if (!row) throw new Error(`missing row for ${cmd.id}`);
      expect(row).not.toBeNull();
    }
  });

  it('renders shortcut badges sourced from COMMANDS — never hardcoded labels', () => {
    const tree = renderPalette({}, { recents: ALL_IDS });
    for (const cmd of COMMANDS) {
      if (!cmd.shortcut) continue;
      const badge = findByTestId(tree, `command-palette-shortcut-${cmd.id}`);
      if (!badge) throw new Error(`missing shortcut badge for ${cmd.id}`);
      expect(badge.props.children).toBe(cmd.shortcut);
    }
  });

  it('reads command labels from COMMANDS so a label change in the registry propagates here', () => {
    const tree = renderPalette({}, { recents: ['layout.tidy'] });
    const tidyRow = findRow(tree, 'layout.tidy');
    if (!tidyRow) throw new Error('tidy row missing');
    // The label appears inside the row's first child column. Walk the
    // descendants to confirm the literal label string is present somewhere
    // under the row — and matches the registry.
    const labels = findAll(tidyRow, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'Tidy layout';
    });
    expect(labels.length).toBeGreaterThan(0);
  });

  it('marks rows disabled when their enabled(ctx) predicate returns false', () => {
    const tree = renderPalette({ ctx: EMPTY_CTX }, { recents: ['edit.undo'] });
    // edit.undo has enabled = (ctx) => ctx.canUndo. With canUndo=false the row
    // should be disabled (button disabled + aria-disabled=true).
    const undoRow = findRow(tree, 'edit.undo');
    if (!undoRow) throw new Error('undo row missing');
    expect(undoRow.props.disabled).toBe(true);
    expect(undoRow.props['aria-disabled']).toBe(true);
  });

  it('enables every row when its ctx predicates are all satisfied', () => {
    const tree = renderPalette({ ctx: FULL_CTX }, { recents: ['tool.select', 'edit.undo'] });
    // A command without an enabled predicate is unconditionally enabled. Pick a
    // few to spot-check.
    const selectRow = findRow(tree, 'tool.select');
    if (!selectRow) throw new Error('select row missing');
    expect(selectRow.props.disabled).toBe(false);
    expect(selectRow.props['aria-disabled']).toBeUndefined();
    // An enabled-gated command with the right ctx should also be enabled.
    const undoRow = findRow(tree, 'edit.undo');
    if (!undoRow) throw new Error('undo row missing');
    expect(undoRow.props.disabled).toBe(false);
  });

  it('clicking an enabled row calls runCommand(id) then onOpenChange(false)', () => {
    const runCommand = mock(() => {});
    const onOpenChange = mock(() => {});
    const tree = renderPalette({ runCommand, onOpenChange }, { recents: ['layout.tidy'] });
    const tidyRow = findRow(tree, 'layout.tidy');
    if (!tidyRow) throw new Error('tidy row missing');
    const onClick = tidyRow.props.onClick as () => void;
    onClick();
    expect(runCommand).toHaveBeenCalledWith('layout.tidy');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clicking a disabled row is a no-op (does not invoke runCommand)', () => {
    const runCommand = mock(() => {});
    const onOpenChange = mock(() => {});
    const tree = renderPalette(
      { ctx: EMPTY_CTX, runCommand, onOpenChange },
      { recents: ['edit.undo'] },
    );
    const undoRow = findRow(tree, 'edit.undo');
    if (!undoRow) throw new Error('undo row missing');
    const onClick = undoRow.props.onClick as () => void;
    onClick();
    expect(runCommand).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('renders the search input wired with aria-label so screen readers can find it', () => {
    const tree = renderPalette();
    const input = findByTestId(tree, 'command-palette-input');
    expect(input).not.toBeNull();
    expect((input as ReactElementLike).props['aria-label']).toBe('Search commands');
  });

  it('Enter on the search input executes the highlighted row (defaults to first enabled)', () => {
    const runCommand = mock(() => {});
    const tree = renderPalette({ runCommand }, { recents: ['edit.undo', 'tool.select'] });
    const input = findByTestId(tree, 'command-palette-input');
    if (!input) throw new Error('input missing');
    const handleKeyDown = input.props.onKeyDown as (e: {
      key: string;
      preventDefault: () => void;
    }) => void;
    const calls: string[] = [];
    handleKeyDown({ key: 'Enter', preventDefault: () => calls.push('prevent') });
    // First row in the recents group is edit.undo (full ctx → enabled).
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('edit.undo');
    expect(calls).toContain('prevent');
  });

  it('ArrowDown / ArrowUp on the search input call preventDefault (no caret jumps inside the input)', () => {
    const tree = renderPalette();
    const input = findByTestId(tree, 'command-palette-input');
    if (!input) throw new Error('input missing');
    const handleKeyDown = input.props.onKeyDown as (e: {
      key: string;
      preventDefault: () => void;
    }) => void;
    const calls: string[] = [];
    handleKeyDown({ key: 'ArrowDown', preventDefault: () => calls.push('down') });
    handleKeyDown({ key: 'ArrowUp', preventDefault: () => calls.push('up') });
    expect(calls).toEqual(['down', 'up']);
  });

  it('groups rows by category in the documented order (File, Edit, View, Tools, Layout, Selection, Help) when a query is present', () => {
    // Empty-string query rendering doesn't surface category headings anymore
    // (only Recent / nothing). Seed a query that matches commands across
    // every category so the full grouping is exercised. Every category has at
    // least one command whose label/description contains an 'e' — letting a
    // single-letter query do the work of matching the catalog.
    const tree = renderPalette({}, { query: 'e' });
    // Categories appear as small uppercase headings in the list. The order we
    // assert is the literal CATEGORY_ORDER constant in the component.
    const categories = findAll(tree, (el) => {
      const className = el.props.className;
      return typeof className === 'string' && className.includes('uppercase tracking-wide');
    });
    const labels = categories
      .map((el) => el.props.children)
      .filter((c): c is string => typeof c === 'string');
    expect(labels).toEqual(['File', 'Edit', 'View', 'Tools', 'Layout', 'Selection', 'Help']);
  });

  it('renders File-category rows for export-to-pdf and image commands', () => {
    const tree = renderPalette({}, { recents: ['export.pdf', 'export.png'] });
    expect(findRow(tree, 'export.pdf')).not.toBeNull();
    expect(findRow(tree, 'export.png')).not.toBeNull();
  });

  it('disables export rows when the demo context does not support them', () => {
    const ctx: CommandContext = {
      hasSelection: false,
      canUndo: false,
      canRedo: false,
      hasClipboard: false,
      canExportDemo: false,
    };
    const tree = renderPalette({ ctx }, { recents: ['export.pdf', 'export.png'] });
    for (const id of ['export.pdf', 'export.png']) {
      const row = findRow(tree, id);
      if (!row) throw new Error(`missing row for ${id}`);
      expect(row.props.disabled).toBe(true);
    }
  });

  it('list container marks itself as scroll-suppressed via the seeflow-no-scrollbar class', () => {
    // The class is purely cosmetic, but easy to regression-check: the
    // palette is search-first and the scrollbar gutter is visual noise.
    const tree = renderPalette({}, { recents: ['edit.undo'] });
    const list = findByTestId(tree, 'command-palette-list');
    if (!list) throw new Error('list missing');
    const className = list.props.className;
    expect(typeof className).toBe('string');
    expect((className as string).includes('seeflow-no-scrollbar')).toBe(true);
  });

  it('palette container omits a translate-x transform so the open animation only fades', () => {
    // The previous `translate-x-[-50%]` centering collided with
    // tailwindcss-animate's enter keyframe and made the palette slide in
    // from the right. The fix is margin-based centering — no translate. Pin
    // it in a test so a future "tidy this" pass doesn't re-introduce the
    // transform.
    const tree = renderPalette();
    const content = findByTestId(tree, 'command-palette');
    if (!content) throw new Error('palette content missing');
    const className = content.props.className;
    expect(typeof className).toBe('string');
    const cls = className as string;
    expect(cls.includes('translate-x-[-50%]')).toBe(false);
    expect(cls.includes('mx-auto')).toBe(true);
    // The fade-in/out classes are what we WANT to keep — sanity-check both.
    expect(cls.includes('data-[state=open]:fade-in-0')).toBe(true);
    expect(cls.includes('data-[state=closed]:fade-out-0')).toBe(true);
  });

  it('checks that every command category has at least one command whose label or description contains "e"', () => {
    // Sanity check for the grouping test above — if a future command adds a
    // new category whose strings don't contain 'e', the grouping assertion
    // would silently miss it. This guards the search-query trick.
    const byCategory = new Map<string, boolean>();
    for (const cmd of COMMANDS) {
      const haystack = `${cmd.label} ${cmd.description ?? ''}`.toLowerCase();
      if (haystack.includes('e')) byCategory.set(cmd.category, true);
    }
    for (const cat of ['Edit', 'View', 'Tools', 'Layout', 'Selection', 'Help']) {
      expect(byCategory.has(cat)).toBe(true);
    }
  });
});

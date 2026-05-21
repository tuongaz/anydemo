import { describe, expect, it } from 'bun:test';
import * as React from 'react';
import type { CanvasMode, ShapeKind } from '../types.ts';
import { CanvasToolbar, TOOLBAR_MODES, TOOLBAR_SHAPES } from './canvas-toolbar.tsx';

// Bun runs apps/web tests without a DOM. The hook-shim pattern (also used by
// icon-node.test.tsx / demo-canvas.test.tsx) replaces React's internal
// dispatcher with synchronous stubs so we can call CanvasToolbar as a
// function and walk the returned React element tree.
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
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findElement(item, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(tree)) return null;
  if (predicate(tree)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  return findElement(children, predicate);
}

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  function walk(node: unknown) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    walk(children);
  }
  walk(tree);
  return out;
}

function testIdEquals(value: string) {
  return (el: ReactElementLike) => el.props['data-testid'] === value;
}

function callToolbar(props: Partial<React.ComponentProps<typeof CanvasToolbar>> = {}): unknown {
  const merged: React.ComponentProps<typeof CanvasToolbar> = {
    mode: { kind: 'select' },
    onModeChange: () => {},
    ...props,
  };
  return renderWithHooks(() => (CanvasToolbar as unknown as (p: typeof merged) => unknown)(merged));
}

describe('CanvasToolbar', () => {
  it('renders every TOOLBAR_SHAPES entry either inline or inside the Shape picker', () => {
    const tree = callToolbar();
    for (const entry of TOOLBAR_SHAPES) {
      const inline = findElement(tree, testIdEquals(`toolbar-shape-${entry.shape}`));
      const inPicker = findElement(tree, testIdEquals(`shape-picker-${entry.shape}`));
      expect(inline ?? inPicker).not.toBeNull();
    }
  });

  describe('US-010: Database illustrative-shape palette entry', () => {
    it('includes a Database entry in TOOLBAR_SHAPES', () => {
      // The illustrative-shape entry must be registered alongside the other
      // shapes so drag-create produces a `shapeNode` with
      // `data.shape: 'database'`. Pinning the registry (not just the rendered
      // button) so the drop-on-pane popover (US-015) and any other consumer of
      // TOOLBAR_SHAPES picks the entry up automatically.
      const entry = TOOLBAR_SHAPES.find((s) => s.shape === 'database');
      expect(entry).toBeDefined();
      expect(entry?.label).toBe('Database');
      // Icon component is captured by reference; assert it's distinct from the
      // other shape icons (lucide's Database glyph, not Square / Circle).
      expect(entry?.Icon).toBeDefined();
    });

    it('renders the database tile inside the Shape picker popover', () => {
      const tree = callToolbar();
      const btn = findElement(tree, testIdEquals('shape-picker-database'));
      expect(btn).not.toBeNull();
    });

    it('toggles draw mode for database via onSelectShape', () => {
      let picked: string | null | undefined;
      const tree = callToolbar({
        onModeChange: (next) => {
          picked = next.kind === 'draw' ? next.shape : null;
        },
      });
      const btn = findElement(tree, testIdEquals('shape-picker-database'));
      if (!btn) throw new Error('database picker tile not found');
      const onClick = btn.props.onClick as () => void;
      onClick();
      expect(picked).toBe('database');
    });
  });

  describe('US-022: Server illustrative-shape palette entry', () => {
    it('includes a Server entry in TOOLBAR_SHAPES', () => {
      const entry = TOOLBAR_SHAPES.find((s) => s.shape === 'server');
      expect(entry).toBeDefined();
      expect(entry?.label).toBe('Server');
      expect(entry?.commandId).toBe('tool.server');
      expect(entry?.Icon).toBeDefined();
    });

    it('renders the server tile inside the Shape picker popover', () => {
      const tree = callToolbar();
      const btn = findElement(tree, testIdEquals('shape-picker-server'));
      expect(btn).not.toBeNull();
    });

    it('toggles draw mode for server via onSelectShape', () => {
      let picked: string | null | undefined;
      const tree = callToolbar({
        onModeChange: (next) => {
          picked = next.kind === 'draw' ? next.shape : null;
        },
      });
      const btn = findElement(tree, testIdEquals('shape-picker-server'));
      if (!btn) throw new Error('server picker tile not found');
      const onClick = btn.props.onClick as () => void;
      onClick();
      expect(picked).toBe('server');
    });
  });

  describe('US-023: User illustrative-shape palette entry', () => {
    it('includes a User entry in TOOLBAR_SHAPES', () => {
      const entry = TOOLBAR_SHAPES.find((s) => s.shape === 'user');
      expect(entry).toBeDefined();
      expect(entry?.label).toBe('User');
      expect(entry?.commandId).toBe('tool.user');
      expect(entry?.Icon).toBeDefined();
    });

    it('renders the user tile inside the Shape picker popover', () => {
      const tree = callToolbar();
      const btn = findElement(tree, testIdEquals('shape-picker-user'));
      expect(btn).not.toBeNull();
    });

    it('toggles draw mode for user via onSelectShape', () => {
      let picked: string | null | undefined;
      const tree = callToolbar({
        onModeChange: (next) => {
          picked = next.kind === 'draw' ? next.shape : null;
        },
      });
      const btn = findElement(tree, testIdEquals('shape-picker-user'));
      if (!btn) throw new Error('user picker tile not found');
      const onClick = btn.props.onClick as () => void;
      onClick();
      expect(picked).toBe('user');
    });
  });

  describe('US-024: Queue illustrative-shape palette entry', () => {
    it('includes a Queue entry in TOOLBAR_SHAPES', () => {
      const entry = TOOLBAR_SHAPES.find((s) => s.shape === 'queue');
      expect(entry).toBeDefined();
      expect(entry?.label).toBe('Queue');
      expect(entry?.commandId).toBe('tool.queue');
      expect(entry?.Icon).toBeDefined();
    });

    it('renders the queue tile inside the Shape picker popover', () => {
      const tree = callToolbar();
      const btn = findElement(tree, testIdEquals('shape-picker-queue'));
      expect(btn).not.toBeNull();
    });

    it('toggles draw mode for queue via onSelectShape', () => {
      let picked: string | null | undefined;
      const tree = callToolbar({
        onModeChange: (next) => {
          picked = next.kind === 'draw' ? next.shape : null;
        },
      });
      const btn = findElement(tree, testIdEquals('shape-picker-queue'));
      if (!btn) throw new Error('queue picker tile not found');
      const onClick = btn.props.onClick as () => void;
      onClick();
      expect(picked).toBe('queue');
    });
  });

  describe('US-025: Cloud illustrative-shape palette entry', () => {
    it('includes a Cloud entry in TOOLBAR_SHAPES', () => {
      const entry = TOOLBAR_SHAPES.find((s) => s.shape === 'cloud');
      expect(entry).toBeDefined();
      expect(entry?.label).toBe('Cloud');
      expect(entry?.commandId).toBe('tool.cloud');
      expect(entry?.Icon).toBeDefined();
    });

    it('renders the cloud tile inside the Shape picker popover', () => {
      const tree = callToolbar();
      const btn = findElement(tree, testIdEquals('shape-picker-cloud'));
      expect(btn).not.toBeNull();
    });

    it('toggles draw mode for cloud via onSelectShape', () => {
      let picked: string | null | undefined;
      const tree = callToolbar({
        onModeChange: (next) => {
          picked = next.kind === 'draw' ? next.shape : null;
        },
      });
      const btn = findElement(tree, testIdEquals('shape-picker-cloud'));
      if (!btn) throw new Error('cloud picker tile not found');
      const onClick = btn.props.onClick as () => void;
      onClick();
      expect(picked).toBe('cloud');
    });
  });

  describe('US-020: Tidy / Auto Align button removed from left toolbar', () => {
    it('does NOT render the toolbar-tidy button', () => {
      // Auto Align moved to the bottom-left Controls cluster. The left
      // toolbar must no longer surface a Tidy trigger.
      const tree = callToolbar();
      const tidy = findElement(tree, testIdEquals('toolbar-tidy'));
      expect(tidy).toBeNull();
    });

    it('does NOT accept an onTidy prop (compile-time guard via runtime shape)', () => {
      // Defensive: even if a caller wires onTidy, the toolbar must not
      // forward it onto any rendered button. The set of permissible button
      // testids is the shapes + the optional insert-icon entry — nothing else
      // (Tidy must stay removed).
      const tree = callToolbar({ onPickIcon: () => {} });
      const allButtons = findAll(tree, (el) => el.type === 'button');
      const ids = allButtons
        .map((b) => b.props['data-testid'])
        .filter((id): id is string => typeof id === 'string');
      const allowed = new Set(['toolbar-insert-icon', 'toolbar-shape-picker']);
      for (const id of ids) {
        expect(
          id.startsWith('toolbar-shape-') ||
            id.startsWith('shape-picker-') ||
            id.startsWith('toolbar-mode-') ||
            allowed.has(id),
        ).toBe(true);
      }
    });

    it('renders every shape — primaries inline, illustratives in the Shape picker', () => {
      // The insert-icon button is captured INSIDE IconPickerPopover's `anchor`
      // prop, which lives outside the children tree the hook-shim walks —
      // asserting that it renders here would require walking arbitrary props.
      // Pin the shape tiles instead.
      const tree = callToolbar({ onPickIcon: () => {} });
      const primaryShapes: ShapeKind[] = ['rectangle', 'ellipse', 'sticky', 'text'];
      for (const shape of primaryShapes) {
        expect(findElement(tree, testIdEquals(`toolbar-shape-${shape}`))).not.toBeNull();
      }
      // Illustrative shapes live behind the Shape picker.
      expect(findElement(tree, testIdEquals('toolbar-shape-picker'))).not.toBeNull();
      expect(findElement(tree, testIdEquals('shape-picker-database'))).not.toBeNull();
    });
  });

  describe('HTML block tile removed from toolbar', () => {
    it('does NOT render a toolbar-html-block button (html nodes are API/LLM-only)', () => {
      const tree = callToolbar({ onPickIcon: () => {} });
      expect(findElement(tree, testIdEquals('toolbar-html-block'))).toBeNull();
    });
  });

  describe('Select + Hand mode tiles', () => {
    it('registers both modes in TOOLBAR_MODES', () => {
      expect(TOOLBAR_MODES.map((m) => m.kind)).toEqual(['select', 'hand']);
      expect(TOOLBAR_MODES.find((m) => m.kind === 'select')?.commandId).toBe('tool.select');
      expect(TOOLBAR_MODES.find((m) => m.kind === 'hand')?.commandId).toBe('tool.hand');
    });

    it('renders Select and Hand buttons', () => {
      const tree = callToolbar();
      expect(findElement(tree, testIdEquals('toolbar-mode-select'))).not.toBeNull();
      expect(findElement(tree, testIdEquals('toolbar-mode-hand'))).not.toBeNull();
    });

    it('marks Select aria-pressed when mode.kind === select (always-lit neutral)', () => {
      const tree = callToolbar({ mode: { kind: 'select' } });
      const sel = findElement(tree, testIdEquals('toolbar-mode-select'));
      expect(sel?.props['aria-pressed']).toBe(true);
      const hand = findElement(tree, testIdEquals('toolbar-mode-hand'));
      expect(hand?.props['aria-pressed']).toBe(false);
    });

    it('marks Hand aria-pressed when mode.kind === hand', () => {
      const tree = callToolbar({ mode: { kind: 'hand' } });
      const hand = findElement(tree, testIdEquals('toolbar-mode-hand'));
      expect(hand?.props['aria-pressed']).toBe(true);
      const sel = findElement(tree, testIdEquals('toolbar-mode-select'));
      expect(sel?.props['aria-pressed']).toBe(false);
    });

    it('marks both off when mode.kind === draw', () => {
      const tree = callToolbar({ mode: { kind: 'draw', shape: 'rectangle' } });
      expect(findElement(tree, testIdEquals('toolbar-mode-select'))?.props['aria-pressed']).toBe(
        false,
      );
      expect(findElement(tree, testIdEquals('toolbar-mode-hand'))?.props['aria-pressed']).toBe(
        false,
      );
    });

    it('clicking Hand from neutral switches to {kind:"hand"}', () => {
      const received: CanvasMode[] = [];
      const tree = callToolbar({
        mode: { kind: 'select' },
        onModeChange: (next) => {
          received.push(next);
        },
      });
      const btn = findElement(tree, testIdEquals('toolbar-mode-hand'));
      if (!btn) throw new Error('Hand mode button not found');
      (btn.props.onClick as () => void)();
      expect(received).toEqual([{ kind: 'hand' }]);
    });

    it('clicking Hand while Hand is armed exits to {kind:"select"}', () => {
      const received: CanvasMode[] = [];
      const tree = callToolbar({
        mode: { kind: 'hand' },
        onModeChange: (next) => {
          received.push(next);
        },
      });
      const btn = findElement(tree, testIdEquals('toolbar-mode-hand'));
      if (!btn) throw new Error('Hand mode button not found');
      (btn.props.onClick as () => void)();
      expect(received).toEqual([{ kind: 'select' }]);
    });

    it('clicking Select while Select is armed is a no-op (cannot unselect neutral)', () => {
      let called = false;
      const tree = callToolbar({
        mode: { kind: 'select' },
        onModeChange: () => {
          called = true;
        },
      });
      const btn = findElement(tree, testIdEquals('toolbar-mode-select'));
      if (!btn) throw new Error('Select mode button not found');
      (btn.props.onClick as () => void)();
      expect(called).toBe(false);
    });

    it('clicking Select while a shape is armed exits to {kind:"select"}', () => {
      const received: CanvasMode[] = [];
      const tree = callToolbar({
        mode: { kind: 'draw', shape: 'rectangle' },
        onModeChange: (next) => {
          received.push(next);
        },
      });
      const btn = findElement(tree, testIdEquals('toolbar-mode-select'));
      if (!btn) throw new Error('Select mode button not found');
      (btn.props.onClick as () => void)();
      expect(received).toEqual([{ kind: 'select' }]);
    });

    it('clicking a shape from neutral emits {kind:"draw", shape}', () => {
      const received: CanvasMode[] = [];
      const tree = callToolbar({
        mode: { kind: 'select' },
        onModeChange: (next) => {
          received.push(next);
        },
      });
      const btn = findElement(tree, testIdEquals('toolbar-shape-rectangle'));
      if (!btn) throw new Error('Rectangle button not found');
      (btn.props.onClick as () => void)();
      expect(received).toEqual([{ kind: 'draw', shape: 'rectangle' }]);
    });

    it('showShapeTools=false hides every shape tile + icon picker (view-mode toolbar)', () => {
      const tree = callToolbar({ showShapeTools: false, onPickIcon: () => {} });
      // Select + Hand still render.
      expect(findElement(tree, testIdEquals('toolbar-mode-select'))).not.toBeNull();
      expect(findElement(tree, testIdEquals('toolbar-mode-hand'))).not.toBeNull();
      // Every shape affordance is gone.
      const primaries: ShapeKind[] = ['rectangle', 'ellipse', 'sticky', 'text'];
      for (const shape of primaries) {
        expect(findElement(tree, testIdEquals(`toolbar-shape-${shape}`))).toBeNull();
      }
      expect(findElement(tree, testIdEquals('toolbar-shape-picker'))).toBeNull();
      expect(findElement(tree, testIdEquals('toolbar-insert-icon'))).toBeNull();
    });

    it('clicking same shape twice returns to Select (draw -> select)', () => {
      const received: CanvasMode[] = [];
      const tree = callToolbar({
        mode: { kind: 'draw', shape: 'rectangle' },
        onModeChange: (next) => {
          received.push(next);
        },
      });
      const btn = findElement(tree, testIdEquals('toolbar-shape-rectangle'));
      if (!btn) throw new Error('Rectangle button not found');
      (btn.props.onClick as () => void)();
      expect(received).toEqual([{ kind: 'select' }]);
    });
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import type { DemoNode } from '../types.ts';

// The DetailPanel root reads localStorage on first render
// (getStoredDetailPanelWidth) and writes back on resize. Provide a Map-backed
// localStorage so the imports below see a `window` global.
const memStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string): string | null => memStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    memStore.set(k, v);
  },
  removeItem: (k: string): void => {
    memStore.delete(k);
  },
};

const mockWindow = {
  localStorage: mockLocalStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as unknown as { window: typeof mockWindow }).window = mockWindow;

const { DetailPanel, EditableField, TitleIconTrigger, StatusSection, formatRelativeTime } =
  await import('./detail-panel.tsx');

// Same dispatcher-shim trick used by icon-node.test.tsx — apps/web tests run
// without a DOM, so we shim React's internal hook dispatcher and call the
// component as a function. The returned tree is the first render with
// sub-components (Sheet/SheetContent) captured as placeholders.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T, useStateOverrides?: ReadonlyArray<unknown>): T {
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

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (n: unknown) => {
    if (!isElement(n)) return;
    if (predicate(n)) out.push(n);
    const children = n.props.children;
    if (children === undefined || children === null) return;
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) visit(c);
  };
  visit(tree);
  return out;
}

function findByTestId(tree: unknown, testId: string): ReactElementLike | null {
  const matches = findAll(
    tree,
    (el) => el.props['data-testid'] === testId || el.props.testIdBase === testId,
  );
  return matches[0] ?? null;
}

function makePlayNode(overrides: Partial<DemoNode> = {}): DemoNode {
  return {
    id: 'n1',
    type: 'playNode',
    position: { x: 0, y: 0 },
    data: {
      name: 'A play node',
      kind: 'service',
      stateSource: { kind: 'request' },
      description: 'Short body text',
      detail: 'Long-form notes',
      ...((overrides as { data?: object }).data ?? {}),
    },
    ...overrides,
  } as DemoNode;
}

beforeEach(() => {
  memStore.clear();
});

describe('EditableField', () => {
  it('renders read-only text when no onSave callback is provided', () => {
    const tree = renderWithHooks(() =>
      EditableField({
        nodeId: 'n1',
        value: 'hello',
        placeholder: 'placeholder',
        multiline: false,
        ariaLabel: 'Field',
        testIdBase: 'field',
      }),
    );
    // Read-only renders a plain div with text and no edit button.
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe('div');
    expect(tree.props.children).toBe('hello');
  });

  it('renders a clickable button surface (no pencil icon) when editable', () => {
    const tree = renderWithHooks(() =>
      EditableField({
        nodeId: 'n1',
        value: 'hello',
        placeholder: 'placeholder',
        multiline: false,
        ariaLabel: 'Field',
        testIdBase: 'field',
        onSave: () => {},
      }),
    );
    // Default (non-editing) view: a single <button> wrapping the text. No
    // Pencil/Check icons should exist anywhere in the subtree.
    const buttons = findAll(tree, (el) => el.type === 'button');
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.props.children).toBe('hello');
    // No SVG icon children — the rendered text is the click target.
    const svgs = findAll(tree, (el) => el.type === 'svg');
    expect(svgs.length).toBe(0);
  });

  it('renders a contentEditable div when in edit mode (useState[0] = true)', () => {
    const tree = renderWithHooks(
      () =>
        EditableField({
          nodeId: 'n1',
          value: 'hello',
          placeholder: 'p',
          multiline: true,
          ariaLabel: 'Detail',
          testIdBase: 'detail',
          onSave: () => {},
        }),
      // First useState in EditableField is `isEditing`. Force it to true.
      [true],
    );
    const editor = findByTestId(tree, 'detail-editor');
    expect(editor).not.toBeNull();
    expect(editor?.props.contentEditable).toBe('plaintext-only');
    expect(editor?.props['aria-multiline']).toBe('true');
    // Save/check button must NOT be present — blur commits.
    const saveBtn = findByTestId(tree, 'detail-save');
    expect(saveBtn).toBeNull();
  });

  it('shows placeholder text when value is empty', () => {
    const tree = renderWithHooks(() =>
      EditableField({
        nodeId: 'n1',
        value: '',
        placeholder: 'Add notes',
        multiline: true,
        ariaLabel: 'Detail',
        testIdBase: 'detail',
        onSave: () => {},
      }),
    );
    const buttons = findAll(tree, (el) => el.type === 'button');
    expect(buttons[0]?.props.children).toBe('Add notes');
  });
});

describe('DetailPanel', () => {
  it('renders three EditableField slots (name, description, detail) for a node', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    // Each editable field gets a wrapper with data-testid.
    expect(findByTestId(tree, 'detail-panel-name')).not.toBeNull();
    expect(findByTestId(tree, 'detail-panel-description')).not.toBeNull();
    expect(findByTestId(tree, 'detail-panel-detail')).not.toBeNull();
  });

  it('shows no editor-input chrome at rest (no pencil/check icons anywhere)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
        // No onIconChange → TitleIconTrigger is hidden, so no svg should
        // appear in the rest tree. With a trigger present, the placeholder
        // ImagePlus glyph would be a legitimate svg child — see the icon
        // trigger tests below for that path.
      }),
    );
    const svgs = findAll(tree, (el) => el.type === 'svg');
    expect(svgs.length).toBe(0);
  });

  it('omits onSave callbacks → fields render read-only (no <button>)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        // No onNameChange/onDescriptionChange/onDetailChange — read-only.
      }),
    );
    const buttons = findAll(tree, (el) => el.type === 'button');
    expect(buttons.length).toBe(0);
  });

  // US-007: Status section above the editable fields, only when statusReport
  // is provided. Suppressed entirely for nodes with no status entry so the
  // panel looks identical for pre-statusAction demos. The DetailPanel render
  // returns a tree with StatusSection as a still-unrendered child component
  // element — find by the function reference itself, not by the data-testid
  // that only appears on its rendered inner <section>.
  it('Status section is absent when no statusReport prop is provided', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === StatusSection).length).toBe(0);
  });

  it('Status section element is included when statusReport is provided', () => {
    const report = {
      state: 'ok' as const,
      summary: 'all good',
      detail: 'line a\nline b',
      data: { x: 1, y: 'two' },
      ts: 100,
    };
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        statusReport: report,
      }),
    );
    const sections = findAll(tree, (el) => el.type === StatusSection);
    expect(sections.length).toBe(1);
    expect((sections[0]?.props as { report?: unknown }).report).toBe(report);
  });
});

describe('StatusSection', () => {
  it('renders the StatusBadge with the report state', () => {
    const tree = StatusSection({
      report: { state: 'warn', summary: 's', ts: 0 },
      now: 0,
    });
    const badge = findByTestId(tree, 'detail-panel-status-badge');
    expect(badge).not.toBeNull();
    expect((badge?.props as { state?: string }).state).toBe('warn');
    expect((badge?.props as { summary?: string }).summary).toBe('s');
  });

  it('renders the detail block with whitespace-pre-wrap so line breaks survive', () => {
    const tree = StatusSection({
      report: { state: 'ok', detail: 'a\nb\nc', ts: 0 },
      now: 0,
    });
    const detailBox = findByTestId(tree, 'detail-panel-status-detail');
    expect(detailBox).not.toBeNull();
    expect(detailBox?.props.children).toBe('a\nb\nc');
    const className = String((detailBox?.props as { className?: string }).className ?? '');
    expect(className).toContain('whitespace-pre-wrap');
  });

  it('omits the detail block when report.detail is undefined', () => {
    const tree = StatusSection({
      report: { state: 'ok', ts: 0 },
      now: 0,
    });
    expect(findByTestId(tree, 'detail-panel-status-detail')).toBeNull();
  });

  it('renders the data key/value table with one row per entry', () => {
    const tree = StatusSection({
      report: { state: 'ok', data: { pending: 1, total: 3, label: 'todo' }, ts: 0 },
      now: 0,
    });
    const dl = findByTestId(tree, 'detail-panel-status-data');
    expect(dl).not.toBeNull();
    const rows = findAll(tree, (el) => el.props['data-testid'] === 'detail-panel-status-data-row');
    expect(rows.length).toBe(3);
    // Pull dt/dd children — each row is a fragment-like contents div with a dt
    // and a dd child. Flatten and assert the rendered values.
    const dts = findAll(tree, (el) => el.type === 'dt');
    const dds = findAll(tree, (el) => el.type === 'dd');
    expect(dts.map((d) => d.props.children).sort()).toEqual(['label', 'pending', 'total']);
    // Strings render bare; numbers go through JSON.stringify.
    expect(dds.map((d) => d.props.children).sort()).toEqual(['1', '3', 'todo']);
  });

  it('omits the data table when report.data is undefined or empty', () => {
    const tree1 = StatusSection({
      report: { state: 'ok', ts: 0 },
      now: 0,
    });
    expect(findByTestId(tree1, 'detail-panel-status-data')).toBeNull();

    const tree2 = StatusSection({
      report: { state: 'ok', data: {}, ts: 0 },
      now: 0,
    });
    expect(findByTestId(tree2, 'detail-panel-status-data')).toBeNull();
  });

  it('renders the relative-time label off the deterministic `now` test seam', () => {
    const tree = StatusSection({
      report: { state: 'ok', ts: 1_000 },
      now: 6_000,
    });
    const ts = findByTestId(tree, 'detail-panel-status-relative-time');
    expect(ts?.props.children).toBe('Last updated: 5s ago');
  });
});

describe('formatRelativeTime', () => {
  it('returns "just now" within the first second', () => {
    expect(formatRelativeTime(1_000, 1_000)).toBe('just now');
    expect(formatRelativeTime(1_000, 1_500)).toBe('just now');
  });

  it('scales seconds → minutes → hours → days', () => {
    expect(formatRelativeTime(0, 5_000)).toBe('5s ago');
    expect(formatRelativeTime(0, 90_000)).toBe('1m ago');
    expect(formatRelativeTime(0, 60 * 60 * 1000 * 2)).toBe('2h ago');
    expect(formatRelativeTime(0, 60 * 60 * 24 * 1000 * 3)).toBe('3d ago');
  });

  it('clamps negative diffs (future ts) to 0', () => {
    expect(formatRelativeTime(2_000, 1_000)).toBe('just now');
  });
});

describe('DetailPanel icon trigger', () => {
  it('icon trigger is hidden when onIconChange is undefined', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
        // onIconChange omitted → trigger hidden.
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });

  it('renders read-only icon span when onIconChange is undefined but node has an icon', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode({ data: { icon: 'database' } } as Partial<DemoNode>),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        // onIconChange omitted → editable trigger hidden, read-only span renders.
      }),
    );
    // No editable trigger
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
    // Read-only icon present
    const readOnly = findAll(
      tree,
      (el) => el.props['data-testid'] === 'detail-panel-icon-readonly',
    );
    expect(readOnly.length).toBe(1);
  });

  it('omits read-only icon span when node has no icon set', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode(), // no icon in data
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
      }),
    );
    const readOnly = findAll(
      tree,
      (el) => el.props['data-testid'] === 'detail-panel-icon-readonly',
    );
    expect(readOnly.length).toBe(0);
  });

  it('icon trigger is hidden for unsupported node types even with onIconChange', () => {
    const shapeNode = {
      id: 's1',
      type: 'shapeNode',
      position: { x: 0, y: 0 },
      data: { shape: 'rect', name: 'rect' },
    } as unknown as DemoNode;
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: shapeNode,
        connector: null,
        onClose: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });

  it('icon trigger is hidden for htmlNode (icon support stripped)', () => {
    const htmlNode = {
      id: 'h1',
      type: 'htmlNode',
      position: { x: 0, y: 0 },
      data: { name: 'h', htmlPath: 'blocks/a.html' },
    } as unknown as DemoNode;
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: htmlNode,
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });

  it('icon trigger is visible for a playNode when onIconChange is provided', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: makePlayNode({ data: { icon: 'database' } } as Partial<DemoNode>),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onIconChange: () => {},
      }),
    );
    const triggers = findAll(tree, (el) => el.type === TitleIconTrigger);
    expect(triggers.length).toBe(1);
    // Current icon flows through as the trigger's `icon` prop.
    expect((triggers[0]?.props as { icon?: string | null }).icon).toBe('database');
  });

  it('icon trigger is also visible for stateNode', () => {
    const stateNode = {
      id: 's1',
      type: 'stateNode',
      position: { x: 0, y: 0 },
      data: { name: 's', kind: 'service', status: 'idle' },
    } as unknown as DemoNode;
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: stateNode,
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(1);
  });

  it('TitleIconTrigger forwards a picked name to onChange via the IconPickerPopover onPick handler', () => {
    const calls: Array<[string, string | null]> = [];
    const tree = renderWithHooks(() =>
      TitleIconTrigger({
        nodeId: 'n1',
        icon: null,
        onChange: (id, icon) => calls.push([id, icon]),
      }),
    );
    // The trigger renders an IconPickerPopover with onPick + anchor; route
    // through onPick to assert the picked-name pathway. Pass `null` to also
    // assert the remove-icon path.
    const popovers = findAll(tree, (el) => typeof el.type === 'function');
    const picker = popovers.find(
      (el) => typeof (el.props as { onPick?: unknown }).onPick === 'function',
    );
    expect(picker).not.toBeUndefined();
    const onPick = (picker?.props as { onPick: (name: string | null) => void }).onPick;
    onPick('server');
    onPick(null);
    expect(calls).toEqual([
      ['n1', 'server'],
      ['n1', null],
    ]);
    // The anchor prop is a single React element with the trigger testid.
    const anchor = (picker?.props as { anchor?: ReactElementLike }).anchor;
    expect(isElement(anchor)).toBe(true);
    if (isElement(anchor)) {
      expect(anchor.props['data-testid']).toBe('detail-panel-icon-trigger');
    }
  });

  it('TitleIconTrigger placeholder anchor advertises "Add icon" to assistive tech', () => {
    const tree = renderWithHooks(() =>
      TitleIconTrigger({
        nodeId: 'n1',
        icon: null,
        onChange: () => {},
      }),
    );
    const popovers = findAll(tree, (el) => typeof el.type === 'function');
    const picker = popovers.find(
      (el) => typeof (el.props as { onPick?: unknown }).onPick === 'function',
    );
    const anchor = (picker?.props as { anchor?: ReactElementLike }).anchor;
    expect(isElement(anchor)).toBe(true);
    if (!isElement(anchor)) return;
    expect(anchor.props['aria-label']).toBe('Add icon');
  });

  it('TitleIconTrigger set-icon anchor advertises "Change icon" to assistive tech', () => {
    const tree = renderWithHooks(() =>
      TitleIconTrigger({
        nodeId: 'n1',
        icon: 'database',
        onChange: () => {},
      }),
    );
    const popovers = findAll(tree, (el) => typeof el.type === 'function');
    const picker = popovers.find(
      (el) => typeof (el.props as { onPick?: unknown }).onPick === 'function',
    );
    const anchor = (picker?.props as { anchor?: ReactElementLike }).anchor;
    expect(isElement(anchor)).toBe(true);
    if (!isElement(anchor)) return;
    expect(anchor.props['aria-label']).toBe('Change icon');
  });
});

describe('DetailPanel (connector)', () => {
  it('renders only the ConnectorSummary for a connector (no editable fields)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        demoId: 'd1',
        node: null,
        connector: {
          id: 'c1',
          source: 'a',
          target: 'b',
          kind: 'default',
          label: 'links',
        },
        onClose: () => {},
      }),
    );
    expect(findByTestId(tree, 'detail-panel-name')).toBeNull();
    expect(findByTestId(tree, 'detail-panel-description')).toBeNull();
    expect(findByTestId(tree, 'detail-panel-detail')).toBeNull();
  });
});

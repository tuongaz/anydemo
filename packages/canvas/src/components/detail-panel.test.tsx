import { beforeEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { IconRenderer } from '../components/icon-renderer.tsx';
import type { FlowNode } from '../types.ts';

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

const {
  DetailPanel,
  EditableField,
  HtmlNodeSection,
  TitleIconTrigger,
  readMermaidSource,
  extractMermaidSource,
} = await import('./detail-panel.tsx');

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
  useContext: <T>(context: unknown) => T;
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
    // DetailPanel + TitleIconTrigger read CanvasStudioContext (studioBaseUrl)
    // for vendor-icon IconRenderers; the shim returns the same-origin default.
    useContext: <T,>(_context: unknown) => ({ studioBaseUrl: '' }) as T,
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

function makeRectangleNode(overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id: 'n1',
    type: 'rectangle',
    position: { x: 0, y: 0 },
    data: {
      name: 'A rectangle node',
      description: 'Short body text',
      detail: 'Long-form notes',
      ...((overrides as { data?: object }).data ?? {}),
    },
    ...overrides,
  } as FlowNode;
}

// Canvas grouping M7: a group is a first-class node; the sidebar must expose its
// title (name), description, detail markdown, and an optional title-icon trigger.
function makeGroupNode(overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id: 'grp-1',
    type: 'group',
    position: { x: 0, y: 0 },
    data: {
      childIds: ['a', 'b'],
      name: 'My Group',
      description: 'Group description',
      detail: '## Group detail',
      ...((overrides as { data?: object }).data ?? {}),
    },
    ...overrides,
  } as FlowNode;
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
        flowId: 'd1',
        node: makeRectangleNode(),
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
        flowId: 'd1',
        node: makeRectangleNode(),
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

  it('omits onSave callbacks → fields render read-only (no edit <button>)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode(),
        connector: null,
        onClose: () => {},
        // No onNameChange/onDescriptionChange/onDetailChange — read-only.
      }),
    );
    // The panel always renders a close button as chrome — exclude it from the
    // count. What we're testing is that no EditableField rendered an enter-edit
    // button.
    const buttons = findAll(
      tree,
      (el) => el.type === 'button' && el.props['data-testid'] !== 'detail-panel-close',
    );
    expect(buttons.length).toBe(0);
  });

  it('renders empty-state placeholder when selectedNodeId is null', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: null,
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    const empty = findByTestId(tree, 'detail-panel-empty');
    expect(empty).not.toBeNull();
    expect(empty?.props.children).toBe('Select a node to inspect.');
    const className = String((empty?.props as { className?: string }).className ?? '');
    expect(className).toContain('sf:text-muted-foreground');
    expect(className).toContain('sf:text-sm');
    // No editable fields render in the empty branch.
    expect(findByTestId(tree, 'detail-panel-name')).toBeNull();
    expect(findByTestId(tree, 'detail-panel-description')).toBeNull();
    expect(findByTestId(tree, 'detail-panel-detail')).toBeNull();
  });

  it('does not render empty-state when selectedNodeId is set', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    expect(findByTestId(tree, 'detail-panel-empty')).toBeNull();
  });
});

// Canvas grouping M7 (design §4.1, §7.1): a selected group falls into the
// populated-node branch and reuses the same Name/Description/Detail editors +
// title-icon trigger as a rectangle — no new sidebar components, just type
// gating. These tests pin that a group flows through untouched.
describe('DetailPanel (group)', () => {
  it('is chrome-less: renders Description / Detail editors but NO Name/header row', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeGroupNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    // Populated branch (NOT the empty-state).
    expect(findByTestId(tree, 'detail-panel-empty')).toBeNull();
    // A group has no header → the editable Name row is suppressed.
    expect(findByTestId(tree, 'detail-panel-name')).toBeNull();
    // …but the description + detail metadata editors still render.
    expect(findByTestId(tree, 'detail-panel-description')).not.toBeNull();
    expect(findByTestId(tree, 'detail-panel-detail')).not.toBeNull();
  });

  it('hides the Name editor even when the group carries a data.name', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeGroupNode({ data: { childIds: [], name: 'Payments' } } as Partial<FlowNode>),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
      }),
    );
    // Chrome-less group → no visible Name editor regardless of data.name.
    expect(findByTestId(tree, 'detail-panel-name')).toBeNull();
    // The sr-only <h2> still announces the entity for accessibility.
    expect(findByTestId(tree, 'detail-panel-title')).not.toBeNull();
  });

  it('forwards the description + detail edit callbacks to the right EditableField slots', () => {
    const onDescription = () => {};
    const onDetail = () => {};
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeGroupNode(),
        connector: null,
        onClose: () => {},
        onDescriptionChange: onDescription,
        onDetailChange: onDetail,
      }),
    );
    expect(
      (findByTestId(tree, 'detail-panel-description')?.props as { onSave?: unknown }).onSave,
    ).toBe(onDescription);
    expect((findByTestId(tree, 'detail-panel-detail')?.props as { onSave?: unknown }).onSave).toBe(
      onDetail,
    );
  });

  it('renders the Detail editor in markdown mode (mermaid/markdown path)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeGroupNode(),
        connector: null,
        onClose: () => {},
        onDetailChange: () => {},
      }),
    );
    const detail = findByTestId(tree, 'detail-panel-detail');
    expect((detail?.props as { markdown?: boolean }).markdown).toBe(true);
  });

  it('does NOT render the title-icon trigger for a group (chrome-less, no header glyph)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeGroupNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });
});

describe('DetailPanel icon trigger', () => {
  it('icon trigger is hidden when onIconChange is undefined', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode(),
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
        flowId: 'd1',
        node: makeRectangleNode({ data: { icon: 'database' } } as Partial<FlowNode>),
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

  it('routes a vendor-prefixed read-only icon through IconRenderer (not the ? fallback)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode({ data: { icon: 'gcp:cloud-run' } } as Partial<FlowNode>),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
      }),
    );
    const renderers = findAll(tree, (el) => el.type === IconRenderer);
    expect(renderers.length).toBe(1);
    const props = renderers[0]?.props as { iconId?: string; studioBaseUrl?: string };
    expect(props.iconId).toBe('gcp:cloud-run');
    expect(props.studioBaseUrl).toBe('');
  });

  it('omits read-only icon span when node has no icon set', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode(), // no icon in data
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

  it('icon trigger is hidden for non-rectangle geometric types even with onIconChange', () => {
    // Database (one of the 8 non-rectangle geometric tags) parses + persists
    // the `icon` field but the renderer doesn't surface it, so the detail
    // panel hides the trigger too. Capability-chrome-rectangle-only invariant
    // extends to the icon row.
    const databaseNode = {
      id: 's1',
      type: 'database',
      position: { x: 0, y: 0 },
      data: { name: 'db' },
    } as unknown as FlowNode;
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: databaseNode,
        connector: null,
        onClose: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });

  it('icon trigger is hidden for type:"html" (no header icon affordance)', () => {
    const htmlFixture = {
      id: 'h1',
      type: 'html',
      position: { x: 0, y: 0 },
      data: { name: 'h', html: '<div>hi</div>' },
    } as unknown as FlowNode;
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: htmlFixture,
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });

  it('icon trigger is hidden for type:"image" (no header icon affordance)', () => {
    const imageFixture = {
      id: 'i1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { name: 'img', path: 'nodes/i1/pic.png', alt: 'pic' },
    } as unknown as FlowNode;
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: imageFixture,
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });

  // The replace-image picker is a child component (ImageReplaceSection), so the
  // synchronous shim leaves it as an unexpanded element — match it by type and,
  // for behaviour, render that element's type fn directly.
  const imageFixture = {
    id: 'i1',
    type: 'image',
    position: { x: 0, y: 0 },
    data: { name: 'img', path: 'nodes/i1/pic.png', alt: 'pic' },
  } as unknown as FlowNode;
  const findReplaceSection = (tree: unknown) =>
    findAll(
      tree,
      (el) =>
        typeof el.type === 'function' &&
        (el.type as { name?: string }).name === 'ImageReplaceSection',
    );

  it('shows the Replace-image picker only when onReplaceImage is wired for an image node', () => {
    const withCb = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: imageFixture,
        connector: null,
        onClose: () => {},
        onReplaceImage: () => {},
      }),
    );
    const withoutCb = renderWithHooks(() =>
      DetailPanel({ flowId: 'd1', node: imageFixture, connector: null, onClose: () => {} }),
    );
    expect(findReplaceSection(withCb).length).toBe(1);
    expect(findReplaceSection(withoutCb).length).toBe(0);
  });

  it('dispatches onReplaceImage with the picked file', () => {
    const calls: Array<{ id: string; name: string }> = [];
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: imageFixture,
        connector: null,
        onClose: () => {},
        onReplaceImage: (id, file) => calls.push({ id, name: file.name }),
      }),
    );
    const section = findReplaceSection(tree)[0];
    if (!section) throw new Error('ImageReplaceSection missing');
    const rendered = (section.type as (p: unknown) => unknown)(section.props);
    const input = findAll(rendered, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'detail-panel-image-replace-input';
    })[0];
    if (!input) throw new Error('replace-image input missing');
    const file = { name: 'new.png' } as File;
    (input.props as { onChange: (e: unknown) => void }).onChange({
      target: { files: [file], value: '' },
    });
    expect(calls).toEqual([{ id: 'i1', name: 'new.png' }]);
  });

  it('icon trigger is hidden for type:"icon" (icon IS the visual, not a header glyph)', () => {
    const iconFixture = {
      id: 'ic1',
      type: 'icon',
      position: { x: 0, y: 0 },
      data: { icon: 'server', name: 'i' },
    } as unknown as FlowNode;
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: iconFixture,
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onIconChange: () => {},
      }),
    );
    expect(findAll(tree, (el) => el.type === TitleIconTrigger).length).toBe(0);
  });

  it('icon trigger is visible for a rectangle node when onIconChange is provided', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode({ data: { icon: 'database' } } as Partial<FlowNode>),
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

  it('icon trigger is visible for a rectangle carrying an extra capability field', () => {
    // The icon-trigger condition is type-based, not capability-based; this test
    // guards that an extra optional capability field on data doesn't
    // accidentally hide the trigger.
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode({
          data: {
            handlerModule: 'handlers/foo.ts',
          },
        } as Partial<FlowNode>),
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

describe('HtmlNodeSection', () => {
  it('displays the node-relative htmlPath (no nodes/<id>/ prefix)', () => {
    const tree = renderWithHooks(() =>
      HtmlNodeSection({
        adapter: null,
        nodeId: 'node-XwygzfKPZ5',
        htmlPath: 'view.html',
      }),
    );
    const pathEl = findByTestId(tree, 'detail-panel-html-path');
    expect(pathEl).not.toBeNull();
    expect(pathEl?.props.children).toBe('view.html');
  });

  it('reattaches the nodes/<id>/ prefix when invoking adapter.openFile', async () => {
    const openCalls: string[] = [];
    const adapter = {
      openFile: async (p: string) => {
        openCalls.push(p);
      },
    } as Partial<import('../adapter/types.ts').CanvasAdapter>;
    const tree = renderWithHooks(() =>
      HtmlNodeSection({
        adapter: adapter as import('../adapter/types.ts').CanvasAdapter,
        nodeId: 'node-XwygzfKPZ5',
        htmlPath: 'view.html',
      }),
    );
    const openBtn = findByTestId(tree, 'detail-panel-html-open');
    expect(openBtn).not.toBeNull();
    const onClick = openBtn?.props.onClick as () => void;
    onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(openCalls).toEqual(['nodes/node-XwygzfKPZ5/view.html']);
  });

  it('reattaches the nodes/<id>/ prefix when invoking adapter.revealFile', async () => {
    const revealCalls: string[] = [];
    const adapter = {
      revealFile: async (p: string) => {
        revealCalls.push(p);
      },
    } as Partial<import('../adapter/types.ts').CanvasAdapter>;
    const tree = renderWithHooks(() =>
      HtmlNodeSection({
        adapter: adapter as import('../adapter/types.ts').CanvasAdapter,
        nodeId: 'node-XwygzfKPZ5',
        htmlPath: 'view.html',
      }),
    );
    const revealBtn = findByTestId(tree, 'detail-panel-html-reveal');
    expect(revealBtn).not.toBeNull();
    const onClick = revealBtn?.props.onClick as () => void;
    onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(revealCalls).toEqual(['nodes/node-XwygzfKPZ5/view.html']);
  });
});

describe('DetailPanel description vs detail color tokens', () => {
  // The description must read as a muted gray ("subtitle" tier), and the
  // detail must read as the foreground tone — so under dark theme the two
  // fields don't blur into each other visually. The textClassName props on
  // each EditableField are the source of truth for both colors.
  it('description EditableField textClassName uses text-muted-foreground', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    const desc = findByTestId(tree, 'detail-panel-description');
    expect(desc).not.toBeNull();
    const className = String((desc?.props as { textClassName?: string }).textClassName ?? '');
    expect(className).toContain('sf:text-muted-foreground');
  });

  it('detail EditableField textClassName uses the brighter text-foreground tone', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: makeRectangleNode(),
        connector: null,
        onClose: () => {},
        onNameChange: () => {},
        onDescriptionChange: () => {},
        onDetailChange: () => {},
      }),
    );
    const detail = findByTestId(tree, 'detail-panel-detail');
    expect(detail).not.toBeNull();
    const className = String((detail?.props as { textClassName?: string }).textClassName ?? '');
    expect(className).toContain('sf:text-foreground');
    // Guard against accidental regression to the muted-foreground gray —
    // that would make the field visually indistinguishable from description.
    expect(className).not.toContain('sf:text-muted-foreground');
  });
});

describe('Mermaid markdown helpers', () => {
  it('readMermaidSource strips the trailing newline from a string child', () => {
    expect(readMermaidSource('graph LR\nA --> B\n')).toBe('graph LR\nA --> B');
  });

  it('readMermaidSource flattens an array of string children', () => {
    expect(readMermaidSource(['graph LR\n', 'A --> B\n'])).toBe('graph LR\nA --> B');
  });

  it('readMermaidSource coerces undefined / null to an empty string', () => {
    expect(readMermaidSource(undefined as unknown as React.ReactNode)).toBe('');
    expect(readMermaidSource(null as unknown as React.ReactNode)).toBe('');
  });

  it('extractMermaidSource returns null when children is not a code element', () => {
    expect(extractMermaidSource('plain text')).toBeNull();
    expect(extractMermaidSource(null as unknown as React.ReactNode)).toBeNull();
  });

  it('extractMermaidSource returns null when className is not language-mermaid', () => {
    const code = React.createElement('code', { className: 'language-ts' }, 'const x = 1;\n');
    expect(extractMermaidSource(code)).toBeNull();
  });

  it('extractMermaidSource returns the inner source when children is a mermaid code element', () => {
    const code = React.createElement(
      'code',
      { className: 'language-mermaid' },
      'graph TD\nA-->B\n',
    );
    expect(extractMermaidSource(code)).toBe('graph TD\nA-->B');
  });
});

describe('DetailPanel (connector)', () => {
  it('renders only the ConnectorSummary for a connector (no editable fields)', () => {
    const tree = renderWithHooks(() =>
      DetailPanel({
        flowId: 'd1',
        node: null,
        connector: {
          id: 'c1',
          source: 'a',
          target: 'b',
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

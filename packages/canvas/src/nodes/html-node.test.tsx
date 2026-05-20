import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Window } from 'happy-dom';

// Install a happy-dom DOMParser globally BEFORE the sanitizer + renderer are
// imported so the trust boundary in inject-sanitized-html.ts can actually
// parse HTML during these tests. Mirrors the pattern documented in
// `sanitize-html.test.ts` (US-013).
const window = new Window();
(globalThis as { DOMParser?: unknown }).DOMParser = window.DOMParser;

const { HtmlNode } = await import('./html-node.tsx');
const { PlaceholderCard } = await import('./placeholder-card.tsx');
const { Icon } = await import('../ui/icon.tsx');
const { COLOR_TOKENS } = await import('../lib/color-tokens.ts');
const { _setHtmlContentForTest, _clearHtmlContentCacheForTest } = await import(
  '../lib/use-html-content.ts'
);

import { Handle, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import * as React from 'react';

// Hook-shim renderer pattern documented in image-node.test.tsx /
// shape-node.test.tsx. Bun's test runtime has no DOM and xyflow's <Handle>
// reads from a zustand store, so we walk the JSX tree directly.
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

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (node: unknown) => {
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) visit(c);
  };
  visit(tree);
  return out;
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

const SAMPLE_PROJECT_ID = 'p1';
const SAMPLE_PATH = 'blocks/sample.html';
const INNER_HTML_PROP = 'dangerously' + 'SetInnerHTML';

function readInnerHtml(el: ReactElementLike | null): string | undefined {
  if (!el) return undefined;
  const propBag = el.props as Record<string, unknown>;
  const value = propBag[INNER_HTML_PROP] as { __html?: string } | undefined;
  return value?.__html;
}

function callHtmlNode(
  data: Record<string, unknown> = {},
  overrides: Partial<NodeProps> = {},
): unknown {
  const props = {
    id: 'h1',
    type: 'htmlNode',
    data: { htmlPath: SAMPLE_PATH, projectId: SAMPLE_PROJECT_ID, ...data },
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
    ...overrides,
  } as unknown as NodeProps;
  const impl = (HtmlNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

function getContainerStyle(tree: unknown): CSSProperties {
  const container = findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'html-node';
  });
  if (!container) throw new Error('html-node container missing');
  return (container.props as { style?: CSSProperties }).style ?? {};
}

// Chrome (border / bg / radius / font / textColor) lives on the inner wrapper
// so its `overflow:hidden` clips author HTML to the rounded corners without
// also clipping the connector handles + resize corners on the outer wrapper.
function getChromeStyle(tree: unknown): CSSProperties {
  const chrome = findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'html-node-chrome';
  });
  if (!chrome) throw new Error('html-node-chrome wrapper missing');
  return (chrome.props as { style?: CSSProperties }).style ?? {};
}

function findContent(tree: unknown): ReactElementLike | null {
  return findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'html-node-content';
  });
}

// The hook-shim renderer doesn't recurse into function components, so the
// rendered tree contains a React element whose `type` is the PlaceholderCard
// function itself — match on that, then read `message` / `variant` off the
// element's props (the values we passed at the call site).
function findPlaceholder(tree: unknown): ReactElementLike | null {
  return findElement(tree, (el) => el.type === PlaceholderCard);
}

beforeEach(() => {
  _clearHtmlContentCacheForTest();
});

afterEach(() => {
  _clearHtmlContentCacheForTest();
});

describe('HtmlNode connect handles (US-014)', () => {
  it('renders all four <Handle> elements when isConnectable is true', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const tree = callHtmlNode();
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('still renders four handles when selected (opacity toggle, not gated render)', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const tree = callHtmlNode({}, { selected: true } as Partial<NodeProps>);
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });
});

describe('HtmlNode content render (US-014)', () => {
  it('renders sanitized author HTML when content is loaded', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p class="rounded-lg">hello</p>',
    });
    const tree = callHtmlNode();
    const content = findContent(tree);
    expect(content).not.toBeNull();
    expect(readInnerHtml(content)).toBe('<p class="rounded-lg">hello</p>');
  });

  it('strips <script> tags from author HTML before injection', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>safe</p><script>alert(1)</script>',
    });
    const tree = callHtmlNode();
    expect(readInnerHtml(findContent(tree))).toBe('<p>safe</p>');
  });

  it('strips on*= event-handler attributes', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<button onclick="alert(1)">x</button>',
    });
    const tree = callHtmlNode();
    expect(readInnerHtml(findContent(tree))).toBe('<button>x</button>');
  });
});

describe('HtmlNode missing-file state (US-014)', () => {
  it('renders PlaceholderCard with "Missing: <path>" when kind is missing', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, { kind: 'missing' });
    const tree = callHtmlNode();
    const placeholder = findPlaceholder(tree);
    expect(placeholder).not.toBeNull();
    const props = placeholder?.props as { message?: string; variant?: string };
    expect(props.message).toBe(`Missing: ${SAMPLE_PATH}`);
    expect(props.variant).toBe('destructive');
    // No injected content element in the missing-file branch.
    expect(findContent(tree)).toBeNull();
  });

  it('renders an error PlaceholderCard when kind is error', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'error',
      message: 'network down',
    });
    const tree = callHtmlNode();
    const placeholder = findPlaceholder(tree);
    expect(placeholder).not.toBeNull();
    const props = placeholder?.props as { message?: string; variant?: string };
    expect(props.message).toBe('Error: network down');
    expect(props.variant).toBe('destructive');
  });

  it('renders a loading PlaceholderCard before the cache primes', () => {
    // No `_setHtmlContentForTest` call — the cache is empty, so the lazy
    // useState initializer falls back to { kind: 'loading' }.
    const tree = callHtmlNode();
    const placeholder = findPlaceholder(tree);
    expect(placeholder).not.toBeNull();
    const props = placeholder?.props as { message?: string };
    expect(props.message).toBe('Loading…');
  });
});

describe('HtmlNode wrapper style (US-014)', () => {
  it('omits color tokens from chrome style when fields are unset', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const style = getChromeStyle(callHtmlNode());
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderStyle).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
  });

  it('applies border + background tokens to the chrome wrapper when fields are set', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const style = getChromeStyle(
      callHtmlNode({
        backgroundColor: 'blue',
        borderColor: 'amber',
        borderSize: 2,
        borderStyle: 'dashed',
        cornerRadius: 8,
      }),
    );
    expect(style.backgroundColor).toBe(COLOR_TOKENS.blue.background);
    expect(style.borderColor).toBe(COLOR_TOKENS.amber.border);
    expect(style.borderWidth).toBe(2);
    expect(style.borderStyle).toBe('dashed');
    expect(style.borderRadius).toBe(8);
  });

  it('falls back to default width/height during auto-size placeholder phase (content not loaded)', () => {
    // No _setHtmlContentForTest — cache empty → content.kind stays 'loading'.
    // In auto-size mode the measuring container isn't present, so React Flow
    // has nothing to size to; the renderer pins HTML_DEFAULT_SIZE so the
    // placeholder card has a sensible bounding box.
    const style = getContainerStyle(callHtmlNode());
    expect(style.width).toBe(320);
    expect(style.height).toBe(200);
  });

  it('omits default width/height once the author has sized the node', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const style = getContainerStyle(callHtmlNode({ width: 480, height: 360 }));
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
  });

  // Regression: previously the OUTER wrapper carried `sf:overflow-hidden`,
  // which clipped the four connector handles and the four resize corners when
  // a selected node's CSS transforms pushed them 8px outward (see
  // styles/index.css). Clipping must live on the INNER chrome wrapper instead.
  it('keeps overflow-hidden on the inner chrome wrapper, not the outer', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const tree = callHtmlNode();
    const outer = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'html-node';
    });
    const chrome = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'html-node-chrome';
    });
    expect(outer).not.toBeNull();
    expect(chrome).not.toBeNull();
    const outerClass = (outer?.props as { className?: string }).className ?? '';
    const chromeClass = (chrome?.props as { className?: string }).className ?? '';
    expect(outerClass).not.toContain('sf:overflow-hidden');
    expect(chromeClass).toContain('sf:overflow-hidden');
  });
});

describe('HtmlNode label (US-014)', () => {
  it('renders a label element below the content when data.name is set', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const tree = callHtmlNode({ name: 'Welcome card' });
    const label = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'html-node-label';
    });
    expect(label).not.toBeNull();
    expect((label?.props as { children?: unknown }).children).toBe('Welcome card');
  });

  it('omits the label element when data.name is absent', () => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
    const tree = callHtmlNode();
    const label = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'html-node-label';
    });
    expect(label).toBeNull();
  });
});

function findLabel(tree: unknown): ReactElementLike | null {
  return findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'html-node-label';
  });
}

describe('HtmlNode caption icon (US-007)', () => {
  beforeEach(() => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>ok</p>',
    });
  });

  it('renders an Icon inline with the caption when data.icon is set', () => {
    const tree = callHtmlNode({ name: 'Welcome card', icon: 'sparkles' });
    const label = findLabel(tree);
    if (!label) throw new Error('expected html-node-label');
    const icon = findElement(label, (el) => el.type === Icon);
    if (!icon) throw new Error('expected Icon in html-node-label');
    expect((icon.props as { name?: string }).name).toBe('sparkles');
    expect((icon.props as { size?: number }).size).toBe(12);
  });

  it('does not render an Icon in the caption when data.icon is undefined', () => {
    const tree = callHtmlNode({ name: 'Welcome card' });
    const label = findLabel(tree);
    if (!label) throw new Error('expected html-node-label');
    expect(findElement(label, (el) => el.type === Icon)).toBeNull();
  });

  it('renders the caption with no flex/span wrappers when data.icon is undefined', () => {
    const tree = callHtmlNode({ name: 'Welcome card' });
    const label = findLabel(tree);
    if (!label) throw new Error('expected html-node-label');
    // Legacy structure: the label div's children is the raw name string,
    // not a flex-wrapper div with a nested span.
    expect((label.props as { children?: unknown }).children).toBe('Welcome card');
  });
});

describe('HtmlNode autoSize', () => {
  beforeEach(() => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>hello</p>',
    });
  });

  it('defaults to auto-size when data.autoSize is undefined and renders the measuring container', () => {
    const tree = callHtmlNode();
    const measure = findContent(tree);
    expect(measure).not.toBeNull();
    const style = (measure?.props as { style?: CSSProperties }).style ?? {};
    expect(style.maxWidth).toBe(800);
    expect(style.maxHeight).toBe(600);
    expect(style.overflow).toBe('auto');
  });

  it('renders measuring container when autoSize: true is explicit', () => {
    const tree = callHtmlNode({ autoSize: true });
    const measure = findContent(tree);
    expect(measure).not.toBeNull();
    const style = (measure?.props as { style?: CSSProperties }).style ?? {};
    expect(style.maxWidth).toBe(800);
    expect(style.maxHeight).toBe(600);
  });

  it('renders user-sized layout when autoSize: false with width/height', () => {
    const tree = callHtmlNode({ autoSize: false, width: 480, height: 320 });
    const body = findContent(tree);
    expect(body).not.toBeNull();
    const innerStyle = (body?.props as { style?: CSSProperties }).style ?? {};
    // In user-sized mode the inner has no maxWidth cap — outer owns dims.
    expect(innerStyle.maxWidth).toBeUndefined();
    const outerStyle = getContainerStyle(tree);
    expect(outerStyle.width).toBe(480);
    expect(outerStyle.height).toBe(320);
  });
});

describe('HtmlNode fit-to-content button', () => {
  beforeEach(() => {
    _setHtmlContentForTest(SAMPLE_PROJECT_ID, SAMPLE_PATH, {
      kind: 'loaded',
      html: '<p>x</p>',
    });
  });

  const userSizedData = {
    autoSize: false,
    width: 480,
    height: 320,
  };

  function findFitButton(tree: unknown): ReactElementLike | null {
    return findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'html-node-fit-to-content';
    });
  }

  it('is hidden when not selected', () => {
    const tree = callHtmlNode({ ...userSizedData, onFitToContent: () => {} });
    expect(findFitButton(tree)).toBeNull();
  });

  it('is hidden when autoSize is already true', () => {
    const tree = callHtmlNode({ autoSize: true, onFitToContent: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    expect(findFitButton(tree)).toBeNull();
  });

  it('is hidden when onFitToContent is not wired (view/mini mode)', () => {
    const tree = callHtmlNode(userSizedData, { selected: true } as Partial<NodeProps>);
    expect(findFitButton(tree)).toBeNull();
  });

  it('is visible when selected + user-sized + callback wired', () => {
    const tree = callHtmlNode({ ...userSizedData, onFitToContent: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    expect(findFitButton(tree)).not.toBeNull();
  });

  it('click calls data.onFitToContent with the node id', () => {
    const onFit = mock(() => {});
    const tree = callHtmlNode({ ...userSizedData, onFitToContent: onFit }, {
      selected: true,
    } as Partial<NodeProps>);
    const btn = findFitButton(tree);
    expect(btn).not.toBeNull();
    (btn?.props as { onClick?: (e: { stopPropagation: () => void }) => void }).onClick?.({
      stopPropagation: () => {},
    });
    expect(onFit).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledWith('h1');
  });
});

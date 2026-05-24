import { describe, expect, it } from 'bun:test';
import { Handle, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import * as React from 'react';
import { COLOR_TOKENS, NODE_DEFAULT_BG_WHITE } from '../lib/color-tokens.ts';
import { ImageNode } from './image-node.tsx';

// Hook-shim render pattern documented in icon-node.test.tsx / shape-node.test.tsx.
// Bun runs apps/web tests without a DOM, and React Flow's <Handle> reads from a
// zustand store that only exists inside a real ReactFlow mount — so we call
// the memoized impl directly and walk the returned tree to assert handle
// presence and inline-style application.
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

// US-004: imageNode renders from a relative `path` resolved via the project
// file-serving endpoint. Tests pin the relative path; the renderer threads the
// `projectId` through runtime data injected by demo-canvas at mount time.
const SAMPLE_PATH = 'assets/pixel.png';

function callImageNode(
  data: Record<string, unknown> = {},
  overrides: Partial<NodeProps> = {},
): unknown {
  const props = {
    id: 'i1',
    type: 'imageNode',
    data: { path: SAMPLE_PATH, projectId: 'p1', ...data },
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
  const impl = (ImageNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

function getContainerStyle(tree: unknown): CSSProperties {
  const container = findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'image-node';
  });
  if (!container) throw new Error('image-node container missing');
  return (container.props as { style?: CSSProperties }).style ?? {};
}

// US-014: image nodes accept edge connections like shape nodes do — four
// handles (target Top + Left, source Right + Bottom). Mirrors the shape-node
// pattern; render-tree assertions are functionally equivalent to checking
// `.react-flow__handle` count on the mounted DOM (React Flow renders each
// `<Handle>` 1:1 into a wrapper div).
describe('ImageNode connect handles (US-014)', () => {
  it('renders all four <Handle> elements when isConnectable is true', () => {
    const tree = callImageNode();
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('forwards isConnectable=false to every handle (so the wrapper disables connect drag)', () => {
    // React Flow's <Handle> still renders into the tree regardless of the
    // isConnectable value; the prop controls whether dragging from the dot
    // initiates a connection. The PRD AC documents the prop wiring; this
    // assertion pins the forwarding (handles present + prop=false on each).
    const tree = callImageNode({}, { isConnectable: false } as Partial<NodeProps>);
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
    for (const h of handles) {
      expect((h.props as { isConnectable?: boolean }).isConnectable).toBe(false);
    }
  });

  it('still renders four handles when selected (opacity toggle, not gated render)', () => {
    const tree = callImageNode({}, { selected: true } as Partial<NodeProps>);
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });
});

// US-014: image renders an optional border from `borderColor` + `borderWidth`
// + `borderStyle`. Each is independently optional. When all three are absent
// the container style omits border keys entirely so the historical
// "chromeless image" look is preserved.
describe('ImageNode border render (US-014)', () => {
  it('omits border keys from container style when no border fields are set', () => {
    const style = getContainerStyle(callImageNode());
    expect(style.borderColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderStyle).toBeUndefined();
  });

  it('applies border color / width / style when all fields are set', () => {
    const tree = callImageNode({
      borderColor: 'blue',
      borderWidth: 3,
      borderStyle: 'dashed',
    });
    const style = getContainerStyle(tree);
    expect(style.borderColor).toBe(COLOR_TOKENS.blue.border);
    expect(style.borderWidth).toBe(3);
    expect(style.borderStyle).toBe('dashed');
  });

  it('applies a single border field without leaking the others', () => {
    // borderWidth alone shouldn't synthesize a color/style default — the
    // browser's CSS shorthand fallback (medium black solid) is the documented
    // behaviour when the author has only set one axis.
    const style = getContainerStyle(callImageNode({ borderWidth: 5 }));
    expect(style.borderWidth).toBe(5);
    expect(style.borderColor).toBeUndefined();
    expect(style.borderStyle).toBeUndefined();
  });

  it('still applies cornerRadius alongside the border fields', () => {
    const style = getContainerStyle(
      callImageNode({ borderWidth: 2, borderColor: 'amber', cornerRadius: 12 }),
    );
    expect(style.borderWidth).toBe(2);
    expect(style.borderRadius).toBe(12);
  });

  it('paints var(--node-shadow-N) when data.shadow is set', () => {
    const style = getContainerStyle(callImageNode({ shadow: 3 }));
    expect((style as { boxShadow?: string }).boxShadow).toBe('var(--node-shadow-3)');
  });

  it('omits boxShadow when data.shadow is unset', () => {
    const style = getContainerStyle(callImageNode());
    expect((style as { boxShadow?: string }).boxShadow).toBeUndefined();
  });
});

// US-004: image src is built via `fileUrl(projectId, path)` (project file-
// serving endpoint), not from a `data:image/...` base64 URL. Renderer reads
// `projectId` from the runtime data injected by demo-canvas at mount.
describe('ImageNode file-backed src (US-004)', () => {
  function getImgSrc(tree: unknown): string | undefined {
    const img = findElement(tree, (el) => el.type === 'img');
    return (img?.props as { src?: string }).src;
  }

  it('builds src via fileUrl(projectId, path)', () => {
    const src = getImgSrc(callImageNode({ path: 'assets/cover.png', projectId: 'demo-1' }));
    expect(src).toBe('/api/projects/demo-1/files/assets/cover.png');
  });

  it('encodes spaces in the path while preserving slash separators', () => {
    const src = getImgSrc(callImageNode({ path: 'assets/hero shot.png', projectId: 'demo-1' }));
    expect(src).toBe('/api/projects/demo-1/files/assets/hero%20shot.png');
  });

  it('renders an empty src when projectId is not yet wired (pre-mount)', () => {
    // The renderer can mount before the parent has the project id (e.g.
    // briefly during initial load); empty src is preferred over a malformed
    // URL.
    const src = getImgSrc(callImageNode({ path: 'assets/cover.png', projectId: undefined }));
    expect(src).toBe('');
  });
});

// US-008: optimistic-placement loading + failure overlays. Driven by transient
// `_uploading` / `_uploadError` flags on the runtime data — never persisted to
// disk. The renderer swaps the <img> for the appropriate placeholder so the
// canvas position stays committed while the upload round-trips.
describe('ImageNode upload placeholder (US-008)', () => {
  function findPlaceholder(tree: unknown): ReactElementLike | null {
    return findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'image-node-placeholder';
    });
  }
  function findImg(tree: unknown): ReactElementLike | null {
    return findElement(tree, (el) => el.type === 'img');
  }

  it('renders a Loading placeholder (not <img>) when data._uploading is true', () => {
    const tree = callImageNode({ _uploading: true });
    const placeholder = findPlaceholder(tree);
    expect(placeholder).not.toBeNull();
    expect((placeholder?.props as { 'data-placeholder'?: string })['data-placeholder']).toBe(
      'loading',
    );
    // The img must NOT render during the loading state — otherwise the empty
    // `path` would resolve to a broken file-serving URL and show a torn-image
    // icon over the 'Loading…' text.
    expect(findImg(tree)).toBeNull();
  });

  it('renders an upload-failed placeholder (not <img>) when data._uploadError is set', () => {
    const tree = callImageNode({ _uploadError: 'network down' });
    const placeholder = findPlaceholder(tree);
    expect(placeholder).not.toBeNull();
    expect((placeholder?.props as { 'data-placeholder'?: string })['data-placeholder']).toBe(
      'failed',
    );
    expect(findImg(tree)).toBeNull();
  });

  it('failed-placeholder click dispatches data.onRetryUpload with the node id', () => {
    const seen: { id: string | null } = { id: null };
    const tree = callImageNode(
      {
        _uploadError: 'fail',
        onRetryUpload: (id: string) => {
          seen.id = id;
        },
      },
      { id: 'img-42' } as Partial<NodeProps>,
    );
    const placeholder = findPlaceholder(tree);
    if (!placeholder) throw new Error('expected placeholder');
    const onClick = (placeholder.props as { onClick?: () => void }).onClick;
    expect(typeof onClick).toBe('function');
    onClick?.();
    expect(seen.id).toBe('img-42');
  });

  it('renders <img> (not placeholder) when neither flag is set', () => {
    const tree = callImageNode();
    expect(findPlaceholder(tree)).toBeNull();
    expect(findImg(tree)).not.toBeNull();
  });
});

// US-021: image nodes default to a literal white fill when `backgroundColor`
// is unset — gives transparent PNGs / partial-alpha screenshots a clean frame
// on light + dark canvases. Field is never auto-injected on disk; this is a
// render-time fallback only.
describe('ImageNode default-white fill (US-021)', () => {
  it('renders #ffffff when backgroundColor is unset', () => {
    const style = getContainerStyle(callImageNode());
    expect(style.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
  });

  it('uses the explicit token when backgroundColor is set', () => {
    const style = getContainerStyle(callImageNode({ backgroundColor: 'blue' }));
    expect(style.backgroundColor).toBe(COLOR_TOKENS.blue.background);
  });

  it('explicit "default" token resolves to theme --card (opt-back-into-theme)', () => {
    // The 'default' token is how a user explicitly opts back into the
    // theme-aware --card fill via the property panel. The render-time
    // white fallback only fires when the field is truly unset.
    const style = getContainerStyle(callImageNode({ backgroundColor: 'default' }));
    expect(style.backgroundColor).toBe(COLOR_TOKENS.default.background);
  });
});

import { describe, expect, it } from 'bun:test';
import {
  type PeerCursor,
  PeerCursorsLayer,
  type PeerCursorsLayerProps,
} from './peer-cursors-layer.tsx';

// PeerCursorsLayer is a hookless functional component that returns a JSX tree
// of plain DOM elements. We can call it as a function and walk the returned
// children — no React renderer / DOM needed (mirrors `icon-renderer.test.tsx`).

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
  key?: string | number | null;
};

function isElement(value: unknown): value is ReactElementLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'props' in (value as { props?: unknown })
  );
}

function callLayer(props: PeerCursorsLayerProps): ReactElementLike {
  return PeerCursorsLayer(props) as unknown as ReactElementLike;
}

function flatten(node: unknown, out: ReactElementLike[] = []): ReactElementLike[] {
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out);
    return out;
  }
  if (isElement(node)) {
    out.push(node);
    if (node.props.children !== undefined) flatten(node.props.children, out);
  }
  return out;
}

function findAll(root: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  return flatten(root).filter(predicate);
}

function findFirst(
  root: unknown,
  predicate: (el: ReactElementLike) => boolean,
): ReactElementLike | undefined {
  return findAll(root, predicate)[0];
}

const ALICE: PeerCursor = {
  peerId: 'p-alice',
  displayName: 'Alice',
  color: '#ff8800',
  x: 100,
  y: 50,
};

const BOB: PeerCursor = {
  peerId: 'p-bob',
  displayName: 'Bob',
  color: '#00aaff',
  x: 220,
  y: 180,
};

const IDLE_CARL: PeerCursor = {
  peerId: 'p-carl',
  displayName: 'Carl',
  color: '#22cc88',
  x: 10,
  y: 10,
  idle: true,
};

describe('PeerCursorsLayer', () => {
  it('excludes the selfPeerId from rendering', () => {
    const tree = callLayer({ peers: [ALICE, BOB], selfPeerId: ALICE.peerId });
    const aliceCursor = findFirst(
      tree,
      (el) => (el.props['data-peer-id'] as string | undefined) === ALICE.peerId,
    );
    const bobCursor = findFirst(
      tree,
      (el) => (el.props['data-peer-id'] as string | undefined) === BOB.peerId,
    );
    expect(aliceCursor).toBeUndefined();
    expect(bobCursor).toBeDefined();
  });

  it('renders one positioned cursor per remaining peer at the correct transform', () => {
    const tree = callLayer({ peers: [ALICE, BOB] });
    const cursors = findAll(tree, (el) => typeof el.props['data-peer-id'] === 'string');
    expect(cursors.length).toBe(2);

    const alice = cursors.find((c) => c.props['data-peer-id'] === ALICE.peerId);
    const bob = cursors.find((c) => c.props['data-peer-id'] === BOB.peerId);
    if (!alice || !bob) throw new Error('expected both cursors');

    const aliceStyle = alice.props.style as Record<string, unknown>;
    const bobStyle = bob.props.style as Record<string, unknown>;
    expect(aliceStyle.transform).toBe(`translate(${ALICE.x}px, ${ALICE.y}px)`);
    expect(bobStyle.transform).toBe(`translate(${BOB.x}px, ${BOB.y}px)`);
    // Smoothing low-pass — keep the value pinned so tweaks are deliberate.
    expect(aliceStyle.transition).toBe('transform 80ms linear');
  });

  it('applies opacity 0.4 to idle peers and full opacity otherwise', () => {
    const tree = callLayer({ peers: [ALICE, IDLE_CARL] });
    const alice = findFirst(
      tree,
      (el) => (el.props['data-peer-id'] as string | undefined) === ALICE.peerId,
    );
    const carl = findFirst(
      tree,
      (el) => (el.props['data-peer-id'] as string | undefined) === IDLE_CARL.peerId,
    );
    if (!alice || !carl) throw new Error('expected both cursors');
    expect((alice.props.style as Record<string, unknown>).opacity).toBe(1);
    expect((carl.props.style as Record<string, unknown>).opacity).toBe(0.4);
    expect(carl.props['data-idle']).toBe('true');
    expect(alice.props['data-idle']).toBe('false');
  });

  it('renders the displayName text in a name pill per peer', () => {
    const tree = callLayer({ peers: [ALICE, BOB] });
    const pills = findAll(tree, (el) => el.type === 'span');
    const labels = pills.map((p) => p.props.children);
    expect(labels).toContain('Alice');
    expect(labels).toContain('Bob');
    // Pill background is the peer color (design tokens — peer color on white text).
    const alicePill = pills.find((p) => p.props.children === 'Alice');
    if (!alicePill) throw new Error('expected Alice pill');
    expect((alicePill.props.style as Record<string, unknown>).background).toBe(ALICE.color);
    expect((alicePill.props.style as Record<string, unknown>).color).toBe('#fff');
  });

  it('renders a 14×14 SVG arrow in the peer color per peer', () => {
    const tree = callLayer({ peers: [ALICE] });
    const svg = findFirst(tree, (el) => el.type === 'svg');
    if (!svg) throw new Error('expected svg arrow');
    expect(svg.props.width).toBe(14);
    expect(svg.props.height).toBe(14);
    expect(svg.props.fill).toBe(ALICE.color);
    const svgStyle = svg.props.style as Record<string, unknown>;
    expect(svgStyle.filter).toBe('drop-shadow(0 1px 1px rgba(0,0,0,0.35))');
  });

  it('renders nothing when peers is empty', () => {
    const tree = callLayer({ peers: [] });
    const cursors = findAll(tree, (el) => typeof el.props['data-peer-id'] === 'string');
    expect(cursors.length).toBe(0);
  });
});

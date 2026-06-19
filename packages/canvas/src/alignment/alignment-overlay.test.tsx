import { describe, expect, it } from 'bun:test';
import { AlignmentOverlay } from './alignment-overlay.tsx';
import type { GuideLine } from './geometry.ts';

// Bun runs the canvas package tests without a DOM (see glow-overlay.test.tsx).
// `AlignmentOverlay` has no hooks and renders host elements via plain helper
// FUNCTIONS (not nested components), so calling it directly yields a fully
// expanded SVG host-element tree we can walk without a renderer.

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function isElement(node: unknown): node is ReactElementLike {
  return typeof node === 'object' && node !== null && 'type' in node && 'props' in node;
}

/** Depth-first flatten of a React element tree into the list of host elements. */
function flatten(node: unknown): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) {
      for (const child of n) visit(child);
      return;
    }
    if (!isElement(n)) return;
    out.push(n);
    if (n.props.children != null) visit(n.props.children);
  };
  visit(node);
  return out;
}

function render(guides: GuideLine[]): ReactElementLike | null {
  return AlignmentOverlay({ guides }) as ReactElementLike | null;
}

function elementsOfType(node: unknown, type: string): ReactElementLike[] {
  return flatten(node).filter((el) => el.type === type);
}

const V_GUIDE: GuideLine = { kind: 'v', x: 100, y1: 0, y2: 200, refIds: ['a'] };
const H_GUIDE: GuideLine = { kind: 'h', y: 50, x1: 10, x2: 300, refIds: ['b'] };
const SPACING_V: GuideLine = { kind: 'spacing-v', x1: 20, x2: 120, y: 80, gap: 40 };
const SPACING_H: GuideLine = { kind: 'spacing-h', y1: 0, y2: 90, x: 60, gap: 30.4 };

describe('AlignmentOverlay', () => {
  it('returns null when there are no guides (idle canvas = zero DOM nodes)', () => {
    expect(render([])).toBeNull();
  });

  it('renders an aria-hidden svg root', () => {
    const root = render([V_GUIDE]);
    expect(root?.type).toBe('svg');
    expect(root?.props['aria-hidden']).toBe('true');
  });

  it('renders exactly one <line> per edge/center guide', () => {
    const lines = elementsOfType(render([V_GUIDE, H_GUIDE]), 'line');
    expect(lines).toHaveLength(2);
  });

  it('draws a vertical line for a v-guide and a horizontal line for an h-guide', () => {
    const [vLine] = elementsOfType(render([V_GUIDE]), 'line');
    expect(vLine?.props.x1).toBe(100);
    expect(vLine?.props.x2).toBe(100);
    expect(vLine?.props.y1).toBe(0);
    expect(vLine?.props.y2).toBe(200);

    const [hLine] = elementsOfType(render([H_GUIDE]), 'line');
    expect(hLine?.props.y1).toBe(50);
    expect(hLine?.props.y2).toBe(50);
    expect(hLine?.props.x1).toBe(10);
    expect(hLine?.props.x2).toBe(300);
  });

  it('every <line> carries vector-effect="non-scaling-stroke"', () => {
    const lines = elementsOfType(render([V_GUIDE, H_GUIDE, SPACING_V, SPACING_H]), 'line');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.props['vector-effect']).toBe('non-scaling-stroke');
    }
  });

  it('renders a spacing-v guide as a main line plus two T-caps (3 lines) inside a <g>', () => {
    const tree = render([SPACING_V]);
    expect(elementsOfType(tree, 'g')).toHaveLength(1);
    expect(elementsOfType(tree, 'line')).toHaveLength(3);
  });

  it('includes a gap-label <foreignObject> for a spacing-v guide', () => {
    const fo = elementsOfType(render([SPACING_V]), 'foreignObject');
    expect(fo).toHaveLength(1);
    const span = flatten(fo[0]).find((el) => el.type === 'span');
    expect(span?.props.children).toBe('40px');
  });

  it('rounds the gap value in the spacing-h label', () => {
    const fo = elementsOfType(render([SPACING_H]), 'foreignObject');
    expect(fo).toHaveLength(1);
    const span = flatten(fo[0]).find((el) => el.type === 'span');
    expect(span?.props.children).toBe('30px');
  });

  it('uses the accent token for edge guides and the spacing token for spacing guides', () => {
    const [edge] = elementsOfType(render([V_GUIDE]), 'line');
    expect(edge?.props.stroke).toBe('var(--sf-accent)');

    const spacingLines = elementsOfType(render([SPACING_V]), 'line');
    for (const line of spacingLines) {
      expect(line.props.stroke).toBe('var(--sf-alignment-spacing)');
    }
  });

  it('renders every guide line at a reduced (sub-1) opacity so it reads as a hint', () => {
    const lines = elementsOfType(render([V_GUIDE, H_GUIDE, SPACING_V, SPACING_H]), 'line');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.props.opacity).toBeLessThan(0.9);
    }
  });

  it('dashes the long alignment lines (edge guides + spacing main line)', () => {
    const [edge] = elementsOfType(render([V_GUIDE]), 'line');
    expect(edge?.props.strokeDasharray).toBeTruthy();

    // The spacing main line is the one spanning the gap, not a short T-cap.
    const main = elementsOfType(render([SPACING_V]), 'line').find(
      (l) => l.props.x1 === SPACING_V.x1 && l.props.x2 === SPACING_V.x2,
    );
    expect(main?.props.strokeDasharray).toBeTruthy();
  });

  it('keeps the short spacing T-caps solid (a dashed 10px tick would read as broken)', () => {
    const caps = elementsOfType(render([SPACING_V]), 'line').filter(
      (l) => !(l.props.x1 === SPACING_V.x1 && l.props.x2 === SPACING_V.x2),
    );
    expect(caps).toHaveLength(2);
    for (const cap of caps) {
      expect(cap.props.strokeDasharray).toBeUndefined();
    }
  });
});

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Connector label sits ABOVE the connector line, BELOW nodes.
//
// Invariants:
//
//   1. The per-edge SVG inline zIndex (DEFAULT_EDGE_OPTIONS in
//      demo-canvas.tsx) MUST be 0 so connectors paint under nodes (nodes
//      naturally win via DOM order: xyflow renders NodeRenderer after
//      EdgeRenderer in the viewport). Only the outlet endpoint dots
//      (CSS z-index 2000 via <ViewportPortal>) stay above nodes.
//
//   2. `.react-flow__edgelabel-renderer` (xyflow's portal container that
//      receives every <EdgeLabelRenderer> child) MUST NOT carry an
//      explicit z-index — letting it stack via natural DOM order keeps
//      labels above the connector path (DOM later than EdgeRenderer)
//      yet below nodes (DOM earlier than NodeRenderer), so the line never
//      crosses the readable text AND the label still sits under any
//      overlapping node.
//
//   3. The label markup in editable-edge.tsx MUST render an OPAQUE
//      background plate when label text is present, so even if a future
//      stacking change reintroduces overlap the line stays masked
//      cleanly behind the text. `bg-background` (theme background token)
//      is the agreed plate; an empty label renders no plate at all so
//      the canvas keeps no ghost artifact.
const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
const indexCssPath = join(repoRoot, 'apps/web/src/index.css');
const editableEdgePath = join(repoRoot, 'packages/canvas/src/edges/editable-edge.tsx');
const seeflowCanvasPath = join(repoRoot, 'packages/canvas/src/components/seeflow-canvas.tsx');

describe('connectors paint under nodes; labels stack between edges and nodes', () => {
  it('DEFAULT_EDGE_OPTIONS sets zIndex 0 so edges paint under nodes', () => {
    const src = readFileSync(seeflowCanvasPath, 'utf-8');
    const rule = src.match(/DEFAULT_EDGE_OPTIONS\s*=\s*\{\s*zIndex:\s*(\d+)\s*\}/);
    expect(rule).not.toBeNull();
    if (!rule) throw new Error('expected DEFAULT_EDGE_OPTIONS zIndex literal');
    expect(Number(rule[1])).toBe(0);
  });

  it('index.css leaves .react-flow__edgelabel-renderer without an explicit z-index so DOM order layers labels between edges and nodes', () => {
    const css = readFileSync(indexCssPath, 'utf-8');
    const rule = css.match(/\.react-flow__edgelabel-renderer\s*\{[^}]*z-index:\s*(\d+)[^}]*\}/);
    expect(rule).toBeNull();
  });

  it('label markup uses opaque bg-background plate when text is present', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The label-display branch (`labelText ? <button …` JSX) renders the
    // visible label plate. It must use `bg-background` (opaque theme token)
    // so the connector path is masked behind the text. Past regressions
    // used `bg-card` which is semi-transparent and let the line bleed —
    // history called out in the bg-background comment.
    expect(src).toMatch(/bg-background/);
    // Strip JS comments before scanning so the historical "bg-card"
    // mention in the bg-background callout doesn't trip the fence.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toMatch(/\bbg-card\b/);
  });

  it('inline-edit branch also uses opaque bg-background plate', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // Two label-bearing branches share the same `bg-background` className:
    // the read-only `<button>` (text present) and the inline editor
    // (`<InlineEdit>` while editing). Count the bg-background occurrences
    // to ensure both branches still carry the plate. The empty-label
    // affordance ('+' button) also uses bg-background to mask the line
    // when hovered visible.
    const matches = src.match(/bg-background/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('empty-label state renders no extra visual artifact (no opaque plate when text absent + non-editable)', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The non-editable + empty-label branch returns null so the label
    // portal stays empty — no ghost plate over the line. Verify by
    // checking the trailing branch ends with `: null`.
    expect(src).toMatch(/:\s*editable\s*\?[\s\S]*?:\s*null/);
  });
});

// The visible endpoint dot must be purely visual so React Flow's native
// EdgeUpdateAnchors (which sit at the same screen position) can drive the
// free-floating reconnect drag. A previous iteration added a custom
// mousedown handler that clamped the drag to the node's perimeter —
// "snapped to the node" rather than following the cursor — and broke the
// reattach-to-another-node flow. Two invariants prevent that regression:
//
//   1. The dot's CSS rule sets `pointer-events: none` so clicks pass
//      through to the underlying anchor.
//   2. The dot element in editable-edge.tsx carries no `onMouseDown` /
//      `onContextMenu` / drag handler — it's a `<div>` with className and
//      transform only.
describe('endpoint dot is visual-only — native React Flow reconnect drives drag', () => {
  it('CSS sets pointer-events: none on the endpoint dot', () => {
    const css = readFileSync(indexCssPath, 'utf-8');
    const rule = css.match(/\.seeflow-connector-endpoint-dot\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (!rule) throw new Error('expected .seeflow-connector-endpoint-dot rule');
    expect(rule[0]).toMatch(/pointer-events:\s*none/);
    // The `cursor: grab` / `grabbing` affordances from the perimeter-snap
    // era would imply a drag handler on the dot. They must be gone.
    expect(rule[0]).not.toMatch(/cursor:\s*grab/);
  });

  it('editable-edge.tsx attaches no mouse handlers to the dot', () => {
    const src = readFileSync(editableEdgePath, 'utf-8');
    // The dot was previously the click target for a perimeter pin-drag
    // gesture. Restoring free drag requires the dot to be inert — clicks
    // must fall through to React Flow's EdgeUpdateAnchors below.
    expect(src).not.toMatch(/onPinDragStart/);
    expect(src).not.toMatch(/onMouseDown=\{[^}]*onPin/);
    expect(src).not.toMatch(/setDragPreview/);
    expect(src).not.toMatch(/document\.elementsFromPoint/);
  });
});

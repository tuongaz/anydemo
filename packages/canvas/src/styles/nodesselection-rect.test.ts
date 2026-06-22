import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = join(__dirname, 'index.css');

/**
 * After a marquee selection (drag on empty pane) xyflow sets its internal
 * `nodesSelectionActive: true` and renders `.react-flow__nodesselection-rect`
 * spanning the bounding box of the selected nodes (a "temp group"). The rect's
 * parent `.react-flow__nodesselection` has z-index 3 — HIGHER than the viewport's
 * z-index 2 — so it sits above every selected node.
 *
 * xyflow wires this rect through `useDrag`: dragging it ANYWHERE inside the box
 * (including the empty space between members) moves the WHOLE selection, and the
 * drag stops propagation so a click on it never reaches the pane (the selection
 * is NOT cleared). That is exactly the Miro-style "drag the group to move it"
 * affordance, so we KEEP the rect interactive (`pointer-events: all`). We only
 * strip the fill/border (the visible marquee is drawn by `<SelectionResizeOverlay>`)
 * and swap xyflow's `cursor: grab` (reads as "pan the canvas") for `cursor: move`
 * (reads as "drag the selection").
 *
 * A previous revision set `pointer-events: none` to dodge a pan-hand cursor leak,
 * but that ALSO made the empty interior of a temp group fall through to the pane —
 * so clicking between members cleared the selection instead of moving it. Keeping
 * the rect draggable (with the right cursor) is the fix; the wired
 * `onSelectionDrag*` handlers commit the move + fan group members live.
 */
describe('.react-flow__nodesselection-rect override', () => {
  const css = readFileSync(cssPath, 'utf8');

  const block = (() => {
    const ruleStart = css.indexOf('.seeflow-canvas-root .react-flow__nodesselection-rect');
    if (ruleStart < 0) return '';
    const open = css.indexOf('{', ruleStart);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  })();

  it('declares cursor: move so the box reads as a drag-to-move surface (not a pan-hand)', () => {
    expect(block).toMatch(/cursor:\s*move/);
  });

  it('keeps pointer-events: all so dragging the box interior moves the whole selection', () => {
    expect(block).toMatch(/pointer-events:\s*all/);
  });

  it('strips the default fill + border (the marquee is drawn by the overlay)', () => {
    expect(block).toMatch(/background:\s*transparent/);
    expect(block).toMatch(/border:\s*none/);
  });
});

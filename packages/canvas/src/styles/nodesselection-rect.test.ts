import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = join(__dirname, 'index.css');

/**
 * After a marquee selection (drag on empty pane) xyflow sets its internal
 * `nodesSelectionActive: true` and renders `.react-flow__nodesselection-rect`
 * spanning the bounding box of the selected nodes. The rect's parent
 * `.react-flow__nodesselection` has z-index 3 — which is HIGHER than the
 * viewport's z-index 2 — so it sits above every selected node regardless of
 * the per-node z-index 1000 we paint inside the viewport's stacking context.
 *
 * The xyflow defaults for the rect are `cursor: grab` and `pointer-events: all`.
 * Without an override, the user sees a "pan hand" anywhere inside the bounding
 * box and clicks on selected nodes hit the invisible rect instead of the node
 * underneath — so the multi-selection appears to stop responding intermittently
 * (only after a marquee, because Cmd+A through our handler doesn't trip
 * `nodesSelectionActive`).
 *
 * Multi-node drag still works by clicking any selected node — each node owns
 * its own drag handler that moves the whole selection — so dropping
 * `pointer-events` on the bounding-box rect is safe.
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

  it('declares cursor: default so the pan-hand never leaks through', () => {
    expect(block).toMatch(/cursor:\s*default/);
  });

  it('declares pointer-events: none so clicks reach the selected nodes', () => {
    expect(block).toMatch(/pointer-events:\s*none/);
  });
});

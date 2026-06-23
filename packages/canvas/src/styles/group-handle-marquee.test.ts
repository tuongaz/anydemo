import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, 'index.css'), 'utf8');

/**
 * A SELECTED group's four connection dots must straddle the overlay MARQUEE —
 * the dashed rect <SelectionResizeOverlay> draws SELECTION_OVERLAY_PADDING flow
 * units outside the group box — so the dashed line bisects each circle, exactly
 * like a normal node's dot sits on its `.selected` ring.
 *
 * A normal node pushes its dots out by 8 SCREEN px (`calc(8px / var(--rf-zoom))`)
 * to meet its screen-px ring. A group's marquee lives in FLOW space, so its dots
 * are pushed out by a FLOW-unit transform — NO `/ var(--rf-zoom)` division — so
 * the offset scales with the viewport and tracks the marquee at every zoom level.
 * The exact magnitude is calibrated visually (the group-selected-light baseline
 * is the source of truth); this test guards the STRUCTURE: all four sides exist
 * and use a flow-unit (non-zoom-divided) translate.
 */
describe('selected group connection-dot push tracks the marquee (flow units)', () => {
  const ruleBodyFor = (side: string): string => {
    const sel = `.react-flow__node-group.selected .react-flow__handle-${side} {`;
    const start = css.indexOf(sel);
    if (start < 0) return '';
    const open = css.indexOf('{', start);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  it('pushes each group handle outward with a flow-unit transform (no zoom division)', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const body = ruleBodyFor(side);
      expect(body).toContain('transform:');
      // A px translate is present (the outward push).
      expect(body).toMatch(/translate\([^)]*-?[0-9.]+px/);
      // Flow units: the push must NOT be divided by the zoom var — that is the
      // constant-screen-px path normal nodes use; a group's marquee is flow-space.
      expect(body).not.toContain('var(--rf-zoom');
    }
  });
});

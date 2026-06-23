import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, 'index.css'), 'utf8');

/**
 * A SELECTED group's four connection dots must straddle the overlay MARQUEE — so
 * the dashed line bisects each circle, exactly like a normal node's dot sits on
 * its `.selected` ring.
 *
 * The original bug: the normal-node OUTWARD handle push (8 screen-px, to meet the
 * normal `.selected` ring) was leaking onto groups, shoving their dots OUTSIDE the
 * marquee. The fix is two-fold and BOTH parts are guarded here:
 *   1. The normal push rules carve groups out (`:not(.react-flow__node-group)`).
 *   2. The group rules are PURE CENTERING (no outward px push) — a handle's natural
 *      centered position already lands on the marquee — with `!important` so they
 *      win over xyflow's INLINE handle transform.
 */
describe('selected group connection-dot centering', () => {
  const groupRuleBody = (side: string): string => {
    const sel = `.react-flow__node-group.selected .react-flow__handle-${side} {`;
    const start = css.indexOf(sel);
    if (start < 0) return '';
    const open = css.indexOf('{', start);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  it('carves groups out of the normal outward handle push', () => {
    // Without the carve-out the 8-screen-px push shoves a group's dots outside
    // the marquee (the original bug). All four normal push rules must exclude groups.
    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(css).toContain(
        `.react-flow__node.selected:not(.react-flow__node-group) .react-flow__handle-${side}`,
      );
    }
  });

  it('centers group dots with pure centering + !important (no outward px push)', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const body = groupRuleBody(side);
      expect(body).toContain('transform:');
      // Must win over xyflow's inline handle transform.
      expect(body).toContain('!important');
      // Pure % centering — NO px offset (an outward px push reintroduces the bug).
      expect(body).not.toMatch(/[0-9.]+px/);
    }
  });
});

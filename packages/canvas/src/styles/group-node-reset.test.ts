import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = join(__dirname, 'index.css');

/**
 * A seeflow group is CHROME-LESS (Miro-style): the wrapper `.react-flow__node-group`
 * must paint NO fill, NO border, NO corner radius, and — crucially — NO box-shadow,
 * in ANY state. Its only visible selection treatment is the padded dashed marquee +
 * 4 corner handles drawn by <SelectionResizeOverlay>.
 *
 * xyflow's bundled base CSS ships a `.react-flow__node-group.selectable.selected`
 * (and `:focus` / `:focus-visible`) rule that applies
 * `box-shadow: var(--xy-node-boxshadow-selected, 0 0 0 0.5px #1a192b)` — a NEAR-BLACK
 * ring. Because that selector is specificity 0,3,0 (three classes) it OUT-RANKS the
 * seeflow reset (`.seeflow-canvas-root .react-flow__node-group`, 0,2,0) AND CSS load
 * order across consumers (web / mcp-app / embed) is not guaranteed, so the reset MUST
 * neutralize the shadow with `!important`. Left unset, a selected group shows a solid
 * black border in the LIGHT theme (the near-black `#1a192b` is merely invisible
 * against the dark pane in dark theme — the bug exists in both, only LOOKS theme-
 * specific). This is the classic xyflow CSS-leak pattern (an xyflow default leaking
 * through a seeflow override that only resets SOME properties).
 */
describe('.react-flow__node-group reset (chrome-less group)', () => {
  const css = readFileSync(cssPath, 'utf8');

  const block = (() => {
    const ruleStart = css.indexOf('.seeflow-canvas-root .react-flow__node-group {');
    if (ruleStart < 0) return '';
    const open = css.indexOf('{', ruleStart);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  })();

  it('strips the xyflow default fill + border + corner radius, and pads to inset the border', () => {
    expect(block).toMatch(/background-color:\s*transparent/);
    expect(block).toMatch(/border:\s*none/);
    expect(block).toMatch(/border-radius:\s*0/);
    // The wrapper padding insets the inner div (which paints the stylable border)
    // from the box edge, so the solid border sits a GAP inside the selection
    // marquee (which hugs the box edge) instead of overlapping it. Must be a
    // positive px value (overriding xyflow's default 10px with an intentional one).
    expect(block).toMatch(/padding:\s*[1-9]\d*px/);
  });

  it('neutralizes the xyflow selected/focus box-shadow ring with !important (no solid black border)', () => {
    // `!important` is load-bearing: xyflow's `.react-flow__node-group.selectable.selected`
    // box-shadow is specificity 0,3,0 and out-ranks this 0,2,0 reset otherwise.
    expect(block).toMatch(/box-shadow:\s*none\s*!important/);
  });
});

/**
 * Internal barrel for the alignment-guides subsystem.
 *
 * Re-exports the subsystem's surface for use within the canvas package
 * (geometry, the gesture hook, and the SVG overlay). Deliberately NOT
 * re-exported from the package's public `src/index.ts` — alignment guides are
 * an internal canvas affordance, not part of the embeddable public API.
 */

export { AlignmentOverlay } from './alignment-overlay.tsx';
export {
  computeGuides,
  type ComputeGuidesOptions,
  type GuideLine,
  type Rect,
  type ResizeEdges,
  type SnapResult,
} from './geometry.ts';
export {
  type AlignmentModifierEvent,
  type AlignmentViewport,
  type NodeChangeLike,
  useAlignmentGuides,
  type UseAlignmentGuidesApi,
  type UseAlignmentGuidesParams,
} from './use-alignment-guides.ts';

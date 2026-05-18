import { Lock } from 'lucide-react';
import { cn } from '../lib/cn.ts';

/**
 * US-019: small lock indicator rendered on a node's top-right corner when
 * the node is locked. Absolutely positioned outside the node's content flow
 * so it never affects the node's bounding box; offset above the top edge so
 * it doesn't overlap the top-middle connection handle. Every node renderer
 * (play, state, shape, image, icon, group) reads `data.locked` and renders
 * this badge directly — there is no shared wrapper layer in xyflow we can
 * inject chrome through.
 *
 * US-018: the badge keeps `pointer-events: auto` (default) so it is the
 * event target when the cursor is over its visible area. Because the badge
 * is offset at `-top-2 -right-2`, it sits OUTSIDE the xyflow `.react-flow__node`
 * wrapper's geometry — but it's still a DOM descendant of the wrapper. With
 * pointer-events enabled, contextmenu / click events on the badge fire on
 * the badge element and bubble through the DOM to the wrapper, where xyflow's
 * onContextMenu / onClick handlers correctly dispatch to onNodeContextMenu /
 * onNodeClick. Without this (with `pointer-events: none`), hit-testing
 * skips the badge and falls through to the React Flow pane underneath —
 * since the badge area is geometrically outside the wrapper — and the
 * right-click fires onPaneContextMenu (the canvas Paste menu) instead.
 */
export function LockBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="node-lock-badge"
      aria-hidden="true"
      className={cn(
        'sf-absolute -sf-top-2 -sf-right-2 sf-z-10 sf-inline-flex sf-h-4 sf-w-4 sf-items-center sf-justify-center sf-rounded-sm sf-bg-background/90 sf-text-muted-foreground sf-shadow-sm sf-ring-1 sf-ring-border',
        className,
      )}
    >
      <Lock className="sf-h-2.5 sf-w-2.5" strokeWidth={2.5} />
    </span>
  );
}

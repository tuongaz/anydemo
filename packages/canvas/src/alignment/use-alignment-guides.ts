/**
 * React hook that owns the drag/resize gesture lifecycle for canvas alignment
 * guides. It is the stateful bridge between the pure {@link computeGuides}
 * algorithm and `SeeflowCanvas`'s mutation points (`onNodesChange`, the resize
 * gesture). See git history: 2026-06-01-canvas-alignment-guides-design.md.
 *
 * Responsibilities:
 *  - Capture a frozen snapshot of the non-moving reference rects once per
 *    gesture (begin{Gesture,Resize}), so per-frame work never re-walks state.
 *  - Intercept drag position changes and resize rects, rewriting them with the
 *    snap offset from `computeGuides`.
 *  - Commit the active guide lines to React state, RAF-batched (≤1 commit per
 *    paint) and de-duplicated (only when the *set* of guides changes).
 *  - Honor the Cmd/Ctrl modifier-key suppress: pass changes through untouched
 *    and clear the guides on the next RAF tick.
 */

import type { Node } from '@xyflow/react';
import type { MutableRefObject } from 'react';
import { useCallback, useRef, useState } from 'react';
import { type GuideLine, type Rect, type ResizeEdges, computeGuides } from './geometry.ts';

/** Viewport transform — only `zoom` is read (px→world threshold conversion). */
export type AlignmentViewport = { x: number; y: number; zoom: number };

/** The drag/resize event subset the hook reads for the modifier-suppress. */
export type AlignmentModifierEvent = { metaKey?: boolean; ctrlKey?: boolean };

export interface UseAlignmentGuidesParams {
  enabled: boolean;
  /** Snap threshold in *screen* pixels; divided by zoom to world units per frame. */
  thresholdPx: number;
  viewport: AlignmentViewport;
  /** The live xyflow node list (post-merge), already maintained by the canvas. */
  rfNodesRef: MutableRefObject<Node[]>;
}

export interface UseAlignmentGuidesApi {
  /** Active guide lines to render. Stable reference between structural changes. */
  guides: GuideLine[];
  /** Drag start: freeze the non-dragged reference rects. */
  beginGesture(draggedIds: string[]): void;
  /**
   * Rewrite dragging position changes with the snap offset. The selection's
   * bounding box is treated as one logical rect (uniform delta to every member).
   * Returns the (possibly new) change array to forward downstream.
   */
  interceptChanges(changes: NodeChangeLike[], event: AlignmentModifierEvent): NodeChangeLike[];
  /** Drag end: clear guides + drop the snapshot. */
  endGesture(): void;
  /** Resize start: freeze references and remember which edges move. */
  beginResize(nodeId: string, activeEdges: ResizeEdges): void;
  /**
   * Snap the moving edges of a resize rect. Spacing guides are emitted (read-
   * only) but never adjust the rect. Returns the snapped rect + its guides.
   */
  applyResizeSnap(
    rawRect: Rect,
    event: AlignmentModifierEvent,
  ): { snappedRect: Rect; guides: GuideLine[] };
  /** Resize end: clear guides + drop the snapshot. */
  endResize(): void;
}

/**
 * Structural subset of xyflow's `NodeChange` we touch. Kept local so the hook
 * stays decoupled from the full discriminated union — only position changes
 * with `dragging === true` are ever rewritten.
 */
export type NodeChangeLike = {
  type: string;
  id?: string;
  position?: { x: number; y: number };
  dragging?: boolean;
};

function nodeDims(node: Node | undefined): { w: number; h: number } {
  if (!node) return { w: 0, h: 0 };
  return {
    w: node.measured?.width ?? node.width ?? 0,
    h: node.measured?.height ?? node.height ?? 0,
  };
}

function nodeToRect(node: Node): Rect {
  const { w, h } = nodeDims(node);
  return { id: node.id, x: node.position.x, y: node.position.y, w, h };
}

/** Stable key per guide for the structural compare (`kind|anchor|refIds`). */
function guideKey(g: GuideLine): string {
  switch (g.kind) {
    case 'v':
      return `v|${g.x}|${g.refIds.join(',')}`;
    case 'h':
      return `h|${g.y}|${g.refIds.join(',')}`;
    case 'spacing-v':
      return `spacing-v|${g.x1},${g.x2},${g.y}|${g.gap}`;
    case 'spacing-h':
      return `spacing-h|${g.y1},${g.y2},${g.x}|${g.gap}`;
  }
}

function guidesKey(guides: GuideLine[]): string {
  return guides.map(guideKey).join(';');
}

export function useAlignmentGuides(params: UseAlignmentGuidesParams): UseAlignmentGuidesApi {
  const { enabled, thresholdPx, viewport, rfNodesRef } = params;
  const [guides, setGuides] = useState<GuideLine[]>([]);

  // Frozen reference rects captured at gesture start (null = no gesture).
  const snapshotRef = useRef<Rect[] | null>(null);
  // Resize-only: which node + edges are moving.
  const resizeNodeIdRef = useRef<string | null>(null);
  const resizeEdgesRef = useRef<ResizeEdges | null>(null);

  // RAF batching: pending guides + the in-flight frame handle + last committed
  // structural key (so identical frames do zero React work).
  const pendingGuidesRef = useRef<GuideLine[] | null>(null);
  const rafRef = useRef<number | null>(null);
  const committedKeyRef = useRef<string>('');

  const worldThreshold = thresholdPx / (viewport.zoom || 1);

  const scheduleCommit = useCallback((next: GuideLine[]) => {
    pendingGuidesRef.current = next;
    // One frame in flight at a time — repeated calls just overwrite `pending`.
    if (rafRef.current !== null) return;
    rafRef.current = globalThis.requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingGuidesRef.current ?? [];
      pendingGuidesRef.current = null;
      const key = guidesKey(pending);
      if (key === committedKeyRef.current) return;
      committedKeyRef.current = key;
      setGuides(pending);
    });
  }, []);

  const clearGuidesImmediate = useCallback(() => {
    if (rafRef.current !== null) {
      globalThis.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingGuidesRef.current = null;
    if (committedKeyRef.current !== '') {
      committedKeyRef.current = '';
      setGuides([]);
    }
  }, []);

  const beginGesture = useCallback(
    (draggedIds: string[]) => {
      const dragged = new Set(draggedIds);
      snapshotRef.current = rfNodesRef.current.filter((n) => !dragged.has(n.id)).map(nodeToRect);
    },
    [rfNodesRef],
  );

  const interceptChanges = useCallback(
    (changes: NodeChangeLike[], event: AlignmentModifierEvent): NodeChangeLike[] => {
      if (!enabled) return changes;
      // Modifier suppress: forward raw, clear guides on the next tick.
      if (event.metaKey || event.ctrlKey) {
        scheduleCommit([]);
        return changes;
      }
      const snapshot = snapshotRef.current;
      if (!snapshot) return changes;

      // Gather the dragging position changes and build their moving rects.
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let count = 0;
      for (const c of changes) {
        // The active snapshot is the gesture gate, so both live (`dragging:
        // true`) frames AND the terminal drag-stop frame (`dragging: false`,
        // which xyflow emits with its raw unsnapped position) are snapped.
        // Snapping the terminal frame is what stops the node jumping 1-2px back
        // off the guide on mouse release.
        if (c.type !== 'position' || !c.position || !c.id) continue;
        const node = rfNodesRef.current.find((n) => n.id === c.id);
        const { w, h } = nodeDims(node);
        minX = Math.min(minX, c.position.x);
        minY = Math.min(minY, c.position.y);
        maxX = Math.max(maxX, c.position.x + w);
        maxY = Math.max(maxY, c.position.y + h);
        count++;
      }
      if (count === 0) return changes;

      // Treat the selection's outer bounding box as one logical rect; the snap
      // delta applies uniformly to every dragged node.
      const bbox: Rect = {
        id: '__sf_selection__',
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      };
      const result = computeGuides(bbox, snapshot, worldThreshold);
      scheduleCommit(result.guides);

      const dx = result.snappedX - bbox.x;
      const dy = result.snappedY - bbox.y;
      if (dx === 0 && dy === 0) return changes;
      return changes.map((c) => {
        if (c.type === 'position' && c.position) {
          return { ...c, position: { x: c.position.x + dx, y: c.position.y + dy } };
        }
        return c;
      });
    },
    [enabled, worldThreshold, rfNodesRef, scheduleCommit],
  );

  const endGesture = useCallback(() => {
    snapshotRef.current = null;
    clearGuidesImmediate();
  }, [clearGuidesImmediate]);

  const beginResize = useCallback(
    (nodeId: string, activeEdges: ResizeEdges) => {
      resizeNodeIdRef.current = nodeId;
      resizeEdgesRef.current = activeEdges;
      snapshotRef.current = rfNodesRef.current.filter((n) => n.id !== nodeId).map(nodeToRect);
    },
    [rfNodesRef],
  );

  const applyResizeSnap = useCallback(
    (rawRect: Rect, event: AlignmentModifierEvent): { snappedRect: Rect; guides: GuideLine[] } => {
      if (!enabled) return { snappedRect: rawRect, guides: [] };
      if (event.metaKey || event.ctrlKey) {
        scheduleCommit([]);
        return { snappedRect: rawRect, guides: [] };
      }
      const snapshot = snapshotRef.current;
      const edges = resizeEdgesRef.current;
      if (!snapshot || !edges) return { snappedRect: rawRect, guides: [] };

      const moving: Rect = { ...rawRect, id: resizeNodeIdRef.current ?? rawRect.id };
      const result = computeGuides(moving, snapshot, worldThreshold, {
        resizeMode: true,
        activeEdges: edges,
      });
      scheduleCommit(result.guides);

      // computeGuides returns a snapped TOP-LEFT. For an active right/bottom
      // edge the delta grows the size (origin fixed); for left/top it both
      // shifts the origin and shrinks the size. Inactive edges never move.
      const dx = result.snappedX - moving.x;
      const dy = result.snappedY - moving.y;
      let { x, y, w, h } = rawRect;
      if (edges.left) {
        x = rawRect.x + dx;
        w = rawRect.w - dx;
      } else if (edges.right) {
        w = rawRect.w + dx;
      }
      if (edges.top) {
        y = rawRect.y + dy;
        h = rawRect.h - dy;
      } else if (edges.bottom) {
        h = rawRect.h + dy;
      }
      return { snappedRect: { id: rawRect.id, x, y, w, h }, guides: result.guides };
    },
    [enabled, worldThreshold, scheduleCommit],
  );

  const endResize = useCallback(() => {
    resizeNodeIdRef.current = null;
    resizeEdgesRef.current = null;
    snapshotRef.current = null;
    clearGuidesImmediate();
  }, [clearGuidesImmediate]);

  return {
    guides,
    beginGesture,
    interceptChanges,
    endGesture,
    beginResize,
    applyResizeSnap,
    endResize,
  };
}

import { CommandPalette } from '@/components/command-palette';
import { ExportDialog } from '@/components/export-dialog';
import { FlowCreateDialog } from '@/components/flow-create-dialog';
import { FlowDeleteDialog } from '@/components/flow-delete-dialog';
import { FlowRenameDialog } from '@/components/flow-rename-dialog';
import { FlowSwitcher } from '@/components/flow-switcher';
import {
  LinkflowPickerDialog,
  type LinkflowPickerTarget,
} from '@/components/linkflow-picker-dialog';
import type { NodeEventLog } from '@/hooks/use-node-events';
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { NodeStatuses } from '@/hooks/use-node-statuses';
import { usePendingDeletions } from '@/hooks/use-pending-deletions';
import { usePendingOverrides } from '@/hooks/use-pending-overrides';
import { useProjectFlows } from '@/hooks/use-project-flows';
import type {
  Connector,
  EdgePin,
  FlowDetail,
  FlowNode,
  FlowSummary,
  GeometricNodeType,
} from '@/lib/api';
import { buildPastePayload } from '@/lib/clipboard';
import { performImageDropUpload } from '@/lib/image-upload-flow';
import { flowPath, navigate } from '@/lib/router';
import { shortId } from '@/lib/short-id';
import {
  type CanvasMode,
  type CommandId,
  type ConnectorStylePatch,
  DEFAULT_STORAGE_PREFIX,
  ICON_DEFAULT_SIZE,
  type LayoutNodeInput,
  type NodeStylePatch,
  type ReorderOp,
  SHAPE_DEFAULT_SIZE,
  SeeflowCanvas,
  type SeeflowCanvasHandle,
  applyNudge,
  buildNewShapeData,
  computeIconInsertPosition,
  createRestAdapter,
  downscaleImageFile,
  getLastUsedStyle,
  getNudgeDelta,
  getZoomChord,
  pushRecent,
  rememberConnectorStyle,
  rememberNodeStyle,
  resolveClipboardChord,
  resolveToolShortcut,
  wrapAdapterWithHistory,
} from '@seeflow/canvas';
import type { ReactFlowInstance } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Position = { x: number; y: number };

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the element is a form control or contentEditable surface. */
const isEditableElement = (el: Element | null): boolean => {
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
};

/**
 * Apply a z-order reorder op to a list of node ids. Mirrors the server's
 * `reorderNodes` in `apps/studio/src/api.ts` so the optimistic UI matches what
 * the file rewrite eventually produces. Returns null on a no-op (id missing,
 * forward at end, backward at start, etc.) so the caller can skip the PATCH.
 */
export const applyReorderOpToIds = (
  ids: readonly string[],
  id: string,
  op: ReorderOp,
): string[] | null => {
  const fromIdx = ids.indexOf(id);
  if (fromIdx < 0) return null;
  const len = ids.length;
  const next = [...ids];
  switch (op.op) {
    case 'forward': {
      if (fromIdx >= len - 1) return null;
      const a = next[fromIdx];
      const b = next[fromIdx + 1];
      if (a === undefined || b === undefined) return null;
      next[fromIdx] = b;
      next[fromIdx + 1] = a;
      return next;
    }
    case 'backward': {
      if (fromIdx <= 0) return null;
      const a = next[fromIdx];
      const b = next[fromIdx - 1];
      if (a === undefined || b === undefined) return null;
      next[fromIdx] = b;
      next[fromIdx - 1] = a;
      return next;
    }
    case 'toFront': {
      if (fromIdx === len - 1) return null;
      const [removed] = next.splice(fromIdx, 1);
      if (removed === undefined) return null;
      next.push(removed);
      return next;
    }
    case 'toBack': {
      if (fromIdx === 0) return null;
      const [removed] = next.splice(fromIdx, 1);
      if (removed === undefined) return null;
      next.unshift(removed);
      return next;
    }
    case 'toIndex': {
      const target = Math.min(Math.max(op.index, 0), len - 1);
      if (target === fromIdx) return null;
      const [removed] = next.splice(fromIdx, 1);
      if (removed === undefined) return null;
      next.splice(target, 0, removed);
      return next;
    }
  }
};

export interface DemoViewProps {
  /** US-010: project slug parsed from `/projects/:project/flows/:flow`. */
  project: string;
  /** US-010: flow slug parsed from `/projects/:project/flows/:flow`. */
  flow: string;
  slug: string;
  demos: FlowSummary[];
  detail: FlowDetail | null;
  loading: boolean;
  runs: NodeRuns;
  nodeEvents: NodeEventLog;
  /**
   * US-006: latest StatusReport per node, driven by `node:status` SSE events.
   * Empty when no statusAction has reported yet. US-007 will consume this in
   * the node renderers (play-node / state-node) and the sidebar; for now the
   * prop just plumbs the data down so the wiring is in place.
   */
  statusByNode: NodeStatuses;
  /**
   * Monotonic counter bumped by App on every genuine `flow:reload` (watcher
   * file-change). Drives the undo-history stale-clear so it keys off real
   * reloads rather than every `detail`/`demoNodes` identity change — a routine
   * SSE reconnect refetch must NOT wipe a populated undo stack.
   */
  externalReloadSignal: number;
  onPlayNode: (nodeId: string) => void;
  /** US-031: refresh the global demos list. Called after flow CRUD so the
   *  navigation lands on a page that resolves through `demos.find(...)`. */
  refreshFlows: () => Promise<void> | void;
}

export function DemoView({
  project,
  flow,
  slug,
  demos,
  detail,
  loading,
  runs,
  nodeEvents,
  statusByNode,
  externalReloadSignal,
  onPlayNode,
  refreshFlows,
}: DemoViewProps) {
  const summary = demos.find((d) => d.slug === slug);
  // US-024: per-project flow list powers the Figma-style switcher popover
  // anchored top-left on the canvas page. Refetches when `project` changes;
  // null preserves the popover's idle state during the URL → props handoff.
  const {
    flows: projectFlows,
    createFlow: createProjectFlow,
    renameFlow: renameProjectFlow,
    deleteFlow: deleteProjectFlow,
  } = useProjectFlows(project);
  // US-019: multi-select. Selection is now an array; the inspector still
  // single-shots (1 node OR 1 connector — see derivations below) so its UX
  // doesn't change for the existing single-select paths. The style strip and
  // canvas selection rings honor the full arrays.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<string[]>([]);
  // US-015: id of a freshly drop-popover-created node that should mount in
  // inline label-edit mode. Read by SeeflowCanvas (injected as
  // `data.autoEditOnMount: true` on that node) and consumed once at the node's
  // first render; we don't bother clearing it because the node's internal
  // `isEditing` state is hooks-owned and indifferent to later renders.
  const [pendingEditNodeId, setPendingEditNodeId] = useState<string | null>(null);
  // Keep selection ids stable in a ref so keyboard handlers (Cmd+A / Cmd+C /
  // Cmd+D / Delete) read the latest set without re-binding the listener on
  // every render.
  const selectedIdsRef = useRef(selectedIds);
  const selectedConnectorIdsRef = useRef(selectedConnectorIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  useEffect(() => {
    selectedConnectorIdsRef.current = selectedConnectorIds;
  }, [selectedConnectorIds]);
  // US-014: `onDeleteNode` (defined first) needs to route group deletes to
  // the batch delete path `onDeleteSelection` (defined later) so the cascade
  // is one undo entry. A ref bridges the forward reference — the effect below
  // keeps it pointed at the latest closure as `onDeleteSelection`'s deps
  // change.
  const onDeleteSelectionRef = useRef<((nodeIds: string[], connIds: string[]) => void) | null>(
    null,
  );
  // US-015: imperative handle on the in-canvas ShareMenu / export workflow.
  // The canvas owns capture (fit-view + snapshot + restore) and dispatches
  // PDF/PNG downloads internally; the studio reaches in through this ref for
  // command-palette entries and the "Export to seeflow.dev" dialog's preview
  // thumbnail.
  const canvasRef = useRef<SeeflowCanvasHandle>(null);
  // Generalized optimistic overrides for nodes + connectors. Set on user
  // edits BEFORE firing the API call; pruned on the next flow:reload echo
  // (server caught up); dropped on API failure (revert to server state).
  const nodePending = usePendingOverrides<FlowNode>();
  const connectorPending = usePendingOverrides<Connector>();
  // US-016: optimistic-delete sets. `mark()` BEFORE firing the DELETE API
  // call so the entity disappears from the canvas in the same React tick;
  // pruned on the next flow:reload echo (server confirmed delete) or
  // unmarked on API failure (rollback restores the entity).
  const nodeDeletions = usePendingDeletions();
  const connectorDeletions = usePendingDeletions();
  // Optimistic z-order override (US-006). Holds the displayed node-id order
  // while a `reorderNode` PATCH is in flight; cleared once the server's
  // demoNodes order matches it (SSE echo of the file rewrite). Per-id
  // overrides aren't a fit because the entire array order is what changes.
  const [nodeOrderOverride, setNodeOrderOverride] = useState<string[] | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  // Canvas mode (Select / Hand / Draw) lives on the page so the global bare-
  // key handler (V/H/R/O/T/S/D) and the command palette can drive tool
  // switches. SeeflowCanvas reads `canvasMode` and calls `setCanvasMode` from
  // props — its toolbar wiring is unchanged. Mirror into a ref so the bare-
  // key keydown effect reads the live value without re-binding.
  const [canvasMode, setCanvasMode] = useState<CanvasMode>({ kind: 'select' });
  const canvasModeRef = useRef<CanvasMode>({ kind: 'select' });
  useEffect(() => {
    canvasModeRef.current = canvasMode;
  }, [canvasMode]);
  // US-006: command-palette open state. The Cmd/Ctrl+P chord flips this true
  // and the (placeholder) dialog renders gated on it. Full UI lands in US-007.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // US-004: linkflow picker state. `null` means closed. `nodeId` is the
  // active linkflow node whose `data.target` will be patched on commit;
  // `mode` drives the dialog title ("Link to a flow" vs. "Change linked flow")
  // and whether the dialog pre-selects the current target.
  const [linkflowPicker, setLinkflowPicker] = useState<{
    nodeId: string;
    mode: 'link' | 'edit';
  } | null>(null);
  // Per-tab record of (project, flow) pairs that have already received their
  // one auto-fit. SeeflowCanvas remounts on every flow switch (its `key` is
  // `${project}/${flow}`), so without this gate every switch-back would re-fit
  // and yank the user's viewport. Lives in a ref so adding a key never
  // schedules a re-render. Resets on a full page reload — desired: the first
  // flow opened after reload still gets the framing convenience.
  const fittedFlowsRef = useRef<Set<string>>(new Set());
  const flowKey = `${project}/${flow}`;
  const isFirstLoad = !fittedFlowsRef.current.has(flowKey);
  useEffect(() => {
    fittedFlowsRef.current.add(flowKey);
  }, [flowKey]);
  // React Flow instance handed up from `<SeeflowCanvas onRfInit>` (US-024). Used
  // by the zoom-chord handler below — only the page owns the keyboard
  // listener so the canvas stays free of page-level chord wiring.
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const onRfInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;
  }, []);

  const { reset: resetNodeOverrides } = nodePending;
  const { reset: resetConnectorOverrides } = connectorPending;
  const { reset: resetNodeDeletions } = nodeDeletions;
  const { reset: resetConnectorDeletions } = connectorDeletions;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on demo id change.
  useEffect(() => {
    setSelectedIds([]);
    setSelectedConnectorIds([]);
    setPendingEditNodeId(null);
    resetNodeOverrides();
    resetConnectorOverrides();
    resetNodeDeletions();
    resetConnectorDeletions();
    setNodeOrderOverride(null);
    setEditError(null);
    clipboardRef.current = null;
    setHasClipboard(false);
    // US-008: drop any in-flight upload retry entries — they're scoped to the
    // previous demo's optimistic nodes which have already been reset above.
    imageRetryRef.current.clear();
    // History stack is per-flow — the `useMemo` keyed on `[rawAdapter,
    // detail?.id]` rebuilds the wrapper on flow switch so a fresh empty
    // history falls out naturally. No manual clear needed here.
  }, [detail?.id]);

  // React Flow's onSelectionChange — fires for marquee, click, multi-key
  // toggle, pane-click clear. Mirror the arrays into our state; the canvas
  // re-applies them as `selected` on each node/edge so the loop closes
  // controllably.
  const onSelectionChange = useCallback((nodeIds: string[], connectorIds: string[]) => {
    setSelectedIds(nodeIds);
    setSelectedConnectorIds(connectorIds);
  }, []);

  // US-007: the built-in DetailPanel inside <SeeflowCanvas> is driven by
  // `selectedNodeIds[0]` / `selectedConnectorIds[0]`. xyflow's selection
  // already routes through `onSelectionChange`, so the panel opens on click
  // and closes on pane-click (which clears the selection) without a separate
  // panel-target state.

  const demoNodes = detail?.flow?.nodes;
  const demoConnectors = detail?.flow?.connectors;
  const { pruneAgainst: pruneNodeOverrides } = nodePending;
  const { pruneAgainst: pruneConnectorOverrides } = connectorPending;
  const { pruneAgainst: pruneNodeDeletions } = nodeDeletions;
  const { pruneAgainst: pruneConnectorDeletions } = connectorDeletions;

  // Drop the optimistic z-order override once the server's nodes array order
  // matches it (SSE echo of the file rewrite landed). If the server array
  // doesn't match (e.g. a second click is in flight, or an external editor
  // change reordered nodes), keep the override so the user's last pick stays
  // pinned on screen — until the next echo either matches or supersedes it.
  useEffect(() => {
    if (!demoNodes || !nodeOrderOverride) return;
    if (demoNodes.length !== nodeOrderOverride.length) return;
    for (let i = 0; i < demoNodes.length; i++) {
      const serverNode = demoNodes[i];
      const overrideId = nodeOrderOverride[i];
      if (!serverNode || serverNode.id !== overrideId) return;
    }
    setNodeOrderOverride(null);
  }, [demoNodes, nodeOrderOverride]);

  const flowId = detail?.id ?? null;
  // US-010: persistence adapter is built directly from the URL slugs threaded
  // through DemoViewProps. Bound to one (project, flow) for its lifetime;
  // rebuilt on flow switch. Every REST mutation in this file (and the prop
  // threaded to <SeeflowCanvas>) now routes through this adapter.
  const rawAdapter = useMemo(
    () => createRestAdapter({ baseUrl: '', project, flow }),
    [project, flow],
  );
  // Live snapshot of the flow state the wrapper reads when an intercepted
  // mutation needs a `before` value. We use a ref (not the values themselves)
  // so the wrapper identity stays stable across renders — without this every
  // node-state change would invalidate the memo and reset the history stack.
  const flowStateRef = useRef<{ nodes: readonly FlowNode[]; connectors: readonly Connector[] }>({
    nodes: [],
    connectors: [],
  });
  useEffect(() => {
    flowStateRef.current = {
      nodes: demoNodes ?? [],
      connectors: demoConnectors ?? [],
    };
  }, [demoNodes, demoConnectors]);
  // One wrapper per flow id — the wrapper's internal history clears naturally
  // when the wrapper is discarded on flow switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flowId intentionally re-creates the wrapper per flow
  const { adapter, history } = useMemo(
    () => wrapAdapterWithHistory(rawAdapter, () => flowStateRef.current),
    [rawAdapter, flowId],
  );

  // After every demo reload, drop override fields whose values already match
  // the on-disk demo. Reconciling here (not skipping the broadcast on the
  // server) means an editor-driven change still lands cleanly: the matching
  // overrides clear, and the next render uses the server value.
  //
  // NOTE: this effect runs on EVERY `demoNodes` identity change — including
  // reconnect catch-up refetches (`onHello` → `refreshDetail`). It must NOT
  // touch the undo history; the stale-clear lives in its own effect below,
  // keyed on `externalReloadSignal`, so routine reconnects can't wipe undo.
  useEffect(() => {
    if (demoNodes) {
      pruneNodeOverrides(demoNodes);
      // US-016: drop optimistic-delete ids the server has confirmed gone.
      // If a node is still in the snapshot the delete is in flight and the
      // suppression must stay until SSE catches up.
      pruneNodeDeletions(demoNodes);
    }
  }, [demoNodes, pruneNodeOverrides, pruneNodeDeletions]);

  useEffect(() => {
    if (demoConnectors) {
      pruneConnectorOverrides(demoConnectors);
      pruneConnectorDeletions(demoConnectors);
    }
  }, [demoConnectors, pruneConnectorOverrides, pruneConnectorDeletions]);

  // Undo-history stale-clear. Keyed on `externalReloadSignal`, which App bumps
  // ONLY on a genuine `flow:reload` (watcher file-change) — never on reconnect
  // refetches. `history.markExternalChange()` then compares its own
  // `lastMutationAt` (stamped by every intercepted adapter call) against the
  // STALE_MUTATION_WINDOW_MS threshold: our own PATCH echo is recent → kept; a
  // true external edit (text editor / git checkout) is stale → cleared. The
  // first run (mount) is skipped so loading a flow can't clear the fresh stack.
  const staleClearMountedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: externalReloadSignal is the trigger; the effect body intentionally doesn't reference it.
  useEffect(() => {
    if (!staleClearMountedRef.current) {
      staleClearMountedRef.current = true;
      return;
    }
    history.markExternalChange();
  }, [externalReloadSignal, history]);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  // US-025: flow switcher mutation dialogs. Open state lives in this page so
  // the popover (which closes on action) can hand off without keeping itself
  // mounted; the dialog stays mounted until its own onOpenChange flips it.
  const [flowCreateOpen, setFlowCreateOpen] = useState(false);
  const [flowRenameTarget, setFlowRenameTarget] = useState<{
    flowSlug: string;
    name: string;
    icon?: string;
  } | null>(null);
  const [flowDeleteTarget, setFlowDeleteTarget] = useState<{
    flowSlug: string;
    name: string;
    isDefault: boolean;
  } | null>(null);
  const { setOverride: setNodeOverride, dropOverride: dropNodeOverride } = nodePending;
  // Read live displayed position for a node (override merged) so a multi-node
  // drag's snapshot reflects the in-flight visual state, not the stale server
  // value. The override is what the user sees move on the canvas.
  const nodeOverridesRef = useRef(nodePending.overrides);
  useEffect(() => {
    nodeOverridesRef.current = nodePending.overrides;
  }, [nodePending.overrides]);

  const onNodePositionChange = useCallback(
    (nodeId: string, position: Position) => {
      if (!flowId || !adapter) return;
      // Optimistic — the visual stays where the user dropped it without
      // waiting for the PATCH response.
      setNodeOverride(nodeId, { position });
      setEditError(null);
      adapter.updateNodePosition(nodeId, position).catch((err) => {
        // Revert: drop the override so the canvas falls back to server data.
        // The wrapped adapter only pushes on success, so no undo cleanup
        // is needed on rejection.
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNodePosition failed', err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  // US-013: atomic multi-node move (drag-stop with multiple nodes moving
  // together, or arrow-key nudge of a multi-node selection). Snapshots prev
  // for every targeted node, fans out optimistic overrides + PATCHes, and
  // pushes ONE undo entry so a single Cmd+Z reverts the whole group move.
  // Mirrors the onTidy / onStyleNodes batch pattern.
  const onNodePositionsChange = useCallback(
    (updates: { id: string; position: Position }[]) => {
      if (!flowId || !adapter) return;
      if (updates.length === 0) return;
      const targets = updates
        .map((u) => {
          const node = demoNodes?.find((n) => n.id === u.id);
          if (!node) return null;
          return { id: u.id, next: u.position };
        })
        .filter((t): t is { id: string; next: Position } => t !== null);
      if (targets.length === 0) return;
      for (const t of targets) {
        setNodeOverride(t.id, { position: t.next });
      }
      setEditError(null);
      // Wrap the fan-out in a batch so a partial failure rolls back via the
      // batch helper (every successful leg's inverse runs in reverse). On
      // rejection drop every optimistic override for this gesture so the
      // canvas falls back to server state.
      history
        .batch('move-nodes', async () => {
          for (const t of targets) {
            await adapter.updateNodePosition(t.id, t.next);
          }
        })
        .catch((err) => {
          for (const t of targets) dropNodeOverride(t.id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('updateNodePosition batch failed', err);
        });
    },
    [flowId, adapter, history, demoNodes, setNodeOverride, dropNodeOverride],
  );

  // Per-tick resize callback. Fires on every mouse-move during the gesture.
  // Local optimistic update only — backend PATCH + undo push live in
  // onNodeResizeEnd so a single drag produces one round-trip instead of one
  // per tick. The override keeps the dragged footprint pinned across
  // re-renders inside the host's `visibleNodes` pipeline so the SSE round-trip
  // at the end has nothing to fight.
  const onNodeResize = useCallback(
    (nodeId: string, dims: { width: number; height: number; x: number; y: number }) => {
      setNodeOverride(nodeId, {
        position: { x: dims.x, y: dims.y },
        data: { width: dims.width, height: dims.height },
      } as Partial<FlowNode>);
    },
    [setNodeOverride],
  );

  // End-only resize callback. Fires once at mouse release with final dims.
  // US-012: top/left handle drags shift x/y so the opposite corner stays
  // anchored — persistence stores both new size and new position so undo
  // reverts cleanly.
  const onNodeResizeEnd = useCallback(
    (nodeId: string, dims: { width: number; height: number; x: number; y: number }) => {
      if (!flowId || !adapter) return;
      const next = {
        width: dims.width,
        height: dims.height,
        position: { x: dims.x, y: dims.y },
      };
      // Re-assert the optimistic override at final dims (per-tick already set
      // it, but the final dims may differ from the last tick xyflow
      // dispatched). Keeps the resized footprint pinned through the PATCH
      // round-trip + SSE echo.
      setNodeOverride(nodeId, {
        position: next.position,
        data: { width: next.width, height: next.height },
      } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, next).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode resize failed', err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  // Flip the node back to auto-size mode. Used by both type:'html' and
  // type:'component' (the canvas wires this same handler to both fit-to-
  // content props). The studio's mergeNodeUpdates strips width/height server-
  // side per the autoSize invariant, so we don't need to send explicit
  // width/height clears.
  const onHtmlNodeFitToContent = useCallback(
    (nodeId: string) => {
      if (!flowId || !adapter) return;
      const next = { autoSize: true };
      // Optimistic strip: hide the persisted dims locally so the renderer
      // immediately switches to auto-size layout while the PATCH is in flight.
      setNodeOverride(nodeId, {
        data: { autoSize: true, width: undefined, height: undefined },
      } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, next).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode (fit-to-content) failed', err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  // US-007: atomic multi-select bounding-box resize. The canvas overlay
  // pre-computes each scaled node's position/size and dispatches the whole
  // batch via this callback; we commit it as ONE undo entry — Cmd+Z reverts
  // every node's position + size together. Mirrors `onStyleNodes` (US-008):
  // snapshot prev for each target, fan
  // out optimistic overrides BEFORE the PATCHes so the canvas stays pinned
  // through the SSE round-trip, push ONE undo, then fire-and-forget PATCH
  // fan-out. Per-node PATCH failure drops that node's override + surfaces a
  // single banner — the undo entry stays intact (mirrors the group-resize
  // batch path).
  const onMultiResize = useCallback(
    (
      updates: {
        id: string;
        position: { x: number; y: number };
        width?: number;
        height?: number;
      }[],
    ) => {
      if (!flowId || !adapter || updates.length === 0) return;
      type DimsPatch = {
        width?: number;
        height?: number;
        position: { x: number; y: number };
      };
      type Target = { id: string; next: DimsPatch };
      const targets: Target[] = [];
      for (const u of updates) {
        const node = demoNodes?.find((n) => n.id === u.id);
        if (!node) continue;
        const next: DimsPatch = { position: u.position };
        if (u.width !== undefined) next.width = u.width;
        if (u.height !== undefined) next.height = u.height;
        targets.push({ id: u.id, next });
      }
      if (targets.length === 0) return;
      for (const t of targets) {
        const dataPatch: { width?: number; height?: number } = {};
        if (t.next.width !== undefined) dataPatch.width = t.next.width;
        if (t.next.height !== undefined) dataPatch.height = t.next.height;
        setNodeOverride(t.id, {
          position: t.next.position,
          ...(Object.keys(dataPatch).length > 0 ? { data: dataPatch } : {}),
        } as Partial<FlowNode>);
      }
      setEditError(null);
      // Wrap the fan-out in a batch so a partial failure rolls back via the
      // batch helper. Pass a coalesceKey keyed on the SORTED set of node
      // ids: a multi-select resize drag fires this callback per pointer
      // tick (potentially dozens of times in one gesture). Without
      // coalesce, every tick becomes its own batch entry and Cmd+Z only
      // reverts the LAST tick. With coalesce, ticks of the same selection
      // merge into ONE entry within the 500ms window — the merged entry's
      // `undo` is the OLDEST batch's inverses (pre-drag sizes), so a
      // single Cmd+Z reverts the whole drag.
      const sortedIds = targets
        .map((t) => t.id)
        .slice()
        .sort()
        .join(',');
      history
        .batch(
          'multi-resize',
          async () => {
            for (const t of targets) {
              await adapter.updateNode(t.id, t.next);
            }
          },
          { coalesceKey: `multi:resize:${sortedIds}` },
        )
        .catch((err) => {
          for (const t of targets) dropNodeOverride(t.id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('updateNode multi-resize batch failed', err);
        });
    },
    [flowId, adapter, history, demoNodes, setNodeOverride, dropNodeOverride],
  );

  const { setOverride: setConnectorOverride, dropOverride: dropConnectorOverride } =
    connectorPending;

  // Live slider preview during drag — optimistic override only. The full
  // PATCH+undo path runs once on pointer release via onStyleNode/onStyleConnector.
  const onStyleNodePreview = useCallback(
    (nodeId: string, patch: NodeStylePatch) => {
      setNodeOverride(nodeId, { data: patch } as Partial<FlowNode>);
    },
    [setNodeOverride],
  );
  // US-008: live preview for a multi-node selection — fan out the override to
  // every selected node so they update together while the slider drags.
  const onStyleNodesPreview = useCallback(
    (nodeIds: string[], patch: NodeStylePatch) => {
      for (const id of nodeIds) {
        setNodeOverride(id, { data: patch } as Partial<FlowNode>);
      }
    },
    [setNodeOverride],
  );
  const onStyleConnectorPreview = useCallback(
    (connId: string, patch: ConnectorStylePatch) => {
      setConnectorOverride(connId, patch as Partial<Connector>);
    },
    [setConnectorOverride],
  );

  // Style-tab edit on a node: border + background tokens. Cast the partial
  // through Partial<FlowNode> because the discriminated union prevents TS from
  // seeing that 'data' on the override matches the variant of the keyed node.
  const onStyleNode = useCallback(
    (nodeId: string, patch: NodeStylePatch) => {
      if (!flowId || !adapter) return;
      // Remember the user's pick BEFORE the PATCH dispatches — last-used tracks
      // intent (what they picked), not server-confirmed state. A later network
      // failure does not roll the bucket back.
      rememberNodeStyle(DEFAULT_STORAGE_PREFIX, patch);
      setNodeOverride(nodeId, { data: patch } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, patch).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode style failed', err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  // US-008: atomic style-edit across a multi-node selection. Snapshots prev
  // for every targeted node, fans out optimistic overrides + PATCHes, and
  // pushes ONE undo entry so a single Cmd+Z reverts the whole group change.
  // Mirrors the onTidy batch pattern below.
  const onStyleNodes = useCallback(
    (nodeIds: string[], patch: NodeStylePatch) => {
      if (!flowId || !adapter) return;
      if (nodeIds.length === 0) return;
      // Remember the user's pick on the batch path too — the single-node
      // `onStyleNode` does the same.
      rememberNodeStyle(DEFAULT_STORAGE_PREFIX, patch);
      const targetIds = nodeIds.filter((id) => demoNodes?.some((n) => n.id === id));
      if (targetIds.length === 0) return;
      for (const id of targetIds) {
        setNodeOverride(id, { data: patch } as Partial<FlowNode>);
      }
      setEditError(null);
      // Wrap the fan-out in a batch so partial failures roll back via the
      // batch helper. On rejection drop every optimistic override for this
      // gesture so the canvas falls back to server state.
      history
        .batch('style-nodes', async () => {
          for (const id of targetIds) {
            await adapter.updateNode(id, patch);
          }
        })
        .catch((err) => {
          for (const id of targetIds) dropNodeOverride(id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('updateNode style-nodes batch failed', err);
        });
    },
    [flowId, adapter, history, demoNodes, setNodeOverride, dropNodeOverride],
  );

  // Style-tab edit on a connector: color, edge style, direction.
  const onStyleConnector = useCallback(
    (connId: string, patch: ConnectorStylePatch) => {
      if (!flowId || !adapter) return;
      rememberConnectorStyle(DEFAULT_STORAGE_PREFIX, patch);
      setConnectorOverride(connId, patch as Partial<Connector>);
      setEditError(null);
      // Wrapped adapter records the per-field inverse internally.
      adapter.updateConnector(connId, patch).catch((err) => {
        dropConnectorOverride(connId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector failed', err);
      });
    },
    [flowId, adapter, setConnectorOverride, dropConnectorOverride],
  );

  const {
    mark: markNodeDeleted,
    markMany: markNodesDeleted,
    unmark: unmarkNodeDeleted,
    unmarkMany: unmarkNodesDeleted,
  } = nodeDeletions;
  const { markMany: markConnectorsDeleted, unmarkMany: unmarkConnectorsDeleted } =
    connectorDeletions;

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      if (!flowId || !adapter) return;
      const node = demoNodes?.find((n) => n.id === nodeId);
      if (!node) return;
      // Mirror the wrapper's cascade-restore: capture every connector
      // touching the node up-front so the optimistic-delete revert path
      // (on adapter failure) can also clear their hidden flag. The
      // wrapper itself ALSO snapshots cascaded connectors in its
      // `deleteNode` undo — this list is purely for the failure-path
      // unmark, not for restore.
      const cascadedIds = (demoConnectors ?? [])
        .filter((c) => c.source === nodeId || c.target === nodeId)
        .map((c) => c.id);
      const cascadedIdSet = new Set(cascadedIds);
      setEditError(null);
      // US-016: optimistic delete. Hide the node + every cascaded connector
      // from the canvas immediately; the SSE echo will reconcile the server's
      // confirmation, and the API failure handler reverts via `unmark`.
      markNodeDeleted(nodeId);
      if (cascadedIds.length > 0) markConnectorsDeleted(cascadedIds);
      setSelectedIds((prev) => prev.filter((id) => id !== nodeId));
      setSelectedConnectorIds((prev) => prev.filter((id) => !cascadedIdSet.has(id)));
      // The wrapped adapter's `deleteNode` snapshots the node + every
      // connector touching it (in insertion order) BEFORE forwarding to
      // the inner adapter, then pushes an undo entry that recreates them
      // all. We no longer need a host-side cascade-restore closure.
      adapter.deleteNode(nodeId).catch((err) => {
        unmarkNodeDeleted(nodeId);
        if (cascadedIds.length > 0) unmarkConnectorsDeleted(cascadedIds);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('deleteNode failed', err);
      });
    },
    [
      flowId,
      adapter,
      demoNodes,
      demoConnectors,
      markNodeDeleted,
      markConnectorsDeleted,
      unmarkNodeDeleted,
      unmarkConnectorsDeleted,
    ],
  );

  // Right-click → "Bring to front" / "Send backward" / etc. Apply the reorder
  // optimistically (US-006) so the visual stack updates within the same React
  // tick — without waiting for the SSE echo of the file rewrite. The override
  // is the displayed id-order; the prune effect above drops it once the server
  // catches up. Snapshot the node's current displayed index for the `toIndex`
  // undo, so undo restores to where the user moved away from (faithful even
  // under concurrent edits where forward/backward couldn't symmetrically
  // invert from the middle of the array).
  const onReorderNode = useCallback(
    (nodeId: string, op: ReorderOp) => {
      if (!flowId || !adapter || !demoNodes) return;
      const currentIds = nodeOrderOverride ?? demoNodes.map((n) => n.id);
      const newIds = applyReorderOpToIds(currentIds, nodeId, op);
      if (!newIds) return;
      setNodeOrderOverride(newIds);
      setEditError(null);
      adapter.reorderNode(nodeId, op).catch((err) => {
        // Revert: drop the override entirely. The next render uses server
        // state.
        setNodeOrderOverride(null);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('reorderNode failed', err);
      });
    },
    [flowId, adapter, demoNodes, nodeOrderOverride],
  );

  // US-013: atomic multi-target delete. Snapshots every doomed node + every
  // cascaded connector + every explicitly-selected connector, fires the deletes
  // in parallel, and pushes ONE undo entry that re-creates the whole batch on
  // Cmd+Z (single keystroke restores N nodes + their connectors). Mirrors the
  // onTidy / onStyleNodes batch shape.
  const onDeleteSelection = useCallback(
    (nodeIds: string[], connectorIds: string[]) => {
      if (!flowId || !adapter) return;
      if (nodeIds.length === 0 && connectorIds.length === 0) return;
      const cascadingNodeIdSet = new Set(nodeIds);
      const nodeSnapshots = nodeIds
        .map((id) => demoNodes?.find((n) => n.id === id))
        .filter((n): n is FlowNode => !!n);
      // Cascaded connectors: any connector whose source/target is in the
      // doomed node set. The server cascades these as part of deleteNode;
      // mirror it locally so undo can restore them all.
      const cascadedConnectors = (demoConnectors ?? []).filter(
        (c) => cascadingNodeIdSet.has(c.source) || cascadingNodeIdSet.has(c.target),
      );
      // Explicit connector deletes: only ids NOT covered by a node cascade.
      // Otherwise the duplicate delete produces a server-side 404 for the
      // connector that's already gone.
      const cascadedConnIdSet = new Set(cascadedConnectors.map((c) => c.id));
      const explicitConnSnapshots = connectorIds
        .map((id) => demoConnectors?.find((c) => c.id === id))
        .filter((c): c is Connector => !!c)
        .filter((c) => !cascadedConnIdSet.has(c.id));
      if (
        nodeSnapshots.length === 0 &&
        cascadedConnectors.length === 0 &&
        explicitConnSnapshots.length === 0
      ) {
        return;
      }
      setEditError(null);
      // US-016: optimistic batch delete. Hide every doomed node + every
      // explicit/cascaded connector from the canvas immediately. The server
      // replay cascades; the SSE echo eventually drops everything from the
      // demo snapshot, at which point pruneAgainst clears the suppressions.
      const allDoomedNodeIds = nodeSnapshots.map((n) => n.id);
      const allDoomedConnIds = [
        ...cascadedConnectors.map((c) => c.id),
        ...explicitConnSnapshots.map((c) => c.id),
      ];
      if (allDoomedNodeIds.length > 0) markNodesDeleted(allDoomedNodeIds);
      if (allDoomedConnIds.length > 0) markConnectorsDeleted(allDoomedConnIds);
      const childFirstNodeSnapshots = nodeSnapshots;
      // Trim selection so the inspector closes / multi-selection shrinks
      // immediately.
      setSelectedIds((prev) => prev.filter((id) => !cascadingNodeIdSet.has(id)));
      const explicitConnIdSet = new Set(explicitConnSnapshots.map((c) => c.id));
      setSelectedConnectorIds((prev) =>
        prev.filter((id) => !explicitConnIdSet.has(id) && !cascadedConnIdSet.has(id)),
      );
      // Wrap the fan-out in a batch. The wrapper's `deleteNode` snapshots
      // each node + its cascaded connectors per-call, so the batch's
      // combined undo entry restores every doomed node + every cascaded
      // + explicit connector in a single Cmd+Z. Partial-failure rollback
      // is handled by the batch helper — successful legs' inverses run
      // in reverse, eliminating the prior `dropUndoTop` path.
      //
      // US-014: serialize node deletes in children-first order so the
      // schema invariant holds at every intermediate state. Connector
      // deletes fire in parallel — they have no inter-dependencies and
      // the batch helper only cares about ops accumulating in order
      // inside `batchCtx`.
      history
        .batch('delete-selection', async () => {
          for (const n of childFirstNodeSnapshots) {
            await adapter.deleteNode(n.id);
          }
          await Promise.all(explicitConnSnapshots.map((c) => adapter.deleteConnector(c.id)));
        })
        .catch((err) => {
          // Batch rolled back what it could on the server; restore the
          // optimistic visibility for every doomed entity so the canvas
          // returns to the pre-gesture state. (Some legs may have
          // actually deleted on disk — the SSE echo will reconcile.)
          if (allDoomedNodeIds.length > 0) unmarkNodesDeleted(allDoomedNodeIds);
          if (allDoomedConnIds.length > 0) unmarkConnectorsDeleted(allDoomedConnIds);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('deleteSelection batch failed', err);
        });
    },
    [
      flowId,
      adapter,
      history,
      demoNodes,
      demoConnectors,
      markNodesDeleted,
      markConnectorsDeleted,
      unmarkNodesDeleted,
      unmarkConnectorsDeleted,
    ],
  );

  // US-014: keep `onDeleteSelectionRef` pointed at the latest closure so
  // `onDeleteNode` (defined above) can delegate group deletes to the batch
  // path without a forward-reference TDZ.
  useEffect(() => {
    onDeleteSelectionRef.current = onDeleteSelection;
  }, [onDeleteSelection]);

  // Delete/Backspace shortcut: removes EVERY selected node and connector
  // (US-019). Skipped while focus is in any text-editing element so
  // InlineEdit / form controls keep their normal Backspace behavior. The
  // InlineEdit also calls e.stopPropagation(), but the activeElement guard is
  // the durable line of defense — it covers any future input that forgets to
  // stop the bubble. US-013: routes through `onDeleteSelection` so a
  // multi-target delete is a single undo entry.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isEditableElement(document.activeElement)) return;
      // US-018 defense in depth: if any inline editor is mounted (e.g. a
      // connector label being typed into), a stray Backspace whose default
      // action emptied a contenteditable could blur it in Chromium, dropping
      // activeElement to body before this handler runs. Skip the global
      // delete shortcut while ANY editor is on screen — the user must
      // explicitly commit (Enter / blur) or cancel (Escape) first.
      if (document.querySelector('[data-testid="inline-edit-input"]')) return;
      const nodeIds = selectedIdsRef.current;
      const connIds = selectedConnectorIdsRef.current;
      if (nodeIds.length === 0 && connIds.length === 0) return;
      e.preventDefault();
      onDeleteSelection(nodeIds, connIds);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDeleteSelection]);

  // Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo) are now owned by
  // <SeeflowCanvas> via the `history` prop (Task 20) — keeping a host-side
  // handler here would double-fire on every chord. The legacy host branch
  // was deleted as part of Task 21.

  // Three-field consolidation: name (canvas header + sidebar header),
  // description (canvas body + sidebar light-bold), detail (sidebar long-form
  // only). All three share an optimistic-override + undo + keep-visible
  // failure pattern: text edits stay visible on PATCH error (the user
  // shouldn't see their typing snap back when the server hiccups); the undo
  // entry is dropped so Cmd+Z doesn't replay a never-persisted change; the
  // error surfaces in the non-blocking banner. Empty string clears the field
  // on disk via mergeNodeUpdates' '' → delete handling.
  const onNodeNameChange = useCallback(
    (nodeId: string, name: string) => {
      if (!flowId || !adapter) return;
      setNodeOverride(nodeId, { data: { name } } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, { name }).catch((err) => {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode name failed', err);
      });
    },
    [flowId, adapter, setNodeOverride],
  );

  const onNodeDescriptionChange = useCallback(
    (nodeId: string, next: string) => {
      if (!flowId || !adapter) return;
      setNodeOverride(nodeId, { data: { description: next } } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, { description: next }).catch((err) => {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode description failed', err);
      });
    },
    [flowId, adapter, setNodeOverride],
  );

  const onNodeDetailChange = useCallback(
    (nodeId: string, next: string) => {
      if (!flowId || !adapter) return;
      setNodeOverride(nodeId, { data: { detail: next } } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, { detail: next }).catch((err) => {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode detail failed', err);
      });
    },
    [flowId, adapter, setNodeOverride],
  );

  // US-009: persist a new icon name (or clear it via null) from the
  // DetailPanel icon picker. `null` flows through to PATCH unchanged — the
  // studio's mergeNodeUpdates strips the key from disk when icon is null.
  // The optimistic override uses `undefined` for the cleared state so the
  // canvas renders the no-icon variant immediately.
  const onNodeIconChange = useCallback(
    (nodeId: string, next: string | null) => {
      if (!flowId || !adapter) return;
      setNodeOverride(nodeId, {
        data: { icon: next ?? undefined },
      } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, { icon: next }).catch((err) => {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode icon failed', err);
      });
    },
    [flowId, adapter, setNodeOverride],
  );

  // US-004: linkflow target commit. Routes through the wrapped adapter so the
  // patch flows through undo/redo (the wrap-adapter snapshots `data.target`
  // before the call and pushes an inverse). Optimistic override paints the
  // new target on the node immediately; the SSE echo of the file rewrite
  // eventually drops the override via `pruneAgainst`.
  const onCommitLinkflowTarget = useCallback(
    (nodeId: string, target: LinkflowPickerTarget) => {
      if (!flowId || !adapter) return;
      setNodeOverride(nodeId, { data: { target } } as Partial<FlowNode>);
      setEditError(null);
      adapter.updateNode(nodeId, { target }).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode target failed', err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  const onCreateShapeNode = useCallback(
    (shape: GeometricNodeType, position: Position, dims: { width: number; height: number }) => {
      if (!flowId || !adapter) return;
      setEditError(null);
      // Generate the id client-side so the optimistic override and the
      // server echo share an id — the SSE-driven prune drops the override
      // cleanly once they match (mirrors `onCreateConnector`).
      const id = `node-${shortId()}`;
      // US-024: fresh shapes start with borderSize=1 + fontSize=12 (text
      // variant gets fontSize only — no border, per US-003). Existing nodes
      // on disk that lack these fields keep their renderer-side fallbacks.
      // Last-used style overlays on top of those factory defaults so a fresh
      // shape mirrors the user's most recent style choice.
      const data = buildNewShapeData(shape, dims, getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node);
      const payload = {
        id,
        type: shape,
        position,
        data,
      };
      // Optimistic: render the new node at the dragged size BEFORE the SSE
      // echo arrives. Without this the node briefly shows at SHAPE_DEFAULT_SIZE
      // (the renderer's pre-`data.width` fallback) and snaps to the dragged
      // size on the next paint.
      const optimistic: FlowNode = {
        id,
        type: shape,
        position,
        data,
      };
      setNodeOverride(id, optimistic as Partial<FlowNode>);
      // Wrapped adapter records the create/delete inverse internally.
      adapter.createNode(payload).catch((err) => {
        dropNodeOverride(id);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('createNode failed', err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  // US-013 (icon picker): commit a new type:'icon' node at the picked viewport
  // position. Mirrors `onCreateShapeNode`: client-side id, optimistic override
  // so the node appears before the SSE echo arrives, single undo entry pushed
  // from the .then so it binds to the server-issued id. The new node is also
  // marked selected on success so the detail panel + style strip open on it.
  const onCreateIconNode = useCallback(
    (iconName: string, position: Position) => {
      if (!flowId || !adapter) return;
      setEditError(null);
      const id = `node-${shortId()}`;
      const data = {
        icon: iconName,
        width: ICON_DEFAULT_SIZE.width,
        height: ICON_DEFAULT_SIZE.height,
      };
      const payload = {
        id,
        type: 'icon' as const,
        position,
        data,
      };
      const optimistic: FlowNode = {
        id,
        type: 'icon',
        position,
        data,
      };
      setNodeOverride(id, optimistic as Partial<FlowNode>);
      setSelectedIds([id]);
      adapter.createNode(payload).catch((err) => {
        dropNodeOverride(id);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('createNode (icon) failed', err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  // Commit a new type:'html' node at the drop position from the toolbar's HTML
  // block tile. Mirrors `onCreateShapeNode`: client-side id, optimistic override
  // so the node appears before the SSE echo arrives, single undo entry pushed
  // from the .then so it binds to the server-issued id.
  //
  // Body sent is `{ id, type: 'html', position, data: {} }` — empty data
  // means no inline HTML; the server externalizes (an empty) `view.html` per
  // the per-node-files spec and persists `data.html = "file://nodes/<id>/view.html"`.
  // The renderer reads resolved content from `data.html` on the SSE echo.
  const onCreateHtmlNode = useCallback(
    (args: { position: Position }) => {
      if (!flowId || !adapter) return;
      setEditError(null);
      const id = `node-${shortId()}`;
      const payload = {
        id,
        type: 'html' as const,
        position: args.position,
        data: {},
      };
      const optimistic: FlowNode = {
        id,
        type: 'html',
        position: args.position,
        data: {},
      };
      setNodeOverride(id, optimistic as Partial<FlowNode>);
      setSelectedIds([id]);
      adapter.createNode(payload).catch((err) => {
        dropNodeOverride(id);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error("createNode (type:'html') failed", err);
      });
    },
    [flowId, adapter, setNodeOverride, dropNodeOverride],
  );

  // US-008: retry map for in-flight image uploads. Keyed by the optimistic
  // node id; entries are added when the canvas commits a drop and removed
  // once the upload + createNode pair succeeds. Persisted across renders
  // via a ref (the map mutates in place; renders shouldn't churn from a
  // upload-progress dictionary).
  const imageRetryRef = useRef<
    Map<
      string,
      {
        file: File;
        originalFilename: string;
        position: Position;
        dims: { width: number; height: number };
      }
    >
  >(new Map());

  const rememberImageRetry = useCallback(
    (
      nodeId: string,
      args: {
        file: File;
        originalFilename: string;
        position: Position;
        dims: { width: number; height: number };
      },
    ) => {
      imageRetryRef.current.set(nodeId, args);
    },
    [],
  );
  const forgetImageRetry = useCallback((nodeId: string) => {
    imageRetryRef.current.delete(nodeId);
  }, []);

  // US-008: shared upload-and-persist runner. Called by both the initial drop
  // (`onCreateImageFromFile`) and the retry path (`onRetryImageUpload`).
  // Errors are swallowed and surfaced via the placeholder UX — never via the
  // top-of-canvas editError banner — so a user's transient network glitch
  // doesn't shove an alarming red banner up between drops.
  const runImageUpload = useCallback(
    (args: {
      nodeId: string;
      file: File;
      originalFilename: string;
      position: Position;
      dims: { width: number; height: number };
    }) => {
      if (!flowId || !adapter) return;
      setEditError(null);
      // US-025: image-upload-flow's deps still match the legacy (flowId, …)
      // signatures from `@/lib/api`. Wrap the bound adapter into those shapes
      // so the orchestrator continues to work unchanged; refactoring its
      // signature is out-of-scope for US-025 and lands in a later P4/P5 story.
      // history is threaded through so the upload + createNode pair lands as
      // a single `insert-image` batch — one Cmd+Z reverts both, and the
      // backend cascades the uploaded file when the node is deleted.
      void performImageDropUpload(
        { ...args, flowId, lastUsed: getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node },
        {
          // Re-encode oversized raster images down (longest side <= 2048px)
          // before upload — the node renders <= 400 flow-units anyway, so a
          // full-res phone photo would just bloat the repo / trip the 25 MB
          // server cap. SVG/GIF/decode-failures pass through untouched.
          upload: async (_projectId, nodeId, file, filename) =>
            adapter.uploadImage(nodeId, await downscaleImageFile(file), filename),
          createNode: async (_demoId, body) => {
            const { id } = await adapter.createNode(body);
            return { id };
          },
          setOverride: setNodeOverride,
          history,
          rememberRetry: rememberImageRetry,
          forgetRetry: forgetImageRetry,
        },
      ).catch((err) => {
        console.error('image-upload-flow failed', err);
      });
    },
    [flowId, adapter, history, setNodeOverride, rememberImageRetry, forgetImageRetry],
  );

  const onCreateImageFromFile = useCallback(
    (args: {
      file: File;
      position: Position;
      dims: { width: number; height: number };
      originalFilename: string;
    }) => {
      if (!flowId || !adapter) return;
      // Generate the id client-side so the optimistic override and the server
      // echo share an id (mirrors `onCreateShapeNode`).
      const nodeId = `node-${shortId()}`;
      runImageUpload({ nodeId, ...args });
    },
    [flowId, adapter, runImageUpload],
  );

  const onRetryImageUpload = useCallback(
    (nodeId: string) => {
      const args = imageRetryRef.current.get(nodeId);
      if (!args) return;
      runImageUpload({ nodeId, ...args });
    },
    [runImageUpload],
  );

  // US-015: icon-picker state slice. Lives here (not in demo-canvas) so the
  // detail panel's "Change icon…" button can dispatch openIconPicker('replace',
  // nodeId) without going through SeeflowCanvas. demo-canvas is a transparent
  // pass-through for the toolbar's controlled-open chrome. `mode='replace'`
  // pairs with `nodeId` to tell handleIconPicked which existing node to swap.
  const [iconPicker, setIconPicker] = useState<{
    open: boolean;
    mode: 'insert' | 'replace';
    nodeId?: string;
  }>({ open: false, mode: 'insert' });
  const openIconPicker = useCallback((mode: 'insert' | 'replace', nodeId?: string) => {
    setIconPicker({ open: true, mode, nodeId });
  }, []);
  const closeIconPicker = useCallback(() => {
    setIconPicker((prev) => ({ ...prev, open: false }));
  }, []);
  const handleOpenIconPickerInsert = useCallback(() => {
    openIconPicker('insert');
  }, [openIconPicker]);
  const handleChangeIcon = useCallback(
    (nodeId: string) => openIconPicker('replace', nodeId),
    [openIconPicker],
  );
  // Pick-handler dispatches to either onCreateIconNode (insert) or a
  // single-field PATCH on the existing node (replace). Replace-mode preserves
  // position/size/color/strokeWidth/alt — only data.icon mutates. Both paths
  // call pushRecent and close the picker.
  const handleIconPicked = useCallback(
    (name: string) => {
      pushRecent(name);
      if (iconPicker.mode === 'replace' && iconPicker.nodeId) {
        if (flowId && adapter) {
          const targetId = iconPicker.nodeId;
          setNodeOverride(targetId, { data: { icon: name } } as Partial<FlowNode>);
          setEditError(null);
          // Wrapped adapter records the per-field inverse internally.
          adapter.updateNode(targetId, { icon: name }).catch((err) => {
            dropNodeOverride(targetId);
            setEditError(err instanceof Error ? err.message : String(err));
            console.error('updateNode (icon replace) failed', err);
          });
        }
      } else {
        const rfInstance = rfInstanceRef.current;
        if (rfInstance && flowId) {
          const position = computeIconInsertPosition(rfInstance, {
            width: window.innerWidth,
            height: window.innerHeight,
          });
          onCreateIconNode(name, position);
        }
      }
      closeIconPicker();
    },
    [
      iconPicker.mode,
      iconPicker.nodeId,
      flowId,
      adapter,
      setNodeOverride,
      dropNodeOverride,
      onCreateIconNode,
      closeIconPicker,
    ],
  );

  const onConnectorLabelChange = useCallback(
    (connId: string, label: string) => {
      if (!flowId || !adapter) return;
      setConnectorOverride(connId, { label } as Partial<Connector>);
      setEditError(null);
      // Wrapped adapter records the per-field inverse internally.
      adapter.updateConnector(connId, { label }).catch((err) => {
        // US-021: keep optimistic visible — see `onNodeNameChange` for the
        // failure-mode rationale.
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector label failed', err);
      });
    },
    [flowId, adapter, setConnectorOverride],
  );

  // Create a default connector from a handle-drag gesture (US-029). We
  // generate the id client-side and send it in the POST body so the
  // optimistic override and the server echo share an id — the SSE-driven
  // prune then drops the override cleanly. On failure, drop the override and
  // surface the existing edit-error-banner.
  const onCreateConnector = useCallback(
    (source: string, target: string, options?: { targetPin?: EdgePin }) => {
      if (!flowId || !adapter) return;
      const id = `conn-${shortId()}`;
      // US-025: by default every new connector is floating — both endpoints
      // carry *HandleAutoPicked: true and no handle ids. When the body-drop
      // fallback projected the cursor onto the target node's perimeter, we
      // persist that `targetPin` so the new connector lands on the exact
      // point the user aimed at (user rule: "cursor over node → closest
      // perimeter point").
      const targetPin = options?.targetPin;
      const lastUsedConnector = getLastUsedStyle(DEFAULT_STORAGE_PREFIX).connector;
      const optimistic: Connector = {
        id,
        source,
        target,
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
        ...(targetPin ? { targetPin } : {}),
        ...lastUsedConnector,
      };
      const payload = {
        id,
        source,
        target,
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
        ...(targetPin ? { targetPin } : {}),
        ...lastUsedConnector,
      };
      setConnectorOverride(id, optimistic as Partial<Connector>);
      setEditError(null);
      // Wrapped adapter records the create/delete inverse internally.
      adapter.createConnector(payload).catch((err) => {
        dropConnectorOverride(id);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('createConnector failed', err);
      });
    },
    [flowId, adapter, setConnectorOverride, dropConnectorOverride],
  );

  // US-015: drop-on-pane create-and-connect. Combines `onCreateShapeNode` and
  // `onCreateConnector` into a single transaction so one Cmd+Z reverts the
  // pair. The new node is sized to the shape template (SHAPE_DEFAULT_SIZE);
  // the new connector is floating, mirroring `onCreateConnector`. The new
  // node is also pinned as `pendingEditNodeId` so it mounts in inline label-
  // edit mode. Failure path drops both overrides; the undo entry is only
  // pushed once both creates succeed so undo always has stable ids.
  const onCreateAndConnectFromPane = useCallback(
    ({
      sourceNodeId,
      position,
      shape,
    }: {
      sourceNodeId: string;
      position: Position;
      shape: GeometricNodeType;
    }) => {
      if (!flowId || !adapter) return;
      setEditError(null);
      const newNodeId = `node-${shortId()}`;
      const newConnId = `conn-${shortId()}`;
      const dims = SHAPE_DEFAULT_SIZE[shape];
      // US-024: shape defaults (borderSize=1 + fontSize=12; text variant
      // skips border) — same path the toolbar drag-create uses. Last-used
      // overlay so the dropped node + the connector both carry the user's
      // most recent style.
      const lastUsed = getLastUsedStyle(DEFAULT_STORAGE_PREFIX);
      const shapeData = buildNewShapeData(shape, dims, lastUsed.node);
      const nodePayload = {
        id: newNodeId,
        type: shape,
        position,
        data: shapeData,
      };
      const connPayload: Connector = {
        id: newConnId,
        source: sourceNodeId,
        target: newNodeId,
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
        ...lastUsed.connector,
      };
      // Optimistic: render the new node + edge immediately so the user sees
      // the result before the round-trip resolves.
      const optimisticNode: FlowNode = {
        id: newNodeId,
        type: shape,
        position,
        data: shapeData,
      };
      setNodeOverride(newNodeId, optimisticNode as Partial<FlowNode>);
      setConnectorOverride(newConnId, connPayload as Partial<Connector>);
      setPendingEditNodeId(newNodeId);
      // Persist node first (referential integrity for the connector), then
      // the connector — wrapped in history.batch so the pair undoes together
      // (reverse order: connector first, then node), and partial-failure
      // rollback comes from the batch helper rather than a manual catch.
      history
        .batch('create-and-connect', async () => {
          await adapter.createNode(nodePayload);
          await adapter.createConnector(connPayload);
        })
        .catch((err) => {
          dropNodeOverride(newNodeId);
          dropConnectorOverride(newConnId);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('createAndConnectFromPane failed', err);
        });
    },
    [
      flowId,
      adapter,
      history,
      setNodeOverride,
      dropNodeOverride,
      setConnectorOverride,
      dropConnectorOverride,
    ],
  );

  // In-app clipboard for node copy/paste (US-011). Kept in a ref so we don't
  // leak demo internals into the OS clipboard and don't have to deal with
  // async ClipboardEvent permission prompts. The paired `hasClipboard` state
  // mirrors whether the ref is non-null so the right-click menu's Paste item
  // can subscribe to it (refs don't trigger re-renders). Both reset on
  // demo-id change via the same effect that clears selection state.
  const clipboardRef = useRef<{ nodes: FlowNode[]; connectors: Connector[] } | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  // Mirror the history wrapper's {canUndo, canRedo} into React state so the
  // command palette's enable predicates re-render when entries are pushed /
  // popped. Subscribe once per history identity — the wrapper is rebuilt on
  // flow switch (see the useMemo at the top of the component) so the
  // subscription re-binds automatically. Appended at the END per the
  // CLAUDE.md append-only useState rule for components with hook-shim tests
  // (defensive: the rule also applies to siblings that may grow shims later).
  const [historyState, setHistoryState] = useState<{ canUndo: boolean; canRedo: boolean }>(() => ({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  }));
  useEffect(() => {
    const off = history.subscribe(setHistoryState);
    return off;
  }, [history]);

  const onCopyNodes = useCallback(
    (nodeIds: string[]) => {
      if (!demoNodes) return;
      const idSet = new Set(nodeIds);
      const nodes = demoNodes.filter((n) => idSet.has(n.id));
      if (nodes.length === 0) return;
      // Connectors are copied only when BOTH endpoints are inside the copied
      // set — connectors that touch unselected nodes would dangle on paste.
      const connectors = (demoConnectors ?? []).filter(
        (c) => idSet.has(c.source) && idSet.has(c.target),
      );
      // Deep clone via JSON so a later server-side mutation can't bleed into
      // the clipboard payload (refs would alias the live data otherwise).
      clipboardRef.current = JSON.parse(JSON.stringify({ nodes, connectors }));
      setHasClipboard(true);
    },
    [demoNodes, demoConnectors],
  );

  const onPasteNodes = useCallback(
    (flowPos: Position | null) => {
      if (!flowId || !adapter) return;
      const payload = clipboardRef.current;
      if (!payload || payload.nodes.length === 0) return;
      const { newNodes, newConnectors } = buildPastePayload<FlowNode, Connector>({
        nodes: payload.nodes,
        connectors: payload.connectors,
        flowPos,
        nodeIdGen: () => `node-${shortId()}`,
        connectorIdGen: () => `conn-${shortId()}`,
      });

      // Optimistic overrides — render the pasted entities immediately while
      // the POSTs are in flight. The SSE echo of the rewrite drops the
      // overrides via pruneAgainst once server state matches.
      for (const n of newNodes) {
        setNodeOverride(n.id, n as Partial<FlowNode>);
      }
      for (const c of newConnectors) {
        setConnectorOverride(c.id, c as Partial<Connector>);
      }
      // The pasted clones become the new selection (US-019). Original ids
      // drop out; the user can immediately move/style/delete the pastes as a
      // unit. Pasted connectors are also part of the selection so a single
      // Delete keystroke removes the entire pasted batch.
      setSelectedIds(newNodes.map((n) => n.id));
      setSelectedConnectorIds(newConnectors.map((c) => c.id));
      setEditError(null);

      // Wrap the fan-out in a batch. The wrapper's `createNode` /
      // `createConnector` snapshot their inverse-delete per-call; the
      // batch's combined undo runs them in REVERSE order — i.e.
      // connectors first (avoids "deleted node still has edges" cascade
      // chatter on the server) then nodes. US-013: one Cmd+Z removes
      // every pasted node + connector together. Partial-failure rollback
      // is handled by the batch helper — successful legs' inverses run
      // automatically, then we drop every override.
      history
        .batch('paste', async () => {
          for (const n of newNodes) {
            await adapter.createNode({
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data as unknown as Record<string, unknown>,
            });
          }
          for (const c of newConnectors) {
            await adapter.createConnector(c);
          }
        })
        .catch((err) => {
          for (const n of newNodes) dropNodeOverride(n.id);
          for (const c of newConnectors) dropConnectorOverride(c.id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('paste failed', err);
        });
    },
    [
      flowId,
      adapter,
      history,
      setNodeOverride,
      dropNodeOverride,
      setConnectorOverride,
      dropConnectorOverride,
    ],
  );

  // Keyboard chords routed through `resolveClipboardChord`:
  //   • Cmd+A — select all nodes and connectors (skipped in contenteditable
  //     so InlineEdit's native text-select still works).
  //   • Cmd+D — duplicate (Cmd+C followed by Cmd+V at +24,+24); single
  //     keystroke equivalent to copy+paste.
  // Both are skipped while focus is in any editable element so the browser's
  // native chords keep working inside form controls / InlineEdit.
  //
  // US-022: Cmd+C and Cmd+V are NOT handled here — SeeflowCanvas owns them via
  // its own `handleClipboardShortcut` listener (wired through the new
  // `onCopySelection` / `onPasteSelection` props). The resolver still emits
  // `copy` / `paste` action types for the Cmd+D path, but the dispatcher
  // ignores them when they arrive standalone — the canvas's listener fires
  // first via window-event ordering and already drove the action.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = resolveClipboardChord({
        event: e,
        isEditableActive: isEditableElement(document.activeElement),
        hasNodes: !!demoNodes && demoNodes.length > 0,
        hasConnectors: !!demoConnectors && demoConnectors.length > 0,
        selectedIds: selectedIdsRef.current,
        hasClipboard: !!clipboardRef.current,
      });
      if (action.type === 'noop') return;
      // US-022: copy / paste are owned by the canvas; skip them here to avoid
      // double-firing. The canvas listener already handled the event.
      if (action.type === 'copy' || action.type === 'paste') return;
      e.preventDefault();
      if (action.type === 'selectAll') {
        setSelectedIds((demoNodes ?? []).map((n) => n.id));
        setSelectedConnectorIds((demoConnectors ?? []).map((c) => c.id));
        return;
      }
      // duplicate (Cmd+D) — chain copy+paste in one keystroke.
      onCopyNodes([...action.ids]);
      onPasteNodes(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [demoNodes, demoConnectors, onCopyNodes, onPasteNodes]);

  // US-024: arrow-key nudge. Bare arrows shift every selected node by 1px on
  // the matched axis; Shift+arrow uses 10px. Single-node nudge routes through
  // `onNodePositionChange` so the per-id coalesce key collapses a burst of
  // taps into one undo entry. US-013: multi-node nudge routes through the
  // batch `onNodePositionsChange` so the whole group is one undo entry per
  // keypress (no per-id coalescing — a burst of taps lands as N batch entries
  // back-to-back, same as N batch drags). Pure-connector selections resolve
  // to no updates and the chord becomes a no-op. Editable focus suppresses
  // so InlineEdit / inputs keep the caret-move native behavior.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const delta = getNudgeDelta(e);
      if (!delta) return;
      if (isEditableElement(document.activeElement)) return;
      const ids = selectedIdsRef.current;
      if (ids.length === 0) return;
      // Read the LIVE displayed position (override merged) so a tap-tap-tap
      // burst keeps stacking on the in-flight position rather than the stale
      // server snapshot.
      const overrides = nodePending.overrides;
      const liveNodes = (demoNodes ?? []).map((n) => {
        const pos = overrides[n.id]?.position ?? n.position;
        return { id: n.id, position: pos };
      });
      const updates = applyNudge(delta, ids, liveNodes);
      if (updates.length === 0) return;
      e.preventDefault();
      if (updates.length === 1) {
        const u = updates[0];
        if (u) onNodePositionChange(u.id, u.position);
      } else {
        onNodePositionsChange(updates);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [demoNodes, nodePending.overrides, onNodePositionChange, onNodePositionsChange]);

  // US-024: zoom chords. Cmd+0 → fitView, Cmd+= (and Cmd+Shift+=) → zoomIn,
  // Cmd+- → zoomOut. preventDefault fires even when the rfInstance isn't
  // ready yet so the browser's native reset-zoom never escapes (the user
  // doesn't have to click the canvas first). Editable focus suppresses for
  // consistency with the other chords.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = getZoomChord(e);
      if (!action) return;
      if (isEditableElement(document.activeElement)) return;
      e.preventDefault();
      const inst = rfInstanceRef.current;
      if (!inst) return;
      if (action === 'fit') inst.fitView({ padding: 0.2, duration: 200 });
      else if (action === 'in') inst.zoomIn({ duration: 150 });
      else inst.zoomOut({ duration: 150 });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // US-026: auto-layout (Tidy). Resolve scope, snapshot prev positions, ask
  // the adapter for an ELK-backed layout, optimistically override every
  // moved node, fan-out PATCHes via Promise.allSettled, and push ONE undo
  // entry that reverts the whole batch. Width/height feed ELK's spacing; we
  // read measured dims from the live React Flow internals when available so
  // resized nodes get accurate gutters, falling back to data.width/data.height
  // (then 200×120) when the canvas hasn't reported a size yet.
  const onTidy = useCallback(
    async (scope: 'all' | 'selection') => {
      if (!flowId || !adapter || !demoNodes) return;
      if (!adapter.computeLayout) return;
      const overrides = nodePending.overrides;
      const inst = rfInstanceRef.current;
      const selectedSet = scope === 'selection' ? new Set(selectedIdsRef.current) : null;
      const includedNodes = selectedSet
        ? demoNodes.filter((n) => selectedSet.has(n.id))
        : demoNodes;
      if (includedNodes.length < 2) return;
      const includedIdSet = new Set(includedNodes.map((n) => n.id));
      const includedConnectors = (demoConnectors ?? []).filter(
        (c) => includedIdSet.has(c.source) && includedIdSet.has(c.target),
      );

      // Snapshot live positions before the layout call so the offset-anchor
      // math below can use the dimensions we actually fed into ELK.
      const livePositions = new Map<string, Position>();
      const layoutNodes: LayoutNodeInput[] = includedNodes.map((n) => {
        const livePos = overrides[n.id]?.position ?? n.position;
        livePositions.set(n.id, livePos);
        const internal = inst?.getInternalNode(n.id);
        const measured = internal?.measured;
        const dataAny = n.data as { width?: number; height?: number };
        const width = measured?.width ?? dataAny.width ?? 200;
        const height = measured?.height ?? dataAny.height ?? 120;
        return { id: n.id, type: n.type as LayoutNodeInput['type'], width, height };
      });
      const layoutEdges = includedConnectors.map((c) => ({
        id: c.id,
        source: c.source,
        target: c.target,
      }));
      const result = await adapter.computeLayout(layoutNodes, layoutEdges);
      const next = new Map<string, { x: number; y: number }>();
      for (const [id, entry] of Object.entries(result.nodes)) {
        next.set(id, entry.position);
      }

      // Anchor the laid-out group to its current visual top-left so a
      // selection-scoped Tidy doesn't teleport the cluster across the canvas.
      let prevMinX = Number.POSITIVE_INFINITY;
      let prevMinY = Number.POSITIVE_INFINITY;
      let nextMinX = Number.POSITIVE_INFINITY;
      let nextMinY = Number.POSITIVE_INFINITY;
      for (const ln of layoutNodes) {
        const prev = livePositions.get(ln.id);
        if (!prev) continue;
        if (prev.x < prevMinX) prevMinX = prev.x;
        if (prev.y < prevMinY) prevMinY = prev.y;
        const np = next.get(ln.id);
        if (!np) continue;
        if (np.x < nextMinX) nextMinX = np.x;
        if (np.y < nextMinY) nextMinY = np.y;
      }
      const offsetX =
        Number.isFinite(prevMinX) && Number.isFinite(nextMinX) ? prevMinX - nextMinX : 0;
      const offsetY =
        Number.isFinite(prevMinY) && Number.isFinite(nextMinY) ? prevMinY - nextMinY : 0;

      // Build the moves list (only changes ≥ 1px on either axis qualify) and
      // capture a per-id prev snapshot for the single batched undo entry.
      const moves: { id: string; prev: Position; next: Position }[] = [];
      for (const ln of layoutNodes) {
        const prev = livePositions.get(ln.id);
        const np = next.get(ln.id);
        if (!prev || !np) continue;
        const targetPos = { x: np.x + offsetX, y: np.y + offsetY };
        const dx = targetPos.x - prev.x;
        const dy = targetPos.y - prev.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        moves.push({ id: ln.id, prev, next: targetPos });
      }
      if (moves.length === 0) return;

      setEditError(null);
      for (const m of moves) {
        setNodeOverride(m.id, { position: m.next });
      }
      // Wrap the fan-out in a batch. The wrapper's `updateNodePosition`
      // snapshots each node's prior position per-call; the batch's
      // combined undo restores every prior position in reverse order.
      // On partial failure the batch helper rolls back successful legs;
      // we drop every override so the canvas falls back to server state.
      history
        .batch('tidy', async () => {
          for (const m of moves) {
            await adapter.updateNodePosition(m.id, m.next);
          }
        })
        .catch((err) => {
          for (const m of moves) dropNodeOverride(m.id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('Tidy batch failed', err);
        });
    },
    [
      flowId,
      adapter,
      history,
      demoNodes,
      demoConnectors,
      nodePending.overrides,
      setNodeOverride,
      dropNodeOverride,
    ],
  );

  // US-026: Cmd+Shift+L (Mac) / Ctrl+Shift+L (other) → Tidy. Selection-empty
  // tidies the whole canvas; non-empty tidies just the selected nodes (and
  // connectors between them). Skipped in editable elements like every other
  // chord. preventDefault fires unconditionally so the browser's
  // history-clear-recent-on Cmd+Shift+L (Firefox) doesn't escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!e.shiftKey) return;
      if (e.altKey) return;
      if (e.key.toLowerCase() !== 'l') return;
      if (isEditableElement(document.activeElement)) return;
      e.preventDefault();
      const scope = selectedIdsRef.current.length > 0 ? 'selection' : 'all';
      onTidy(scope);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onTidy]);

  // Toolbar button click: same scope rule as the chord (selection-empty →
  // 'all'). Handed to <SeeflowCanvas> below; CanvasToolbar disables the button
  // when no demo is loaded (onTidy unset).
  const onToolbarTidy = useCallback(() => {
    const scope = selectedIdsRef.current.length > 0 ? 'selection' : 'all';
    onTidy(scope);
  }, [onTidy]);

  // Bare-key tool-switch shortcuts (V/H/R/O/T/S/D). Mirrors the Figma/Miro
  // convention — pressing a letter alone arms the matching tool, pressing it
  // again exits to Select (same toggle as the toolbar button click). The pure
  // resolver (`resolveToolShortcut`) handles modifier rejection so chords
  // (Cmd+V paste, Cmd+D duplicate, Shift+letter typing) fall through.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip while focus is in any text-editing element so InlineEdit / inputs
      // / textareas / contentEditable surfaces keep their normal typing
      // behavior — bare letters there are literal characters.
      if (isEditableElement(document.activeElement)) return;
      // Defense in depth: if an inline editor is mounted (connector label
      // mid-edit etc.), the active element may have blurred to body in a way
      // that slips past the check above. Skip while ANY editor is on screen.
      if (document.querySelector('[data-testid="inline-edit-input"]')) return;
      const resolved = resolveToolShortcut(e);
      if (resolved === null) return;
      const current = canvasModeRef.current;
      if (resolved === 'select') {
        // V always arms Select. No toggle (you can't unselect the neutral).
        if (current.kind !== 'select') setCanvasMode({ kind: 'select' });
        return;
      }
      if (resolved === 'hand') {
        // H toggles Hand on/off, exiting to Select on second press.
        setCanvasMode(current.kind === 'hand' ? { kind: 'select' } : { kind: 'hand' });
        return;
      }
      // A shape key: toggle into / out of Draw for that shape.
      if (current.kind === 'draw' && current.shape === resolved) {
        setCanvasMode({ kind: 'select' });
        return;
      }
      setCanvasMode({ kind: 'draw', shape: resolved });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Hierarchical Escape: (1) from Hand/Draw, exit to Select; (2) from Select
  // with a non-empty selection, clear the selection; (3) from Select with no
  // selection, no-op (let other handlers see it). Intentionally does NOT
  // preventDefault so dialogs / popovers that listen for Escape keep firing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditableElement(document.activeElement)) return;
      if (document.querySelector('[data-testid="inline-edit-input"]')) return;
      const current = canvasModeRef.current;
      if (current.kind !== 'select') {
        setCanvasMode({ kind: 'select' });
        return;
      }
      if (selectedIdsRef.current.length > 0) setSelectedIds([]);
      if (selectedConnectorIdsRef.current.length > 0) setSelectedConnectorIds([]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // US-005: bare 'F' → zoom-to-selection (Figma convention). Modifier-rejection
  // guarantees it never shadows Cmd/Ctrl+F (find) or similar chords. Empty
  // selection no-ops so the key never accidentally triggers a fit-all — that
  // remains Cmd+0's job (zoom chord handler above).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (isEditableElement(document.activeElement)) return;
      if (document.querySelector('[data-testid="inline-edit-input"]')) return;
      const ids = selectedIdsRef.current;
      if (ids.length === 0) return;
      const inst = rfInstanceRef.current;
      if (!inst) return;
      inst.fitView({
        nodes: ids.map((id) => ({ id })),
        padding: 0.2,
        duration: 200,
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // US-005: bare '1' → snap zoom to 100% while preserving the current pan.
  // setViewport with the existing x/y avoids the re-centering that fitView
  // would do. Modifier-rejection keeps Cmd+1 (and any future digit chords)
  // free for other use.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '1') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (isEditableElement(document.activeElement)) return;
      if (document.querySelector('[data-testid="inline-edit-input"]')) return;
      const inst = rfInstanceRef.current;
      if (!inst) return;
      const { x, y } = inst.getViewport();
      inst.setViewport({ x, y, zoom: 1 }, { duration: 150 });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // US-006: single dispatcher for every CommandId. The command palette (US-007)
  // and any future entry point (right-click menu, gesture, etc.) call this
  // instead of duplicating handler glue. Mirrors the existing handler shapes —
  // selection-aware reads go through the live refs so the dispatcher reflects
  // the latest selection without re-binding when the palette opens.
  const runCommand = useCallback(
    (id: CommandId): void => {
      switch (id) {
        case 'tool.select':
          setCanvasMode({ kind: 'select' });
          return;
        case 'tool.hand':
          setCanvasMode({ kind: 'hand' });
          return;
        case 'tool.rectangle':
          setCanvasMode({ kind: 'draw', shape: 'rectangle' });
          return;
        case 'tool.ellipse':
          setCanvasMode({ kind: 'draw', shape: 'ellipse' });
          return;
        case 'tool.text':
          setCanvasMode({ kind: 'draw', shape: 'text' });
          return;
        case 'tool.sticky':
          setCanvasMode({ kind: 'draw', shape: 'sticky' });
          return;
        case 'tool.database':
          setCanvasMode({ kind: 'draw', shape: 'database' });
          return;
        case 'edit.undo': {
          if (!history.canUndo) return;
          history.undo().catch((err) => {
            setEditError(err instanceof Error ? err.message : String(err));
            console.error('undo failed', err);
          });
          return;
        }
        case 'edit.redo': {
          if (!history.canRedo) return;
          history.redo().catch((err) => {
            setEditError(err instanceof Error ? err.message : String(err));
            console.error('redo failed', err);
          });
          return;
        }
        case 'edit.copy': {
          const ids = selectedIdsRef.current;
          if (ids.length === 0) return;
          onCopyNodes([...ids]);
          return;
        }
        case 'edit.paste':
          onPasteNodes(null);
          return;
        case 'edit.duplicate': {
          const ids = selectedIdsRef.current;
          if (ids.length === 0) return;
          onCopyNodes([...ids]);
          onPasteNodes(null);
          return;
        }
        case 'edit.delete': {
          const nodeIds = selectedIdsRef.current;
          const connIds = selectedConnectorIdsRef.current;
          if (nodeIds.length === 0 && connIds.length === 0) return;
          onDeleteSelection([...nodeIds], [...connIds]);
          return;
        }
        case 'edit.selectAll':
          setSelectedIds((demoNodes ?? []).map((n) => n.id));
          setSelectedConnectorIds((demoConnectors ?? []).map((c) => c.id));
          return;
        case 'view.fit': {
          const inst = rfInstanceRef.current;
          if (!inst) return;
          inst.fitView({ padding: 0.2, duration: 200 });
          return;
        }
        case 'view.zoomIn': {
          const inst = rfInstanceRef.current;
          if (!inst) return;
          inst.zoomIn({ duration: 150 });
          return;
        }
        case 'view.zoomOut': {
          const inst = rfInstanceRef.current;
          if (!inst) return;
          inst.zoomOut({ duration: 150 });
          return;
        }
        case 'view.zoom100': {
          const inst = rfInstanceRef.current;
          if (!inst) return;
          const { x, y } = inst.getViewport();
          inst.setViewport({ x, y, zoom: 1 }, { duration: 150 });
          return;
        }
        case 'view.zoomToSelection': {
          const ids = selectedIdsRef.current;
          if (ids.length === 0) return;
          const inst = rfInstanceRef.current;
          if (!inst) return;
          inst.fitView({
            nodes: ids.map((nid) => ({ id: nid })),
            padding: 0.2,
            duration: 200,
          });
          return;
        }
        case 'layout.tidy': {
          const scope = selectedIdsRef.current.length > 0 ? 'selection' : 'all';
          onTidy(scope);
          return;
        }
        case 'selection.deselect':
          if (selectedIdsRef.current.length > 0) setSelectedIds([]);
          if (selectedConnectorIdsRef.current.length > 0) setSelectedConnectorIds([]);
          if (canvasModeRef.current.kind !== 'select') setCanvasMode({ kind: 'select' });
          return;
        case 'help.commandPalette':
          setPaletteOpen(true);
          return;
        case 'export.pdf': {
          // US-015: the canvas owns export — `canvasRef` is populated once
          // <SeeflowCanvas> mounts. The ref object itself is stable across
          // renders so reading `.current` at call time is enough; no bridge
          // ref or useEffect needed. Same applies to export.png below.
          canvasRef.current?.exportPdf();
          return;
        }
        case 'export.png': {
          canvasRef.current?.exportPng();
          return;
        }
      }
    },
    [history, onCopyNodes, onPasteNodes, onDeleteSelection, demoNodes, demoConnectors, onTidy],
  );

  // US-006: Cmd/Ctrl+P opens the command palette. preventDefault fires the
  // moment the chord matches (regardless of focus) so the browser's native
  // Print dialog never escapes — even when focus is inside a node label
  // editor. The palette action itself is suppressed in editable elements so
  // typing flow isn't interrupted by an accidental palette open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'p') return;
      e.preventDefault();
      if (isEditableElement(document.activeElement)) return;
      runCommand('help.commandPalette');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runCommand]);

  // US-015: PDF / PNG capture + download are owned by `<SeeflowCanvas>` (see
  // `useCanvasExport` in @seeflow/canvas). The studio reaches in through
  // `canvasRef` for the command-palette entries above; the in-canvas
  // ShareMenu handles user-driven clicks directly.

  // Drag an edge endpoint onto another node's handle to retarget it, OR drag
  // it onto a different handle on the same node (US-002). The patch only
  // includes the fields that changed (source/target/sourceHandle/targetHandle).
  // Optimistic: the override snaps the edge immediately; SSE echo of the
  // rewrite reconciles.
  const onReconnectConnector = useCallback(
    (
      connId: string,
      patch: {
        source?: string;
        target?: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
        sourceHandleAutoPicked?: boolean;
        targetHandleAutoPicked?: boolean;
        sourcePin?: EdgePin | null;
        targetPin?: EdgePin | null;
      },
    ) => {
      if (!flowId || !adapter) return;
      // Optimistic override: convert wire-format `null` (clear-on-disk
      // signal, US-025) to `undefined` so the merged Connector type stays
      // valid — the visual effect is the same (the field is gone).
      const optimistic: Partial<Connector> = {
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        ...(patch.sourceHandle !== undefined
          ? { sourceHandle: patch.sourceHandle === null ? undefined : patch.sourceHandle }
          : {}),
        ...(patch.targetHandle !== undefined
          ? { targetHandle: patch.targetHandle === null ? undefined : patch.targetHandle }
          : {}),
        ...(patch.sourceHandleAutoPicked !== undefined
          ? { sourceHandleAutoPicked: patch.sourceHandleAutoPicked }
          : {}),
        ...(patch.targetHandleAutoPicked !== undefined
          ? { targetHandleAutoPicked: patch.targetHandleAutoPicked }
          : {}),
        ...(patch.sourcePin !== undefined
          ? { sourcePin: patch.sourcePin === null ? undefined : patch.sourcePin }
          : {}),
        ...(patch.targetPin !== undefined
          ? { targetPin: patch.targetPin === null ? undefined : patch.targetPin }
          : {}),
      };
      setConnectorOverride(connId, optimistic);
      setEditError(null);
      // Wrapped adapter records the per-field inverse internally.
      adapter.updateConnector(connId, patch).catch((err) => {
        dropConnectorOverride(connId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector reconnect failed', err);
      });
    },
    [flowId, adapter, setConnectorOverride, dropConnectorOverride],
  );

  // US-007: persist a new perimeter pin for the named endpoint of a connector.
  // The optimistic override mirrors the existing label/reconnect paths so the
  // edge snaps to the new pin immediately; the PATCH then echoes the same
  // value back via SSE. Undo restores the previous pin (or clears it when
  // the previous state was unpinned) in one entry per drag gesture.
  const onPinEndpoint = useCallback(
    (connId: string, kind: 'source' | 'target', pin: EdgePin) => {
      if (!flowId || !adapter) return;
      const field = kind === 'source' ? 'sourcePin' : 'targetPin';
      setConnectorOverride(connId, { [field]: pin } as Partial<Connector>);
      setEditError(null);
      // Wrapped adapter records the per-field inverse internally.
      adapter.updateConnector(connId, { [field]: pin }).catch((err) => {
        dropConnectorOverride(connId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector pin failed', err);
      });
    },
    [flowId, adapter, setConnectorOverride, dropConnectorOverride],
  );

  // US-007: clear an existing pin for the named endpoint of a connector. The
  // optimistic override sets the field to `undefined` so the local state
  // matches the post-PATCH disk state; the PATCH sends explicit `null` so
  // mergeConnectorUpdates deletes the field server-side. Undo restores the
  // previous pin in one entry.
  const onUnpinEndpoint = useCallback(
    (connId: string, kind: 'source' | 'target') => {
      if (!flowId || !adapter) return;
      const conn = demoConnectors?.find((c) => c.id === connId);
      const prevPin = conn ? (kind === 'source' ? conn.sourcePin : conn.targetPin) : undefined;
      if (!prevPin) return; // Nothing to unpin.
      const field = kind === 'source' ? 'sourcePin' : 'targetPin';
      setConnectorOverride(connId, { [field]: undefined } as Partial<Connector>);
      setEditError(null);
      // Wrapped adapter records the per-field inverse internally.
      adapter.updateConnector(connId, { [field]: null }).catch((err) => {
        dropConnectorOverride(connId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector unpin failed', err);
      });
    },
    [flowId, adapter, demoConnectors, setConnectorOverride, dropConnectorOverride],
  );

  // Merge pending overrides onto the selected entity so Style-tab controls
  // (active swatches, selected dropdown option) reflect the in-flight edit
  // immediately rather than waiting for the SSE echo. Defined here (above the
  // early returns below) so React's hook order is stable across renders.
  const demo = detail?.flow;
  const nodeOverrides = nodePending.overrides;
  const connectorOverrides = connectorPending.overrides;
  const deletedNodeIds = nodeDeletions.ids;
  const deletedConnectorIds = connectorDeletions.ids;
  // US-007: the built-in DetailPanel inside <SeeflowCanvas> derives its target
  // from `selectedNodeIds[0]` / `selectedConnectorIds[0]` against the
  // visibleNodes/visibleConnectors props we already pass to the canvas — so the
  // optimistic-override + optimistic-delete merging already lives in those
  // arrays. No separate `inspectedNode` / `inspectedConnector` derivation here.

  // Style-strip arrays: every selected entity (with optimistic overrides
  // merged) so the strip can fan out edits across the multi-selection.
  const selectedNodes = useMemo<FlowNode[]>(() => {
    if (!demo || selectedIds.length === 0) return [];
    const byId = new Map(demo.nodes.map((n) => [n.id, n]));
    const out: FlowNode[] = [];
    for (const id of selectedIds) {
      const found = byId.get(id);
      if (!found) continue;
      const ov = nodeOverrides[id];
      if (!ov) {
        out.push(found);
        continue;
      }
      const data = ov.data ? { ...found.data, ...ov.data } : found.data;
      out.push({ ...found, ...ov, data } as FlowNode);
    }
    return out;
  }, [demo, selectedIds, nodeOverrides]);
  const selectedConnectorsList = useMemo<Connector[]>(() => {
    if (!demo || selectedConnectorIds.length === 0) return [];
    const byId = new Map(demo.connectors.map((c) => [c.id, c]));
    const out: Connector[] = [];
    for (const id of selectedConnectorIds) {
      const found = byId.get(id);
      if (!found) continue;
      const ov = connectorOverrides[id];
      out.push(ov ? ({ ...found, ...ov } as Connector) : found);
    }
    return out;
  }, [demo, selectedConnectorIds, connectorOverrides]);

  // Reorder server nodes according to the optimistic z-order override
  // (US-006). Nodes not in the override (e.g. just-pasted ones whose echo
  // arrived after the reorder) are appended at the end so they render on top
  // until the next echo subsumes the override.
  const orderedNodes = useMemo<FlowNode[] | null>(() => {
    if (!demo) return null;
    if (!nodeOrderOverride) return demo.nodes;
    const byId = new Map(demo.nodes.map((n) => [n.id, n]));
    const ordered: FlowNode[] = [];
    const seen = new Set<string>();
    for (const id of nodeOrderOverride) {
      const n = byId.get(id);
      if (n) {
        ordered.push(n);
        seen.add(id);
      }
    }
    for (const n of demo.nodes) {
      if (!seen.has(n.id)) ordered.push(n);
    }
    return ordered;
  }, [demo, nodeOrderOverride]);

  // US-016: hide optimistically-deleted nodes/connectors before the canvas
  // sees them. A pending node delete also suppresses every connector touching
  // it (cascade), so the user never sees a dangling edge mid-flight even if
  // the connector wasn't explicitly marked.
  const visibleNodes = useMemo<FlowNode[] | null>(() => {
    const base = orderedNodes ?? demo?.nodes ?? null;
    if (!base) return null;
    if (deletedNodeIds.size === 0) return base;
    return base.filter((n) => !deletedNodeIds.has(n.id));
  }, [orderedNodes, demo, deletedNodeIds]);
  const visibleConnectors = useMemo<Connector[] | null>(() => {
    const base = demo?.connectors ?? null;
    if (!base) return null;
    if (deletedConnectorIds.size === 0 && deletedNodeIds.size === 0) return base;
    return base.filter(
      (c) =>
        !deletedConnectorIds.has(c.id) &&
        !deletedNodeIds.has(c.source) &&
        !deletedNodeIds.has(c.target),
    );
  }, [demo, deletedConnectorIds, deletedNodeIds]);

  // US-004: inject `onOpenPicker` runtime callback onto every linkflow node so
  // the renderer's three buttons (unlinked CTA / pencil / broken body) can
  // raise the picker dialog. The renderer reads `data.onOpenPicker(mode)` as
  // a runtime-data hook; host injects it here so canvas stays unaware of
  // apps/web state. Identity-stable: the same callback ref is reused across
  // renders, so memoized renderers don't re-render on every parent paint.
  const openLinkflowPicker = useCallback((nodeId: string, mode: 'link' | 'edit') => {
    setLinkflowPicker({ nodeId, mode });
  }, []);
  const linkflowDecoratedNodes = useMemo<FlowNode[] | null>(() => {
    if (!visibleNodes) return null;
    let touched = false;
    const out = visibleNodes.map((n) => {
      if (n.type !== 'linkflow') return n;
      touched = true;
      return {
        ...n,
        data: { ...n.data, onOpenPicker: openLinkflowPicker.bind(null, n.id) },
      } as FlowNode;
    });
    return touched ? out : visibleNodes;
  }, [visibleNodes, openLinkflowPicker]);

  // US-031: when projectFlows is still resolving OR contains the active
  // flow (e.g. just created via the switcher), show the loading state
  // instead of "Unknown demo". The global demos cache is eventually-
  // consistent with the per-project flows list; favor the per-project
  // signal here so a freshly-created flow's brief race window doesn't
  // surface as an error page.
  const projectKnowsActiveFlow = projectFlows?.some((f) => f.flowSlug === flow) ?? false;
  const projectStillLoading = projectFlows === null;
  if (!summary && !projectKnowsActiveFlow && !projectStillLoading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <p className="text-sm font-medium">Unknown demo: {slug}</p>
        <p className="text-xs text-muted-foreground">
          The slug may have been removed. Re-register from the project repo to bring it back.
        </p>
      </div>
    );
  }

  if (!summary || (loading && !detail)) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Loading demo…
      </div>
    );
  }

  // US-007: latest StatusReport for the currently selected node, forwarded into
  // <SeeflowCanvas>'s built-in sidebar. Sliced down to the single first-
  // selected node (multi-select keeps the first id as the inspector target).
  // Undefined when there's no node selection or the node has no entry in the
  // status map (no statusAction defined, or the script hasn't emitted yet).
  const sidebarNodeId = selectedIds[0];
  const sidebarStatusReport = sidebarNodeId ? statusByNode[sidebarNodeId] : undefined;

  return (
    <div className="relative h-full w-full">
      {detail && !detail.valid ? (
        <div
          data-testid="demo-error-banner"
          className="absolute inset-x-0 top-0 z-10 border-b border-rose-500/40 bg-rose-50 px-4 py-2 text-xs text-rose-900 shadow-xs dark:bg-rose-950/40 dark:text-rose-100"
        >
          <span className="font-medium uppercase tracking-wide">Invalid demo: </span>
          <span className="font-mono">{detail.error}</span>
        </div>
      ) : null}

      {/* US-024: the FlowSwitcher itself is mounted via SeeflowCanvas's
          topRightSlot so it sits to the LEFT of the ShareMenu in the canvas's
          top-right action cluster. Only the dialog siblings stay here — they
          portal to document.body via Radix Dialog and don't need to live
          inside the canvas. */}
      <FlowCreateDialog
        open={flowCreateOpen}
        onOpenChange={setFlowCreateOpen}
        onCreate={createProjectFlow}
        onCreated={async (result) => {
          await refreshFlows();
          // Brand-new flow: pre-seed the fitted set so the late-nodes mount-fit
          // path doesn't fire when the user adds the first node to the empty
          // canvas. (See `fittedFlowsRef` above for the per-tab policy.)
          fittedFlowsRef.current.add(`${project}/${result.flowSlug}`);
          navigate(flowPath(project, result.flowSlug));
        }}
      />
      <FlowRenameDialog
        open={flowRenameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFlowRenameTarget(null);
        }}
        flow={flowRenameTarget}
        onRename={renameProjectFlow}
        onRenamed={async (result, previousFlowSlug) => {
          await refreshFlows();
          if (result.flowSlug !== previousFlowSlug) {
            // Rename re-keys the canvas (key={`${project}/${flow}`}) so it
            // remounts under the new slug. Same content though — don't re-fit.
            fittedFlowsRef.current.add(`${project}/${result.flowSlug}`);
            navigate(flowPath(project, result.flowSlug));
          }
        }}
      />
      <FlowDeleteDialog
        open={flowDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFlowDeleteTarget(null);
        }}
        flow={flowDeleteTarget}
        flows={projectFlows ?? []}
        onDelete={deleteProjectFlow}
        onDeleted={async (deletedFlowSlug, newDefault) => {
          await refreshFlows();
          if (deletedFlowSlug !== flow) return;
          const fallback =
            newDefault ??
            projectFlows?.find((f) => f.isDefault && f.flowSlug !== deletedFlowSlug)?.flowSlug;
          if (fallback) navigate(flowPath(project, fallback));
        }}
      />

      {demo && adapter ? (
        <SeeflowCanvas
          // US-026: keying on `${project}/${flow}` forces SeeflowCanvas (and
          // the React Flow root it owns) to remount whenever the user switches
          // flows, so internal selection / viewport / drag state never leaks
          // across flows.
          key={`${project}/${flow}`}
          ref={canvasRef}
          mode="edit"
          adapter={adapter}
          history={history}
          // The FlowSwitcher rides inside the canvas's top-right Panel,
          // sitting to the LEFT of the ShareMenu in the same `sf:flex
          // sf:items-center sf:gap-1` row. Dialog siblings remain in
          // demo-view because Radix portals them to document.body.
          topRightSlot={
            <FlowSwitcher
              project={project}
              activeFlow={flow}
              flows={projectFlows ?? []}
              onSelect={(nextFlow) => {
                if (nextFlow === flow) return;
                navigate(flowPath(project, nextFlow));
              }}
              onCreate={() => setFlowCreateOpen(true)}
              onRename={(flowSlug) => {
                const target = projectFlows?.find((f) => f.flowSlug === flowSlug);
                if (!target) return;
                setFlowRenameTarget({
                  flowSlug: target.flowSlug,
                  name: target.name,
                  icon: target.icon,
                });
              }}
              onDelete={(flowSlug) => {
                const target = projectFlows?.find((f) => f.flowSlug === flowSlug);
                if (!target) return;
                setFlowDeleteTarget({
                  flowSlug: target.flowSlug,
                  name: target.name,
                  isDefault: target.isDefault,
                });
              }}
            />
          }
          // US-010: SeeflowCanvas.projectId drives the project-scoped file URL
          // composition (see fileUrl in @seeflow/canvas) and the embed snippet.
          // Post-US-008, file routes are addressed by project slug — so we
          // pass the URL slug here, not the registry entry id (`flowId`).
          projectId={project}
          // US-031: flowSlug drives the component-runtime's script-action URL
          // composition (`/api/projects/:project/flows/:flow/nodes/.../actions/...`).
          flowSlug={flow}
          enableEmbed={false}
          onExportToCloud={flowId ? () => setExportDialogOpen(true) : undefined}
          nodes={linkflowDecoratedNodes ?? demo.nodes}
          connectors={visibleConnectors ?? demo.connectors}
          selectedNodeIds={selectedIds}
          selectedConnectorIds={selectedConnectorIds}
          onSelectionChange={onSelectionChange}
          runtime={{
            runs,
            statuses: statusByNode,
            pendingOverrides: { nodes: nodeOverrides, connectors: connectorOverrides },
          }}
          onPlayNode={onPlayNode}
          onNodePositionChange={onNodePositionChange}
          onNodePositionsChange={onNodePositionsChange}
          onNodeResize={onNodeResize}
          onNodeResizeEnd={onNodeResizeEnd}
          onHtmlNodeFitToContent={onHtmlNodeFitToContent}
          onComponentNodeFitToContent={onHtmlNodeFitToContent}
          onMultiResize={onMultiResize}
          onNodeNameChange={onNodeNameChange}
          onNodeDescriptionChange={onNodeDescriptionChange}
          onConnectorLabelChange={onConnectorLabelChange}
          onCreateShapeNode={onCreateShapeNode}
          onCreateImageFromFile={flowId ? onCreateImageFromFile : undefined}
          onRetryImageUpload={flowId ? onRetryImageUpload : undefined}
          onCreateHtmlNode={flowId ? onCreateHtmlNode : undefined}
          iconPickerOpen={iconPicker.open}
          onOpenIconPicker={flowId ? handleOpenIconPickerInsert : undefined}
          onCloseIconPicker={flowId ? closeIconPicker : undefined}
          onPickIcon={flowId ? handleIconPicked : undefined}
          onRequestIconReplace={flowId ? handleChangeIcon : undefined}
          onCreateConnector={onCreateConnector}
          onReconnectConnector={onReconnectConnector}
          onPinEndpoint={flowId ? onPinEndpoint : undefined}
          onUnpinEndpoint={flowId ? onUnpinEndpoint : undefined}
          onReorderNode={onReorderNode}
          onDeleteNode={onDeleteNode}
          onCopyNode={(nodeId) => onCopyNodes([nodeId])}
          onPasteAt={onPasteNodes}
          onCopySelection={flowId ? onCopyNodes : undefined}
          onPasteSelection={flowId ? () => onPasteNodes(null) : undefined}
          hasClipboard={hasClipboard}
          selectedNodes={selectedNodes}
          selectedConnectors={selectedConnectorsList}
          onStyleNode={onStyleNode}
          onStyleNodePreview={onStyleNodePreview}
          onStyleNodes={onStyleNodes}
          onStyleNodesPreview={onStyleNodesPreview}
          onStyleConnector={onStyleConnector}
          onStyleConnectorPreview={onStyleConnectorPreview}
          onRfInit={onRfInit}
          onTidy={demoNodes ? onToolbarTidy : undefined}
          onCreateAndConnectFromPane={onCreateAndConnectFromPane}
          pendingEditNodeId={pendingEditNodeId}
          canvasMode={canvasMode}
          onCanvasModeChange={setCanvasMode}
          statusReport={sidebarStatusReport}
          onNameChange={onNodeNameChange}
          onDescriptionChange={onNodeDescriptionChange}
          onDetailChange={onNodeDetailChange}
          onIconChange={onNodeIconChange}
          autoFitView={isFirstLoad}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          No demo data yet.
        </div>
      )}

      {editError ? (
        <div
          data-testid="edit-error-banner"
          className="absolute inset-x-0 bottom-4 z-20 mx-auto w-fit max-w-[80%] rounded-md border border-rose-500/50 bg-rose-50 px-3 py-2 text-xs text-rose-900 shadow-md dark:bg-rose-950/60 dark:text-rose-100"
        >
          <span className="font-medium">Couldn't save change: </span>
          <span className="font-mono">{editError}</span>
          <button
            type="button"
            className="ml-3 underline underline-offset-2"
            onClick={() => setEditError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* US-007: command palette — Cmd/Ctrl+P opens this dialog, full
          searchable list of every command in COMMANDS. Dispatcher is the same
          `runCommand` the chord handlers route through. */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        runCommand={runCommand}
        ctx={{
          hasSelection: selectedIds.length > 0 || selectedConnectorIds.length > 0,
          canUndo: historyState.canUndo,
          canRedo: historyState.canRedo,
          hasClipboard,
          // Export commands need a backing demo. flowId is non-null whenever
          // the canvas can render.
          canExportDemo: Boolean(flowId),
        }}
      />

      {flowId ? (
        <ExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          project={project}
          flowName={detail?.name ?? summary.name}
          onCapturePreview={() => canvasRef.current?.capturePreview() ?? Promise.resolve(undefined)}
        />
      ) : null}

      {/* US-004: linkflow picker dialog. Opens via `data.onOpenPicker(mode)`
          injected into linkflow nodes (see linkflowDecoratedNodes above). The
          commit handler PATCHes the active node's target through the wrapped
          adapter so the change flows through undo/redo + SSE echo. */}
      <LinkflowPickerDialog
        open={linkflowPicker !== null}
        onOpenChange={(open) => {
          if (!open) setLinkflowPicker(null);
        }}
        mode={linkflowPicker?.mode ?? 'link'}
        demos={demos}
        currentSlug={slug}
        initialTarget={
          linkflowPicker?.mode === 'edit'
            ? (() => {
                const node = demoNodes?.find((n) => n.id === linkflowPicker.nodeId);
                if (!node || node.type !== 'linkflow') return null;
                const t = (node.data as { target?: { project: string; flow: string } }).target;
                return t ?? null;
              })()
            : null
        }
        onCommit={(target) => {
          if (!linkflowPicker) return;
          onCommitLinkflowTarget(linkflowPicker.nodeId, target);
        }}
      />
    </div>
  );
}

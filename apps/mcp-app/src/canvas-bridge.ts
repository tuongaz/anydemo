/**
 * Glues the SeeFlow `CanvasAdapter` and React Flow telemetry events to the
 * MCP-Apps host bridge (`bridge.sendMessage` / `bridge.updateModelContext`).
 *
 * Two layers:
 *
 *  1. `wrapAdapter(base, ctx)` — returns a new CanvasAdapter that delegates
 *     to `base` and additionally fires `bridge.sendMessage` on successful
 *     structural-edit calls (createNode, deleteNode, createConnector,
 *     deleteConnector, updateNode-with-name, playAction). The bridge's own
 *     200ms coalescer collapses bursts (e.g. paste a 5-node group) into one
 *     host `sendMessage` call.
 *
 *  2. `createTelemetry(bridge, ctx)` — returns canvas-level callback handlers
 *     for selection / drag / viewport that route to
 *     `bridge.updateModelContext` with a merged `{ selectedNodeIds,
 *     selectedConnectorIds, viewport, dragging }` patch. The bridge's
 *     250ms-debounce-with-1s-throttle keeps these silent during in-flight
 *     gestures and emits a single fresh snapshot once activity settles.
 *
 * Both layers no-op cleanly when `window.openai` is absent — the bridge's
 * `getHost()` short-circuits inside before any host call.
 */

import type {
  CanvasAdapter,
  ConnectorCreateInput,
  NodeCreateInput,
  NodePatch,
} from '@seeflow/canvas';
import type { Bridge } from './bridge';

export interface CanvasBridgeContext {
  /** Slug of the flow currently rendered. Attached to every sendMessage payload. */
  flowSlug?: string;
}

export interface CanvasBridgeAdapter extends CanvasAdapter {}

/**
 * Returns a new adapter that delegates to `base` and fires the corresponding
 * `bridge.sendMessage` event on each successful mutation. Failed calls
 * (rejected promises) DO NOT emit events — the structural edit didn't happen,
 * so the model should not be told it did. Read-only methods (`uploadImage`,
 * `openFile`, `revealFile`, `computeLayout`, `reorderNode`,
 * `updateNodePosition`) are passed through without telemetry because they
 * don't change the flow's structural identity. (Position drags hit
 * `updateNodePosition` per-frame; routing them through `sendMessage` would
 * spam the conversation. Position telemetry instead flows silently through
 * `updateModelContext` via `createTelemetry`.)
 */
export const wrapAdapter = (
  base: CanvasAdapter,
  bridge: Bridge,
  ctx: CanvasBridgeContext,
): CanvasAdapter => {
  const emit = (event: string, payload: Record<string, unknown>): void => {
    bridge.sendMessage({ event, flowSlug: ctx.flowSlug, payload });
  };

  return {
    async createNode(input: NodeCreateInput) {
      const result = await base.createNode(input);
      emit('node-added', {
        nodeId: result.id,
        type: input.type,
        position: input.position,
      });
      return result;
    },

    async updateNode(nodeId: string, patch: NodePatch) {
      await base.updateNode(nodeId, patch);
      // Only the rename channel is conversational; other patches are visual
      // and would be noisy for the model.
      if (typeof patch.name === 'string') {
        emit('node-renamed', { nodeId, name: patch.name });
      }
    },

    updateNodePosition(nodeId, position) {
      // Position-only fast path stays silent — drag telemetry goes through
      // updateModelContext, not the conversational channel.
      return base.updateNodePosition(nodeId, position);
    },

    async deleteNode(nodeId: string) {
      await base.deleteNode(nodeId);
      emit('node-deleted', { nodeId });
    },

    reorderNode(nodeId, op) {
      return base.reorderNode(nodeId, op);
    },

    async createConnector(input: ConnectorCreateInput) {
      const result = await base.createConnector(input);
      emit('connector-added', {
        connectorId: result.id,
        source: input.source,
        target: input.target,
      });
      return result;
    },

    async updateConnector(connectorId, patch) {
      return base.updateConnector(connectorId, patch);
    },

    async deleteConnector(connectorId: string) {
      await base.deleteConnector(connectorId);
      emit('connector-deleted', { connectorId });
    },

    uploadImage(nodeId, file, filename) {
      return base.uploadImage(nodeId, file, filename);
    },

    ...(base.playAction
      ? {
          async playAction(nodeId: string) {
            const baseFn = base.playAction;
            if (!baseFn) throw new Error('playAction not implemented');
            const result = await baseFn(nodeId);
            emit('node-played', {
              nodeId,
              runId: result.runId,
              status: result.status,
              error: result.error,
            });
            return result;
          },
        }
      : {}),

    ...(base.openFile ? { openFile: base.openFile.bind(base) } : {}),
    ...(base.revealFile ? { revealFile: base.revealFile.bind(base) } : {}),
    ...(base.computeLayout ? { computeLayout: base.computeLayout.bind(base) } : {}),
  };
};

export interface TelemetrySnapshot {
  selectedNodeIds?: readonly string[];
  selectedConnectorIds?: readonly string[];
  viewport?: { x: number; y: number; zoom: number };
  /** True between drag-start and drag-stop. */
  dragging?: boolean;
}

export interface CanvasTelemetry {
  onSelectionChange: (nodeIds: string[], connectorIds: string[]) => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
}

/**
 * Returns canvas-callback handlers that emit `updateModelContext` patches.
 * The bridge's debounce + throttle absorbs per-frame viewport / drag bursts —
 * we don't add another layer of throttling here. On drag-stop the snapshot
 * carries `dragging: false`, so any debounced fire after release reflects the
 * settled state.
 */
export const createTelemetry = (bridge: Bridge): CanvasTelemetry => {
  return {
    onSelectionChange(nodeIds, connectorIds) {
      bridge.updateModelContext({
        selectedNodeIds: nodeIds,
        selectedConnectorIds: connectorIds,
      });
    },
    onNodeDragStart() {
      bridge.updateModelContext({ dragging: true });
    },
    onNodeDragStop() {
      bridge.updateModelContext({ dragging: false });
    },
    onViewportChange(viewport) {
      bridge.updateModelContext({ viewport });
    },
  };
};

// wrapIoAdapterAsCanvasAdapter — convert the non-throwing IoAdapter contract
// back into the throw-on-error CanvasAdapter contract that <SeeflowCanvas>
// internally relies on (US-036).
//
// The canvas renders against `CanvasAdapter` (the historical, throw-on-error
// surface). Peer SPAs over a WebSocket transport only naturally expose the
// non-throwing `IoAdapter` shape (results travel as `{ ok, value } | { ok,
// reason }` envelopes — process-boundary friendly). This helper bridges the
// two: every `{ ok: false, reason }` becomes a rejected Promise with
// `Error(reason)` as the message; `{ ok: true, value }` resolves to `value`
// (or to nothing, for void-returning methods).
//
// The wrapped adapter intentionally does NOT carry the optional CanvasAdapter
// fields (`playAction`, `openFile`, `revealFile`, `computeLayout`, `icons`).
// IoAdapter is scoped to the live-share edit RPC surface — those optional
// adapter affordances are out of scope for peers and should be omitted rather
// than no-op'd.

import type { IoAdapter } from './io-adapter.ts';
import type { CanvasAdapter } from './types.ts';

export function wrapIoAdapterAsCanvasAdapter(io: IoAdapter): CanvasAdapter {
  return {
    createNode: async (input) => {
      const r = await io.createNode(input);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
    updateNode: async (nodeId, patch) => {
      const r = await io.updateNode(nodeId, patch);
      if (!r.ok) throw new Error(r.reason);
    },
    updateNodePosition: async (nodeId, position) => {
      const r = await io.updateNodePosition(nodeId, position);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
    deleteNode: async (nodeId) => {
      const r = await io.deleteNode(nodeId);
      if (!r.ok) throw new Error(r.reason);
    },
    reorderNode: async (nodeId, op) => {
      const r = await io.reorderNode(nodeId, op);
      if (!r.ok) throw new Error(r.reason);
    },
    createConnector: async (input) => {
      const r = await io.createConnector(input);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
    updateConnector: async (connectorId, patch) => {
      const r = await io.updateConnector(connectorId, patch);
      if (!r.ok) throw new Error(r.reason);
    },
    deleteConnector: async (connectorId) => {
      const r = await io.deleteConnector(connectorId);
      if (!r.ok) throw new Error(r.reason);
    },
    uploadImage: async (nodeId, file, filename) => {
      const r = await io.uploadImage(nodeId, file, filename);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
  };
}

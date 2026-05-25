// Unit tests for canvasMeta() — the helper that builds the `_meta` payload
// every canvas-bearing tool returns. The 5 canvas-bearing tools (matched to
// the wiring in mcp.ts US-008) call this with a kind/slug/nodeId combination
// specific to the tool; these tests pin the shape contract for each.

import { describe, expect, it } from 'bun:test';
import { CANVAS_RESOURCE_URI, type CanvasWidgetState, canvasMeta } from './mcp-ui.ts';

const BACKEND_URL = 'http://127.0.0.1:54321';
const BACKEND_TOKEN = 'parity-tok-XYZ';

const widgetFromMeta = (meta: Record<string, unknown>): CanvasWidgetState =>
  meta['openai/widgetState'] as CanvasWidgetState;

describe('canvasMeta()', () => {
  it('returns exactly the three host-introspected keys', () => {
    const meta = canvasMeta({
      kind: 'navigate',
      flowSlug: 'hello',
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    expect(Object.keys(meta).sort()).toEqual([
      'openai/outputTemplate',
      'openai/widgetAccessible',
      'openai/widgetState',
    ]);
    expect(meta['openai/outputTemplate']).toBe(CANVAS_RESOURCE_URI);
    expect(meta['openai/widgetAccessible']).toBe(true);
  });

  // The widgetState is passed through verbatim. The 5 tool-specific shapes
  // below mirror the call sites in mcp.ts (US-008) — keep them in lockstep
  // with that file's `canvasMetaFor(ctx, { ... })` calls.
  describe('seeflow_get_flow shape', () => {
    it('kind=navigate with flowSlug, no nodeId/justCreated/projectSlug', () => {
      const meta = canvasMeta({
        kind: 'navigate',
        flowSlug: 'checkout',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('navigate');
      expect(widget.flowSlug).toBe('checkout');
      expect(widget.nodeId).toBeUndefined();
      expect(widget.justCreated).toBeUndefined();
      expect(widget.projectSlug).toBeUndefined();
      expect(widget.backendUrl).toBe(BACKEND_URL);
      expect(widget.backendToken).toBe(BACKEND_TOKEN);
    });
  });

  describe('seeflow_get_flow_graph shape', () => {
    it('kind=navigate with flowSlug, no nodeId/justCreated/projectSlug', () => {
      const meta = canvasMeta({
        kind: 'navigate',
        flowSlug: 'graph-flow',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('navigate');
      expect(widget.flowSlug).toBe('graph-flow');
      expect(widget.nodeId).toBeUndefined();
      expect(widget.justCreated).toBeUndefined();
      expect(widget.projectSlug).toBeUndefined();
    });
  });

  describe('seeflow_get_node shape', () => {
    it('kind=navigate with flowSlug AND nodeId, no justCreated', () => {
      const meta = canvasMeta({
        kind: 'navigate',
        flowSlug: 'checkout',
        nodeId: 'api-checkout',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('navigate');
      expect(widget.flowSlug).toBe('checkout');
      expect(widget.nodeId).toBe('api-checkout');
      expect(widget.justCreated).toBeUndefined();
      expect(widget.projectSlug).toBeUndefined();
    });

    it('omits nodeId when undefined (e.g. slug-only navigation)', () => {
      // Defensive: get_node always supplies nodeId, but the helper itself
      // must not invent it. Pin the contract here.
      const meta = canvasMeta({
        kind: 'navigate',
        flowSlug: 'checkout',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      expect(widgetFromMeta(meta).nodeId).toBeUndefined();
    });
  });

  describe('seeflow_register_flow shape', () => {
    it('kind=create with flowSlug AND justCreated=true', () => {
      const meta = canvasMeta({
        kind: 'create',
        flowSlug: 'fresh-flow',
        justCreated: true,
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('create');
      expect(widget.flowSlug).toBe('fresh-flow');
      expect(widget.justCreated).toBe(true);
      expect(widget.nodeId).toBeUndefined();
      expect(widget.projectSlug).toBeUndefined();
    });
  });

  describe('seeflow_create_project shape', () => {
    it('kind=create with projectSlug and NO justCreated', () => {
      // create_project intentionally OMITS justCreated — the scaffolded
      // flow has no nodes/connectors yet, so there's nothing for the
      // "Just created" pill to highlight. See US-008 learnings.
      const meta = canvasMeta({
        kind: 'create',
        projectSlug: 'my-project',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('create');
      expect(widget.projectSlug).toBe('my-project');
      expect(widget.justCreated).toBeUndefined();
      expect(widget.flowSlug).toBeUndefined();
      expect(widget.nodeId).toBeUndefined();
    });
  });

  it('justCreated only appears on creation shapes (register_flow), never on navigate shapes', () => {
    const navigateShapes: CanvasWidgetState[] = [
      { kind: 'navigate', flowSlug: 's1', backendUrl: BACKEND_URL, backendToken: BACKEND_TOKEN },
      {
        kind: 'navigate',
        flowSlug: 's2',
        nodeId: 'n1',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
    ];
    for (const state of navigateShapes) {
      expect(widgetFromMeta(canvasMeta(state)).justCreated).toBeUndefined();
    }
    // Only register_flow opts into the pill — create_project does NOT.
    const registerMeta = canvasMeta({
      kind: 'create',
      flowSlug: 'reg',
      justCreated: true,
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    expect(widgetFromMeta(registerMeta).justCreated).toBe(true);
    const projectMeta = canvasMeta({
      kind: 'create',
      projectSlug: 'proj',
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    expect(widgetFromMeta(projectMeta).justCreated).toBeUndefined();
  });

  it('nodeId only appears when supplied (get_node)', () => {
    const withNode = canvasMeta({
      kind: 'navigate',
      flowSlug: 's',
      nodeId: 'n',
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    const withoutNode = canvasMeta({
      kind: 'navigate',
      flowSlug: 's',
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    expect(widgetFromMeta(withNode).nodeId).toBe('n');
    expect(widgetFromMeta(withoutNode).nodeId).toBeUndefined();
  });

  it('backendUrl and backendToken are always present across the 5 shapes', () => {
    const shapes: CanvasWidgetState[] = [
      { kind: 'navigate', flowSlug: 'a', backendUrl: BACKEND_URL, backendToken: BACKEND_TOKEN },
      { kind: 'navigate', flowSlug: 'b', backendUrl: BACKEND_URL, backendToken: BACKEND_TOKEN },
      {
        kind: 'navigate',
        flowSlug: 'c',
        nodeId: 'n',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
      {
        kind: 'create',
        flowSlug: 'd',
        justCreated: true,
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
      {
        kind: 'create',
        projectSlug: 'e',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
    ];
    for (const state of shapes) {
      const widget = widgetFromMeta(canvasMeta(state));
      expect(widget.backendUrl).toBe(BACKEND_URL);
      expect(widget.backendToken).toBe(BACKEND_TOKEN);
    }
  });
});

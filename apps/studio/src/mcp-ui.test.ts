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
      projectSlug: 'hello-project',
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
    it('kind=navigate with projectSlug + flowSlug, no nodeId/justCreated', () => {
      const meta = canvasMeta({
        kind: 'navigate',
        projectSlug: 'shop',
        flowSlug: 'checkout',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('navigate');
      expect(widget.projectSlug).toBe('shop');
      expect(widget.flowSlug).toBe('checkout');
      expect(widget.nodeId).toBeUndefined();
      if (widget.kind === 'create') {
        expect(widget.justCreated).toBeUndefined();
      }
      expect(widget.backendUrl).toBe(BACKEND_URL);
      expect(widget.backendToken).toBe(BACKEND_TOKEN);
    });
  });

  describe('seeflow_get_flow_graph shape', () => {
    it('kind=navigate with projectSlug + flowSlug, no nodeId/justCreated', () => {
      const meta = canvasMeta({
        kind: 'navigate',
        projectSlug: 'graph-project',
        flowSlug: 'graph-flow',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('navigate');
      expect(widget.projectSlug).toBe('graph-project');
      expect(widget.flowSlug).toBe('graph-flow');
      expect(widget.nodeId).toBeUndefined();
    });
  });

  describe('seeflow_get_node shape', () => {
    it('kind=navigate with projectSlug + flowSlug + nodeId, no justCreated', () => {
      const meta = canvasMeta({
        kind: 'navigate',
        projectSlug: 'shop',
        flowSlug: 'checkout',
        nodeId: 'api-checkout',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('navigate');
      expect(widget.projectSlug).toBe('shop');
      expect(widget.flowSlug).toBe('checkout');
      expect(widget.nodeId).toBe('api-checkout');
    });

    it('omits nodeId when undefined (e.g. slug-only navigation)', () => {
      // Defensive: get_node always supplies nodeId, but the helper itself
      // must not invent it. Pin the contract here.
      const meta = canvasMeta({
        kind: 'navigate',
        projectSlug: 'shop',
        flowSlug: 'checkout',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      expect(widgetFromMeta(meta).nodeId).toBeUndefined();
    });
  });

  describe('seeflow_register_flow shape', () => {
    it('kind=create with projectSlug + flowSlug AND justCreated=true', () => {
      const meta = canvasMeta({
        kind: 'create',
        projectSlug: 'fresh-project',
        flowSlug: 'fresh-flow',
        justCreated: true,
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      });
      const widget = widgetFromMeta(meta);
      expect(widget.kind).toBe('create');
      expect(widget.projectSlug).toBe('fresh-project');
      expect(widget.flowSlug).toBe('fresh-flow');
      if (widget.kind === 'create') {
        expect(widget.justCreated).toBe(true);
      }
      expect(widget.nodeId).toBeUndefined();
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
      if (widget.kind === 'create') {
        expect(widget.justCreated).toBeUndefined();
      }
      expect(widget.flowSlug).toBeUndefined();
      expect(widget.nodeId).toBeUndefined();
    });
  });

  it('justCreated only appears on creation shapes (register_flow), never on navigate shapes', () => {
    const navigateShapes: CanvasWidgetState[] = [
      {
        kind: 'navigate',
        projectSlug: 'p1',
        flowSlug: 's1',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
      {
        kind: 'navigate',
        projectSlug: 'p2',
        flowSlug: 's2',
        nodeId: 'n1',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
    ];
    for (const state of navigateShapes) {
      const widget = widgetFromMeta(canvasMeta(state));
      if (widget.kind === 'create') {
        expect(widget.justCreated).toBeUndefined();
      }
    }
    // Only register_flow opts into the pill — create_project does NOT.
    const registerMeta = canvasMeta({
      kind: 'create',
      projectSlug: 'reg-project',
      flowSlug: 'reg',
      justCreated: true,
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    const registerWidget = widgetFromMeta(registerMeta);
    if (registerWidget.kind === 'create') {
      expect(registerWidget.justCreated).toBe(true);
    }
    const projectMeta = canvasMeta({
      kind: 'create',
      projectSlug: 'proj',
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    const projectWidget = widgetFromMeta(projectMeta);
    if (projectWidget.kind === 'create') {
      expect(projectWidget.justCreated).toBeUndefined();
    }
  });

  it('nodeId only appears when supplied (get_node)', () => {
    const withNode = canvasMeta({
      kind: 'navigate',
      projectSlug: 'p',
      flowSlug: 's',
      nodeId: 'n',
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    const withoutNode = canvasMeta({
      kind: 'navigate',
      projectSlug: 'p',
      flowSlug: 's',
      backendUrl: BACKEND_URL,
      backendToken: BACKEND_TOKEN,
    });
    expect(widgetFromMeta(withNode).nodeId).toBe('n');
    expect(widgetFromMeta(withoutNode).nodeId).toBeUndefined();
  });

  it('backendUrl and backendToken are always present across the 5 shapes', () => {
    const shapes: CanvasWidgetState[] = [
      {
        kind: 'navigate',
        projectSlug: 'pa',
        flowSlug: 'a',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
      {
        kind: 'navigate',
        projectSlug: 'pb',
        flowSlug: 'b',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
      {
        kind: 'navigate',
        projectSlug: 'pc',
        flowSlug: 'c',
        nodeId: 'n',
        backendUrl: BACKEND_URL,
        backendToken: BACKEND_TOKEN,
      },
      {
        kind: 'create',
        projectSlug: 'pd',
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

/**
 * MCP App shell — mounts the SeeFlow canvas inside an MCP-Apps host iframe
 * (Claude Desktop). Drives off `window.openai.widgetState` for the initial
 * focus (which flow / node / mode); when running in a plain browser tab (e2e
 * harness, manual smoke test), falls back to a `?widgetState=<json>` query
 * shim so the same bundle can be opened standalone for verification.
 *
 * Branching:
 *  - kind === 'navigate' → load the flow by slug, render canvas. If
 *    `nodeId` is supplied, that node is selected on mount so the built-in
 *    DetailPanel opens to it.
 *  - kind === 'create'   → same load path, plus a subtle 'Just created'
 *    banner that fades after 3s when `justCreated` is true.
 *
 * Adapter callbacks (createNode, deleteNode, createConnector,
 * deleteConnector, updateNode-with-name, playAction) are wrapped by
 * `wrapAdapter` so each successful mutation fires `bridge.sendMessage` on the
 * MCP-Apps host (200ms coalesced). Selection / drag / viewport telemetry
 * routes through `bridge.updateModelContext` (250ms debounced, 1s throttled).
 * Same bundle no-ops cleanly outside an MCP-Apps host.
 */

import {
  type CanvasAdapter,
  type CanvasMode,
  type Connector,
  type Flow,
  type FlowNode,
  type GeometricNodeType,
  SeeflowCanvas,
  TooltipProvider,
  buildNewShapeData,
  createRestAdapter,
} from '@seeflow/canvas';
import '@seeflow/canvas/style.css';
import { useEffect, useMemo, useState } from 'react';
import { sendMessage, updateModelContext } from './bridge';
import type { WidgetState } from './bridge';
import { createTelemetry, wrapAdapter } from './canvas-bridge';

const HIGHLIGHT_FADE_MS = 3000;

const readWidgetState = (): WidgetState | null => {
  if (typeof window === 'undefined') return null;
  const host = window.openai?.widgetState;
  if (host && typeof host === 'object') return host as WidgetState;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('widgetState');
    if (!raw) return null;
    return JSON.parse(raw) as WidgetState;
  } catch {
    return null;
  }
};

const shortId = (): string => Math.random().toString(36).slice(2, 10);

type LoadState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | {
      kind: 'ready';
      flowId: string;
      nodes: FlowNode[];
      connectors: Connector[];
    }
  | { kind: 'error'; message: string };

interface ResolvedFlowResponse {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  flow: Flow | null;
  valid: boolean;
  error: string | null;
}

interface FlowsIndexEntry {
  id: string;
  slug: string;
}

const fetchJson = async <T,>(url: string, headers: Record<string, string>): Promise<T> => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
};

export function App() {
  const widgetState = useMemo(readWidgetState, []);
  const [load, setLoad] = useState<LoadState>(
    widgetState ? { kind: 'loading' } : { kind: 'empty' },
  );
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(
    widgetState?.nodeId ? [widgetState.nodeId] : [],
  );
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<string[]>([]);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>({ kind: 'select' });

  // 'Just created' highlight fades after 3s. Only armed in create-mode with
  // an explicit `justCreated: true` (the register-flow path); navigate-mode
  // and silent create (e.g. create_project) skip the banner.
  const [showJustCreated, setShowJustCreated] = useState(
    widgetState?.kind === 'create' && widgetState.justCreated === true,
  );

  useEffect(() => {
    if (!showJustCreated) return;
    const t = window.setTimeout(() => setShowJustCreated(false), HIGHLIGHT_FADE_MS);
    return () => window.clearTimeout(t);
  }, [showJustCreated]);

  useEffect(() => {
    if (!widgetState) return;
    let cancelled = false;
    const { backendUrl, backendToken, flowSlug, projectSlug } = widgetState;
    const slug = flowSlug ?? projectSlug ?? null;
    if (!slug) {
      // create_project without a flow yet — render an empty canvas seam.
      // The model would call register_flow next to populate it; we don't
      // attempt to render the canvas without a flowId because the adapter
      // contract requires one.
      setLoad({ kind: 'empty' });
      return;
    }
    const headers: Record<string, string> = backendToken ? { 'X-Seeflow-Token': backendToken } : {};
    (async () => {
      try {
        const flows = await fetchJson<FlowsIndexEntry[]>(`${backendUrl}/api/flows`, headers);
        const match = flows.find((f) => f.slug === slug);
        if (!match) {
          if (!cancelled) setLoad({ kind: 'error', message: `Flow not found for slug: ${slug}` });
          return;
        }
        const detail = await fetchJson<ResolvedFlowResponse>(
          `${backendUrl}/api/flows/${match.id}`,
          headers,
        );
        if (cancelled) return;
        if (!detail.valid || !detail.flow) {
          setLoad({
            kind: 'error',
            message: detail.error ?? `Flow ${slug} failed to load`,
          });
          return;
        }
        setLoad({
          kind: 'ready',
          flowId: match.id,
          nodes: (detail.flow.nodes ?? []) as FlowNode[],
          connectors: (detail.flow.connectors ?? []) as Connector[],
        });
      } catch (err) {
        if (cancelled) return;
        setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetState]);

  const adapter = useMemo<CanvasAdapter | null>(() => {
    if (!widgetState) return null;
    if (load.kind !== 'ready') return null;
    const base = createRestAdapter({
      baseUrl: widgetState.backendUrl,
      flowId: load.flowId,
      headers: widgetState.backendToken
        ? { 'X-Seeflow-Token': widgetState.backendToken }
        : undefined,
    });
    // Wrap the adapter so structural edits fire bridge.sendMessage on the
    // MCP-Apps host. Visual-only patches (updateNode without `name`,
    // updateNodePosition) stay silent — drag telemetry routes through
    // updateModelContext instead.
    return wrapAdapter(
      base,
      { sendMessage, updateModelContext },
      { flowSlug: widgetState.flowSlug },
    );
  }, [widgetState, load]);

  // Selection / drag / viewport handlers that emit updateModelContext via the
  // bridge's debounce + throttle. Stable identity across renders so React
  // Flow doesn't churn its callback refs every paint.
  const telemetry = useMemo(() => createTelemetry({ sendMessage, updateModelContext }), []);

  if (!widgetState) {
    return (
      <Message title="SeeFlow MCP App">
        No widget state. This bundle is meant to run inside an MCP-Apps host. For browser testing,
        append <code>?widgetState=&#123;...&#125;</code> to the URL.
      </Message>
    );
  }
  if (load.kind === 'loading') return <Message>Loading…</Message>;
  if (load.kind === 'error') return <Message>Error: {load.message}</Message>;
  if (load.kind === 'empty') {
    return (
      <Message title="No flow registered">
        Project ready, but no flow has been registered yet. Use <code>seeflow_register_flow</code>{' '}
        to add one.
      </Message>
    );
  }

  const wrappedAdapter = adapter as CanvasAdapter;

  // Both 'navigate' and 'create' mount in edit mode so the model can interact
  // with the canvas (and so the built-in DetailPanel renders for node focus).
  return (
    <TooltipProvider delayDuration={150}>
      <div className="mcp-app-root">
        {showJustCreated ? <JustCreatedBanner /> : null}
        <SeeflowCanvas
          mode="edit"
          adapter={wrappedAdapter}
          projectId={load.flowId}
          nodes={load.nodes}
          connectors={load.connectors}
          selectedNodeIds={selectedNodeIds}
          selectedConnectorIds={selectedConnectorIds}
          onSelectionChange={(n, c) => {
            setSelectedNodeIds(n);
            setSelectedConnectorIds(c);
            telemetry.onSelectionChange(n, c);
          }}
          canvasMode={canvasMode}
          onCanvasModeChange={setCanvasMode}
          autoFitView
          // ---- Telemetry (silent updateModelContext) ----
          onNodeDragStart={telemetry.onNodeDragStart}
          onNodeDragStop={telemetry.onNodeDragStop}
          onViewportChange={telemetry.onViewportChange}
          // ---- Structural edits (wrapped adapter emits sendMessage) ----
          onCreateShapeNode={(shape: GeometricNodeType, position, dims) => {
            const id = `node-${shortId()}`;
            void wrappedAdapter.createNode({
              id,
              type: shape,
              position,
              data: buildNewShapeData(shape, dims),
            });
          }}
          onCreateConnector={(source, target, options) => {
            void wrappedAdapter.createConnector({
              source,
              target,
              targetPin: options?.targetPin,
            });
          }}
          onDeleteNode={(nodeId) => {
            void wrappedAdapter.deleteNode(nodeId);
          }}
          onNodePositionChange={(nodeId, position) => {
            void wrappedAdapter.updateNodePosition(nodeId, position);
          }}
          onNodeNameChange={(nodeId, name) => {
            void wrappedAdapter.updateNode(nodeId, { name });
          }}
          onNameChange={(nodeId, value) => {
            void wrappedAdapter.updateNode(nodeId, { name: value });
          }}
          onPlayNode={(nodeId) => {
            void wrappedAdapter.playAction?.(nodeId);
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function Message({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mcp-app-fallback">
      <div className="mcp-app-fallback-inner">
        {title ? <h1>{title}</h1> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}

/**
 * Subtle banner that fades out after 3s, slid in from the top of the canvas.
 * The fade animation runs in CSS so we don't need to track interpolation in
 * React state — the wrapper unmounts after `HIGHLIGHT_FADE_MS` regardless.
 */
function JustCreatedBanner() {
  return (
    <output className="mcp-app-just-created" aria-live="polite">
      <span className="mcp-app-just-created-dot" aria-hidden="true" />
      Just created
    </output>
  );
}

// MCP Apps UI resource glue for SeeFlow.
//
// The MCP-Apps host (Claude Desktop, ChatGPT) renders an iframe whose HTML
// payload is served via the MCP `resources/read` channel under a stable
// `ui://` URI. Canvas-bearing tool handlers attach an `_meta` block to their
// CallToolResult pointing the host at that URI plus an initial widget state.
//
// This module centralises three concerns so the wiring in mcp.ts stays thin:
//   1. The single canonical resource URI for the canvas bundle.
//   2. A cached reader for the built `apps/mcp-app/dist/index.html` (the
//      single-file Vite output produced by US-001..US-004).
//   3. `canvasMeta(state)` — the `_meta` payload the host expects for a
//      canvas-bearing tool result.
//
// The actual `_meta` attachment on each of the 5 canvas-bearing tools lives
// in US-008. Non-canvas tools never see this module.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Canonical resource URI for the SeeFlow canvas iframe bundle. Hosts that
 * speak MCP Apps fetch this via `resources/read` to obtain the HTML payload
 * for the embedded canvas. Tool results reference it via
 * `_meta['openai/outputTemplate']`.
 */
export const CANVAS_RESOURCE_URI = 'ui://seeflow/canvas';

/**
 * MIME type the MCP-Apps host expects for the canvas bundle. The
 * `+skybridge` suffix opts the iframe into the host's structured message
 * channel (`window.openai.sendMessage` / `updateModelContext`).
 */
export const CANVAS_RESOURCE_MIME = 'text/html+skybridge';

/**
 * Widget state delivered to the iframe via `_meta['openai/widgetState']`.
 *
 * Mirrors `WidgetState` in `apps/mcp-app/src/bridge.ts` — kept in sync but
 * duplicated (rather than imported across the workspace boundary) so the
 * studio doesn't pick up `react`/`react-dom` as a transitive dependency.
 * When you change one, change the other in the same commit.
 *
 *  - `kind: 'navigate'` — the model just inspected a flow/node, render it.
 *    `projectSlug` + `flowSlug` are both required so the iframe addresses
 *    the flow via `/api/projects/:project/flows/:flow` without an extra
 *    lookup round-trip.
 *  - `kind: 'create'`   — the model just scaffolded a project or registered
 *    a flow. Either or both slugs may be present (project-only when there's
 *    no flow yet); `justCreated: true` enables the brief mount-time pill.
 */
export type CanvasWidgetState =
  | {
      kind: 'navigate';
      projectSlug: string;
      flowSlug: string;
      nodeId?: string;
      backendUrl: string;
      backendToken: string;
    }
  | {
      kind: 'create';
      projectSlug?: string;
      flowSlug?: string;
      nodeId?: string;
      backendUrl: string;
      backendToken: string;
      justCreated?: boolean;
    };

/** Candidate locations for the built iframe HTML, checked in order.
 *
 *  1. `../../mcp-app/dist/index.html` — the dev source tree, where
 *     `bun run --filter @seeflow/mcp-app build` writes it and where the
 *     integration orchestrator checks freshness. Preferred so a canvas edit in
 *     a checkout is picked up without re-running the packaging copy.
 *  2. `../dist/mcp-app/index.html` — inside the published `@tuongaz/seeflow`
 *     package. npm cannot pack a path outside the package root, so
 *     `prepublishOnly` copies the bundle here and `files` lists `dist/mcp-app`.
 *     From an install this is the ONLY one that exists — candidate 1 would
 *     resolve to `node_modules/@tuongaz/mcp-app/dist/index.html`, which is not
 *     a package we publish.
 */
const CANVAS_HTML_CANDIDATES = ['../../mcp-app/dist/index.html', '../dist/mcp-app/index.html'];

/** Lazy-resolved absolute path to the built iframe HTML: the first candidate
 *  that exists on disk, or the dev path (so the not-found error names the
 *  location the build step below actually writes). */
const resolveCanvasHtmlPath = (): string => {
  const resolved = CANVAS_HTML_CANDIDATES.map((rel) => fileURLToPath(import.meta.resolve(rel)));
  return resolved.find((p) => existsSync(p)) ?? (resolved[0] as string);
};

let cachedHtml: string | undefined;
let cachedPath: string | undefined;

/**
 * Read the built MCP App iframe bundle. Cached after the first successful
 * read — the bundle is immutable for the lifetime of the studio process
 * (the only way to refresh it is to rebuild and restart).
 *
 * Throws a clear error pointing at the build step when the dist file is
 * missing, so a user who forgot `bun run --filter @seeflow/mcp-app build`
 * gets a one-line fix instead of an ENOENT trace.
 */
export function readCanvasHtml(): string {
  if (cachedHtml !== undefined) return cachedHtml;
  if (cachedPath === undefined) cachedPath = resolveCanvasHtmlPath();
  if (!existsSync(cachedPath)) {
    throw new Error(
      `MCP App bundle not found at ${cachedPath}. Run 'bun run --filter @seeflow/mcp-app build' to produce it.`,
    );
  }
  cachedHtml = readFileSync(cachedPath, 'utf8');
  return cachedHtml;
}

/** Test seam: drop the cached HTML so the next `readCanvasHtml()` call
 *  re-reads the file from disk. Exported for unit tests that mock the
 *  filesystem; never called in production code. */
export function __resetCanvasHtmlCache(): void {
  cachedHtml = undefined;
  cachedPath = undefined;
}

/**
 * Build the `_meta` payload for a canvas-bearing tool result. The three
 * keys are the contract the MCP-Apps host introspects:
 *
 * - `openai/outputTemplate` → which UI resource to render.
 * - `openai/widgetState`    → initial state injected as
 *                             `window.openai.widgetState` in the iframe.
 * - `openai/widgetAccessible` → declares the widget reads the model
 *                               context (so the host wires the bridge).
 */
export function canvasMeta(state: CanvasWidgetState): Record<string, unknown> {
  return {
    'openai/outputTemplate': CANVAS_RESOURCE_URI,
    'openai/widgetState': state,
    'openai/widgetAccessible': true,
  };
}

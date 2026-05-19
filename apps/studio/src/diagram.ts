import dagre from 'dagre';
import { z } from 'zod';
import { FlowSchema } from './schema.ts';

// Pure-compute helpers backing the three diagram-pipeline endpoints. No file
// I/O lives here — the skill writes responses to disk on the user's machine.
// Logic was extracted from skills/diagram/scripts/{propose-scope,assemble-demo,
// validate-demo}.mjs so it can be exercised in-process and via HTTP.

// === propose-scope =========================================================

const ScanFileSchema = z
  .object({
    path: z.string(),
    category: z.string(),
  })
  .passthrough();

export const ProposeScopeRequestSchema = z.object({
  files: z.array(ScanFileSchema),
});

export type ProposeScopeRequest = z.infer<typeof ProposeScopeRequestSchema>;

export interface ScopeCandidate {
  path: string;
  score: number;
  reasons: string[];
}

const ENTRY_NAMES = new Set([
  'server.ts',
  'server.js',
  'index.ts',
  'index.js',
  'app.ts',
  'app.js',
  'main.ts',
  'main.js',
  'app.py',
  'main.py',
  'wsgi.py',
  'asgi.py',
  'manage.py',
  'main.go',
  'main.rs',
  'application.rb',
  'config.ru',
]);

const scoreFile = (path: string): number => {
  let score = 0;
  const base = path.split('/').pop() ?? '';
  if (ENTRY_NAMES.has(base)) score += 10;
  if (path.startsWith('src/')) score += 4;
  if (path.startsWith('apps/')) score += 3;
  const depth = path.split('/').length;
  score += Math.max(0, 6 - depth);
  if (/\bindex\.(ts|js)$/i.test(path)) score += 2;
  if (/\b(server|app|main)\.(ts|js|py|go|rs)$/i.test(path)) score += 5;
  if (/test|spec|__tests__|\.test\.|\.spec\./i.test(path)) score -= 8;
  if (path.includes('node_modules')) score -= 50;
  return score;
};

const scoreReasons = (path: string): string[] => {
  const reasons: string[] = [];
  const base = path.split('/').pop() ?? '';
  if (ENTRY_NAMES.has(base)) reasons.push(`canonical entry name: ${base}`);
  if (path.startsWith('src/') || path.startsWith('apps/'))
    reasons.push('top-level src/apps directory');
  if (path.split('/').length <= 3) reasons.push('shallow path');
  return reasons;
};

export const proposeScope = (req: ProposeScopeRequest): { candidates: ScopeCandidate[] } => {
  const candidates: ScopeCandidate[] = [];
  for (const f of req.files) {
    if (f.category !== 'code') continue;
    const score = scoreFile(f.path);
    if (score > 0) candidates.push({ path: f.path, score, reasons: scoreReasons(f.path) });
  }
  candidates.sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, 30) };
};

// === assemble ==============================================================

const GRID = 24;

const WiringNodeSchema = z
  .object({
    id: z.string().min(1),
    position: z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .optional(),
  })
  .passthrough();

const WiringConnectorSchema = z
  .object({
    id: z.string().optional(),
    source: z.string().min(1),
    target: z.string().min(1),
  })
  .passthrough();

export const AssembleRequestSchema = z.object({
  wiring: z.object({
    name: z.string().optional(),
    nodes: z.array(WiringNodeSchema),
    connectors: z.array(WiringConnectorSchema),
  }),
  layout: z
    .object({
      positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
    })
    .optional(),
});

export type AssembleRequest = z.infer<typeof AssembleRequestSchema>;

export interface AssembleStats {
  nodesIn: number;
  connectorsIn: number;
  nodesOut: number;
  connectorsOut: number;
  duplicateNodesDropped: number;
  duplicateConnectorsDropped: number;
  danglingConnectorsDropped: number;
  positionsSnapped: number;
  positionsShifted: number;
}

export interface AssembleResult {
  demo: {
    version: 2;
    name: string;
    nodes: Array<Record<string, unknown>>;
    connectors: Array<Record<string, unknown>>;
  };
  stats: AssembleStats;
}

const slugify = (raw: string): string =>
  String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const assembleDemo = (req: AssembleRequest): AssembleResult => {
  const stats: AssembleStats = {
    nodesIn: req.wiring.nodes.length,
    connectorsIn: req.wiring.connectors.length,
    nodesOut: 0,
    connectorsOut: 0,
    duplicateNodesDropped: 0,
    duplicateConnectorsDropped: 0,
    danglingConnectorsDropped: 0,
    positionsSnapped: 0,
    positionsShifted: 0,
  };

  const positions = req.layout?.positions ?? {};
  const nodes = normalizeNodes(req.wiring.nodes, positions, stats);
  const nodeIds = new Set(nodes.map((n) => n.id as string));
  const connectors = normalizeConnectors(req.wiring.connectors, nodeIds, stats);
  const positionedNodes = autoLayout(nodes, connectors, stats);

  stats.nodesOut = positionedNodes.length;
  stats.connectorsOut = connectors.length;

  return {
    demo: {
      version: 2,
      name: req.wiring.name ?? 'Untitled diagram',
      nodes: positionedNodes,
      connectors,
    },
    stats,
  };
};

const normalizeNodes = (
  rawNodes: ReadonlyArray<Record<string, unknown>>,
  positionMap: Record<string, { x: number; y: number }>,
  stats: AssembleStats,
): Array<Record<string, unknown>> => {
  const seen = new Map<string, Record<string, unknown>>();
  for (const raw of rawNodes) {
    const id = slugify(String(raw.id ?? ''));
    if (!id) continue;
    const rawPos = positionMap[id] ??
      (raw.position as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    const snapped = {
      x: Math.round(rawPos.x / GRID) * GRID,
      y: Math.round(rawPos.y / GRID) * GRID,
    };
    if (snapped.x !== rawPos.x || snapped.y !== rawPos.y) stats.positionsSnapped++;
    if (seen.has(id)) stats.duplicateNodesDropped++;
    seen.set(id, { ...raw, id, position: snapped });
  }
  return [...seen.values()];
};

const normalizeConnectors = (
  rawConnectors: ReadonlyArray<Record<string, unknown>>,
  nodeIds: Set<string>,
  stats: AssembleStats,
): Array<Record<string, unknown>> => {
  const seen = new Map<string, Record<string, unknown>>();
  for (const raw of rawConnectors) {
    const source = slugify(String(raw.source ?? ''));
    const target = slugify(String(raw.target ?? ''));
    const id = slugify(String(raw.id ?? `c-${source}-${target}`));
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      stats.danglingConnectorsDropped++;
      continue;
    }
    const key = [
      source,
      target,
      String(raw.kind ?? ''),
      String(raw.sourceHandle ?? ''),
      String(raw.targetHandle ?? ''),
    ].join('\t');
    if (seen.has(key)) stats.duplicateConnectorsDropped++;
    seen.set(key, { ...raw, id, source, target });
  }
  return [...seen.values()];
};

// Dagre-based auto-layout — exactly the algorithm the web canvas's "Tidy
// layout" button runs (apps/web/src/lib/auto-layout.ts), so pressing Tidy on
// a freshly-assembled demo never reshuffles the diagram.
//
//   • Direction: left-to-right (LR) — Actors on the left, data stores on the
//     right, matching the lifecycle-lane intent of the layout-arranger agent.
//   • `nodesep` / `ranksep` defaults give connectors a bit of extra length so
//     edge labels fit and the canvas reads at a glance.
//   • Sticky / text shape nodes stay pinned to their input position — they
//     are floating annotations, not part of the flow graph.
const LAYOUT_NODESEP = 60;
const LAYOUT_RANKSEP = 140;
const LAYOUT_DEFAULT_W = 200;
const LAYOUT_DEFAULT_H = 120;

const isFloatingAnnotation = (n: Record<string, unknown>): boolean => {
  if (n.type !== 'shapeNode') return false;
  const shape = (n.data as { shape?: string } | undefined)?.shape;
  return shape === 'sticky' || shape === 'text';
};

const nodeDimensions = (n: Record<string, unknown>): { w: number; h: number } => {
  const data = (n.data ?? {}) as { width?: number; height?: number; shape?: string };
  const w =
    typeof data.width === 'number'
      ? data.width
      : n.type === 'shapeNode' && data.shape === 'text'
        ? 160
        : LAYOUT_DEFAULT_W;
  let h = LAYOUT_DEFAULT_H;
  if (typeof data.height === 'number') h = data.height;
  else if (n.type === 'shapeNode' && data.shape === 'text') h = 40;
  else if (n.type === 'shapeNode' && data.shape === 'sticky') h = 180;
  else if (n.type === 'imageNode') h = 150;
  return { w, h };
};

const autoLayout = (
  nodes: ReadonlyArray<Record<string, unknown>>,
  connectors: ReadonlyArray<Record<string, unknown>>,
  stats: AssembleStats,
): Array<Record<string, unknown>> => {
  if (nodes.length === 0) return [];

  const flowNodes = nodes.filter((n) => !isFloatingAnnotation(n));
  // A single flow node has no layout to compute — keep its input position so
  // callers can pin standalone nodes via `layout.positions`.
  if (flowNodes.length <= 1) return [...nodes];

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: LAYOUT_NODESEP, ranksep: LAYOUT_RANKSEP });
  g.setDefaultEdgeLabel(() => ({}));

  const flowIds = new Set<string>();
  const dims = new Map<string, { w: number; h: number }>();
  for (const n of flowNodes) {
    const id = n.id as string;
    const { w, h } = nodeDimensions(n);
    g.setNode(id, { width: w, height: h });
    flowIds.add(id);
    dims.set(id, { w, h });
  }

  let edgeCounter = 0;
  for (const c of connectors) {
    const s = c.source as string;
    const t = c.target as string;
    if (!flowIds.has(s) || !flowIds.has(t) || s === t) continue;
    // multigraph + unique edge name preserves parallel connectors.
    g.setEdge(s, t, {}, `e${edgeCounter++}`);
  }

  dagre.layout(g);

  const snap = (v: number) => Math.round(v / GRID) * GRID;
  return nodes.map((n) => {
    if (isFloatingAnnotation(n)) return n;
    const id = n.id as string;
    const laid = g.node(id);
    const d = dims.get(id);
    if (!laid || !d) return n;
    // dagre returns center coords; convert to top-left for React Flow.
    const snapped = { x: snap(laid.x - d.w / 2), y: snap(laid.y - d.h / 2) };
    const prev = (n.position as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    if (snapped.x !== prev.x || snapped.y !== prev.y) stats.positionsShifted++;
    return { ...n, position: snapped };
  });
};

// === validate ==============================================================

export const TierSchema = z.enum(['real', 'mock', 'static']);
export type Tier = z.infer<typeof TierSchema>;

export const ValidateRequestSchema = z.object({
  demo: z.unknown(),
  tier: TierSchema.optional(),
});

export type ValidateRequest = z.infer<typeof ValidateRequestSchema>;

export interface ValidateIssue {
  kind: string;
  path?: string;
  message: string;
}

export interface ValidateReport {
  ok: boolean;
  stats: {
    tier: Tier;
    nodeCount: number;
    connectorCount: number;
    playableCount: number;
    issueCount: number;
    warningCount: number;
  };
  issues: ValidateIssue[];
  warnings: ValidateIssue[];
}

// Filesystem-bound checks (harness coverage, event-emitter index) deliberately
// stay in the skill — the studio doesn't reach into the user's `$TARGET`. The
// endpoint covers schema + node-count cap + tier playability only.
export const validateDemo = (req: ValidateRequest): ValidateReport => {
  const tier: Tier = req.tier ?? 'static';
  const issues: ValidateIssue[] = [];
  const warnings: ValidateIssue[] = [];

  const parsed = FlowSchema.safeParse(req.demo);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        kind: 'zod',
        path: issue.path.join('.') || '<root>',
        message: issue.message,
      });
    }
  }

  // Best-effort access to nodes/connectors so cap + tier checks still surface
  // on a demo that fails Zod (e.g. one extra/missing field shouldn't hide a
  // 50-node count problem).
  const rawDemo = (req.demo ?? {}) as {
    nodes?: unknown;
    connectors?: unknown;
  };
  const nodes: Array<Record<string, unknown>> = Array.isArray(rawDemo.nodes)
    ? (rawDemo.nodes as Array<Record<string, unknown>>)
    : [];
  const connectors: unknown[] = Array.isArray(rawDemo.connectors) ? rawDemo.connectors : [];

  if (nodes.length > 30) {
    issues.push({ kind: 'cap', message: `Node count ${nodes.length} exceeds soft cap 30` });
  } else if (nodes.length > 25) {
    warnings.push({ kind: 'cap', message: `Node count ${nodes.length} approaching cap 30` });
  }

  const playable = nodes.filter((n) => {
    const data = n.data as { playAction?: unknown } | undefined;
    return n.type === 'playNode' || (n.type === 'stateNode' && data?.playAction !== undefined);
  });
  if (tier !== 'static' && playable.length === 0) {
    issues.push({
      kind: 'tier-mismatch',
      message: `Tier '${tier}' requires at least one playable node; found 0. Either add a playNode or set tier=static.`,
    });
  }

  if (tier === 'real') {
    for (const n of nodes) {
      const action = (n.data as { playAction?: { kind?: string; method?: string; url?: string } })
        ?.playAction;
      if (action?.kind !== 'http' || !action.url) continue;
      warnings.push({
        kind: 'real-tier-reachability',
        message: `Node '${String(n.id)}': ensure ${action.method ?? '?'} ${action.url} is reachable in your dev server before clicking.`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    stats: {
      tier,
      nodeCount: nodes.length,
      connectorCount: connectors.length,
      playableCount: playable.length,
      issueCount: issues.length,
      warningCount: warnings.length,
    },
    issues,
    warnings,
  };
};

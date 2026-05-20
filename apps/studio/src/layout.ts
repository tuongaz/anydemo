import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import ELK from 'elkjs/lib/elk-api.js';
import type { FlowNode } from './schema.ts';

// elkjs Bun-compat shim. The `elk-worker.min.js` file inspects `self` at the
// bottom to decide between its browser-worker branch and its CJS-export
// branch. Bun exposes `self` globally, which makes it take the
// browser-worker branch — and skip the export — so we'd get an empty
// module otherwise. We load the vendored worker source via vm and run it
// inside a wrapper that shadows `self`, then pluck the Worker class out of
// the resulting module.exports. One-time cost at module load.
const requireFromHere = createRequire(import.meta.url);
const workerSource = readFileSync(requireFromHere.resolve('elkjs/lib/elk-worker.min.js'), 'utf8');
type WorkerCtor = new () => { postMessage: (msg: unknown) => unknown };
const workerModule: { exports: { Worker?: WorkerCtor } } = { exports: {} };
const wrappedSource = `(function (module, exports) { var self; ${workerSource} })`;
const wrapped = runInThisContext(wrappedSource, {
  filename: 'elkjs/lib/elk-worker.min.js',
}) as (m: typeof workerModule, e: typeof workerModule.exports) => void;
wrapped(workerModule, workerModule.exports);
const ElkWorker = workerModule.exports.Worker;
if (!ElkWorker) throw new Error('elkjs worker class not found after Bun shim');

// ELK's type expects a full DOM Worker; our shim provides the minimal duck
// (postMessage / addEventListener). ELK only checks `typeof postMessage ===
// 'function'` at runtime, so the cast is safe.
const elk = new ELK({
  workerFactory: () => new ElkWorker() as unknown as Worker,
});

export type LayoutDirection = 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
export type SourceHandle = 'r' | 'b';
export type TargetHandle = 't' | 'l';

export interface LayoutOptions {
  direction?: LayoutDirection;
  spacing?: { layer?: number; node?: number };
}

export interface LayoutResult {
  nodes: Record<string, { position: { x: number; y: number } }>;
  connectors: Record<string, { sourceHandle: SourceHandle; targetHandle: TargetHandle }>;
}

// Structural shape computeLayout cares about. Decoupled from the strict
// FlowSchema so callers like assembleDemo (which carries pre-validation
// passthrough data) can feed in their loose nodes without round-tripping
// through Zod.
export interface LayoutNode {
  id: string;
  type: FlowNode['type'];
  data?: { width?: number; height?: number; shape?: string };
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

const DEFAULT_DIMENSIONS: Record<FlowNode['type'], { width: number; height: number }> = {
  playNode: { width: 220, height: 100 },
  stateNode: { width: 220, height: 100 },
  shapeNode: { width: 160, height: 80 },
  iconNode: { width: 80, height: 80 },
  htmlNode: { width: 320, height: 200 },
  imageNode: { width: 200, height: 150 },
};

const SHAPE_OVERRIDES: Record<string, { width: number; height: number }> = {
  text: { width: 160, height: 40 },
  sticky: { width: 160, height: 180 },
};

const FLOATING_SHAPES = new Set(['sticky', 'text']);

const nodeDimensions = (node: LayoutNode): { width: number; height: number } => {
  const data = node.data ?? {};
  if (typeof data.width === 'number' && typeof data.height === 'number') {
    return { width: data.width, height: data.height };
  }
  if (node.type === 'shapeNode' && data.shape) {
    const override = SHAPE_OVERRIDES[data.shape];
    if (override) return override;
  }
  return DEFAULT_DIMENSIONS[node.type];
};

// Sticky / text shapes are floating annotations. They never participate in
// layered layout — they sit in a side column so the orthogonal flow stays
// clean.
const isFloatingAnnotation = (node: LayoutNode): boolean => {
  if (node.type !== 'shapeNode') return false;
  const shape = node.data?.shape;
  return shape !== undefined && FLOATING_SHAPES.has(shape);
};

// Schema vocabulary: SourceHandle ∈ {r, b}, TargetHandle ∈ {t, l}. After
// ELK lays out positions we pick handles geometrically — the layered LR
// algorithm puts most edges going east, so the default is source.r →
// target.l. Back-edges (target to the left or directly below) route via
// source.b → target.t so they don't try to enter from a side that has no
// target handle.
const pickHandles = (
  src: { x: number; y: number; w: number; h: number },
  tgt: { x: number; y: number; w: number; h: number },
): { sourceHandle: SourceHandle; targetHandle: TargetHandle } => {
  const sCenter = { x: src.x + src.w / 2, y: src.y + src.h / 2 };
  const tCenter = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
  const dx = tCenter.x - sCenter.x;
  const dy = tCenter.y - sCenter.y;

  if (dx > 0 && Math.abs(dx) >= Math.abs(dy)) {
    return { sourceHandle: 'r', targetHandle: 'l' };
  }
  return { sourceHandle: 'b', targetHandle: 't' };
};

export const computeLayout = async (
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options?: LayoutOptions,
): Promise<LayoutResult> => {
  // Stable input ordering keeps ELK output deterministic across runs.
  const allNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const connectors = [...edges].sort((a, b) => a.id.localeCompare(b.id));

  const result: LayoutResult = { nodes: {}, connectors: {} };

  if (allNodes.length === 0) return result;

  const dims = new Map<string, { width: number; height: number }>();
  for (const n of allNodes) dims.set(n.id, nodeDimensions(n));

  const referenced = new Set<string>();
  for (const c of connectors) {
    referenced.add(c.source);
    referenced.add(c.target);
  }
  const laidOut = allNodes.filter((n) => referenced.has(n.id) && !isFloatingAnnotation(n));
  const floatingNodes = allNodes.filter((n) => !laidOut.includes(n));

  const layerSpacing = options?.spacing?.layer ?? 220;
  const nodeSpacing = options?.spacing?.node ?? 140;
  const direction = options?.direction ?? 'RIGHT';

  if (laidOut.length > 0) {
    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
        'elk.spacing.nodeNode': String(nodeSpacing),
        'elk.spacing.edgeNode': '60',
        'elk.spacing.edgeEdge': '30',
        'elk.spacing.edgeLabel': '12',
        'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.separateConnectedComponents': 'true',
      },
      children: laidOut.map((n) => {
        const d = dims.get(n.id) ?? DEFAULT_DIMENSIONS.playNode;
        return { id: n.id, width: d.width, height: d.height };
      }),
      edges: connectors
        .filter((c) => referenced.has(c.source) && referenced.has(c.target))
        .map((c) => ({ id: c.id, sources: [c.source], targets: [c.target] })),
    };

    const out = await elk.layout(elkGraph);
    for (const child of out.children ?? []) {
      if (typeof child.x !== 'number' || typeof child.y !== 'number') continue;
      result.nodes[child.id] = {
        position: { x: Math.round(child.x), y: Math.round(child.y) },
      };
    }
  }

  // Floating nodes get a right-side column at x = maxLaidOutX + gap. Avoids
  // the (0,0) pile-up that the old hand-authored positions had whenever a
  // sticky note slipped through without an explicit position.
  if (floatingNodes.length > 0) {
    let maxRight = 0;
    for (const id of Object.keys(result.nodes)) {
      const pos = result.nodes[id]?.position;
      const d = dims.get(id);
      if (!pos || !d) continue;
      maxRight = Math.max(maxRight, pos.x + d.width);
    }
    const columnX = laidOut.length > 0 ? maxRight + 200 : 0;
    let cursorY = 0;
    for (const n of floatingNodes) {
      const d = dims.get(n.id) ?? DEFAULT_DIMENSIONS.shapeNode;
      result.nodes[n.id] = { position: { x: columnX, y: cursorY } };
      cursorY += d.height + nodeSpacing;
    }
  }

  // Geometric handle assignment runs after positions are known so it can
  // see whether each edge ended up going east, south, or backwards.
  for (const c of connectors) {
    const sPos = result.nodes[c.source]?.position;
    const tPos = result.nodes[c.target]?.position;
    const sDim = dims.get(c.source);
    const tDim = dims.get(c.target);
    if (!sPos || !tPos || !sDim || !tDim) continue;
    result.connectors[c.id] = pickHandles(
      { x: sPos.x, y: sPos.y, w: sDim.width, h: sDim.height },
      { x: tPos.x, y: tPos.y, w: tDim.width, h: tDim.height },
    );
  }

  return result;
};

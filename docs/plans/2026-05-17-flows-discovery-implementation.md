# Flows Discovery & Export Enhancements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Name/Visibility to export dialog, add a `/flows` discovery page with mini canvas previews, and add a "Discover recent flows" section to the home page.

**Architecture:** Visibility is encoded in the zip filename (`seeflow.json` = public, `seeflow.private.json` = unlisted). The viewer gains a shared `demo-to-flow.ts` conversion utility, a non-interactive `MiniCanvas` component, a `FlowCard` component, and a new `/flows` page. The home page gains a Discover section above the footer.

**Tech Stack:** Bun, React 18, React Flow v12 (`@xyflow/react`), Tailwind v4, react-router-dom v7, TypeScript strict.

**Run tests with:** `bun test` (from repo root or individual app dir). Format + lint: `bun run format && bun run lint`.

---

## Task 1 — Extract demo→flow conversion to a shared util

**Why:** `convertNode` and `convertConnector` live as private functions in `view-canvas.tsx`. The new `MiniCanvas` needs them too. Extract them now so both import from one place.

**Files:**
- Create: `apps/viewer/src/lib/demo-to-flow.ts`
- Modify: `apps/viewer/src/components/view-canvas.tsx`

**Step 1: Create `demo-to-flow.ts`**

```ts
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { colorTokenStyle } from './color-tokens';
import type { Connector, DemoNode } from '../types';

const STYLE_BY_KIND: Record<Connector['kind'], { strokeDasharray?: string }> = {
  http: {},
  event: { strokeDasharray: '6 4' },
  queue: { strokeDasharray: '2 4' },
  default: {},
};

const STYLE_BY_STYLE: Record<'solid' | 'dashed' | 'dotted', { strokeDasharray?: string }> = {
  solid: {},
  dashed: { strokeDasharray: '6 4' },
  dotted: { strokeDasharray: '2 4' },
};

export function convertNode(node: DemoNode): Node {
  const data = node.data as unknown as Record<string, unknown>;
  const w = typeof data.width === 'number' ? data.width : undefined;
  const h = typeof data.height === 'number' ? data.height : undefined;
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data,
    ...(w !== undefined ? { width: w } : {}),
    ...(h !== undefined ? { height: h } : {}),
  };
}

export function convertConnector(connector: Connector): Edge {
  const dashStyle = connector.style
    ? STYLE_BY_STYLE[connector.style]
    : STYLE_BY_KIND[connector.kind];
  const colorStyle = colorTokenStyle(connector.color, 'edge');
  const strokeWidth = connector.borderSize ?? 2;
  const style = { ...dashStyle, ...colorStyle, strokeWidth };

  const direction = connector.direction ?? 'forward';
  const markerColor = colorStyle.stroke;
  const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: markerColor };

  return {
    id: connector.id,
    source: connector.source,
    target: connector.target,
    ...(connector.sourceHandle ? { sourceHandle: connector.sourceHandle } : {}),
    ...(connector.targetHandle ? { targetHandle: connector.targetHandle } : {}),
    type: 'viewEdge',
    label: connector.label,
    animated: false,
    data: { path: connector.path, fontSize: connector.fontSize },
    style,
    markerStart: direction === 'backward' || direction === 'both' ? arrow : undefined,
    markerEnd: direction === 'forward' || direction === 'both' ? arrow : undefined,
  };
}
```

**Step 2: Update `view-canvas.tsx`** — delete the two private `convertNode` and `convertConnector` function bodies, import from the new util:

At the top imports, add:
```ts
import { convertNode, convertConnector } from '../lib/demo-to-flow';
```

Remove the local `STYLE_BY_KIND`, `STYLE_BY_STYLE`, `convertNode`, and `convertConnector` declarations entirely (they are now in `demo-to-flow.ts`).

**Step 3: Run typecheck**
```bash
cd apps/viewer && bun run typecheck
```
Expected: 0 errors.

**Step 4: Commit**
```bash
git add apps/viewer/src/lib/demo-to-flow.ts apps/viewer/src/components/view-canvas.tsx
git commit -m "refactor(viewer): extract demo→flow conversion to shared util"
```

---

## Task 2 — Add FlowListItem type and viewer API helper

**Files:**
- Modify: `apps/viewer/src/types.ts`
- Create: `apps/viewer/src/lib/viewer-api.ts`

**Step 1: Add types to `types.ts`**

Append to the end of the file:

```ts
export interface FlowListItem {
  uuid: string;
  name: string;
  createdAt: string;
  demo: Demo;
}

export interface FlowsResponse {
  flows: FlowListItem[];
  total: number;
  page: number;
  totalPages: number;
}
```

**Step 2: Create `viewer-api.ts`**

```ts
import type { Demo, FlowsResponse } from '../types';

const API_BASE = 'https://seeflow.dev/api';

export async function fetchFlow(uuid: string): Promise<Demo> {
  const res = await fetch(`${API_BASE}/flows/${uuid}`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'Flow not found' : `Failed to load flow (${res.status})`);
  }
  return res.json() as Promise<Demo>;
}

export async function fetchFlows(page: number, limit: number): Promise<FlowsResponse> {
  const res = await fetch(`${API_BASE}/flows?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load flows (${res.status})`);
  return res.json() as Promise<FlowsResponse>;
}
```

**Step 3: Update `flow-view.tsx`** to use `fetchFlow` from `viewer-api.ts` instead of its inline fetch:

Replace the `useEffect` fetch block:
```ts
import { fetchFlow } from '../lib/viewer-api';

// inside useEffect:
fetchFlow(uuid)
  .then((demo) => setState({ status: 'done', demo }))
  .catch((err: unknown) => {
    if (err instanceof Error && err.name === 'AbortError') return;
    const msg = err instanceof Error ? err.message : 'Failed to load flow';
    setState({ status: 'error', message: msg });
  });
```

Remove the `API_BASE` constant and the raw `fetch(...)` call from `flow-view.tsx`.

Note: The AbortController signal can't be passed through the helper — keep it simple and remove the abort logic from flow-view (the component unmounting is fine without it for this use case), or thread the signal through. The simplest: remove AbortController from `flow-view.tsx` since the effect cleanup is sufficient.

**Step 4: Typecheck**
```bash
cd apps/viewer && bun run typecheck
```

**Step 5: Commit**
```bash
git add apps/viewer/src/types.ts apps/viewer/src/lib/viewer-api.ts apps/viewer/src/pages/flow-view.tsx
git commit -m "feat(viewer): add FlowListItem type and viewer API helpers"
```

---

## Task 3 — Update `use-export-to-cloud.ts` (web app)

**Files:**
- Modify: `apps/web/src/hooks/use-export-to-cloud.ts`
- Modify: `apps/web/src/hooks/use-export-to-cloud.test.ts`

**Step 1: Update the hook signature and zip logic**

New `use-export-to-cloud.ts`:

```ts
import { fetchDemoDetail } from '@/lib/api';
import { strToU8, zipSync } from 'fflate';
import { useCallback } from 'react';

const CLOUD_API_BASE = 'https://seeflow.dev/api';

export type Visibility = 'public' | 'link';

export async function exportToCloud(
  projectId: string,
  email: string,
  name: string,
  visibility: Visibility,
): Promise<{ shareUrl: string }> {
  const detail = await fetchDemoDetail(projectId);
  if (!detail.demo) {
    throw new Error('Demo has no data');
  }
  const demo = detail.demo;

  const seen = new Set<string>();
  const filePaths: string[] = [];
  for (const node of demo.nodes) {
    if (node.type === 'imageNode' && node.data.path && !seen.has(node.data.path)) {
      seen.add(node.data.path);
      filePaths.push(node.data.path);
    } else if (node.type === 'htmlNode' && node.data.htmlPath && !seen.has(node.data.htmlPath)) {
      seen.add(node.data.htmlPath);
      filePaths.push(node.data.htmlPath);
    }
  }

  const zipKey = visibility === 'public' ? 'seeflow.json' : 'seeflow.private.json';
  const zipEntries: Record<string, Uint8Array> = {
    [zipKey]: strToU8(JSON.stringify(demo)),
  };

  for (const path of filePaths) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${path}`);
    if (res.ok) {
      zipEntries[`files/${path}`] = new Uint8Array(await res.arrayBuffer());
    }
  }

  const zipped = zipSync(zipEntries);

  const params = new URLSearchParams({ email: email.trim(), name: name.trim() });
  const cloudRes = await fetch(`${CLOUD_API_BASE}/flows?${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: zipped.buffer as ArrayBuffer,
  });

  if (!cloudRes.ok) {
    throw new Error(`Export failed with status ${cloudRes.status}`);
  }

  const body = (await cloudRes.json()) as { url?: string };
  if (typeof body.url !== 'string') {
    throw new Error('Invalid response from cloud API: missing url');
  }

  return { shareUrl: body.url };
}

export function useExportToCloud(
  projectId: string,
): (email: string, name: string, visibility: Visibility) => Promise<{ shareUrl: string }> {
  return useCallback(
    (email, name, visibility) => exportToCloud(projectId, email, name, visibility),
    [projectId],
  );
}
```

**Step 2: Update `use-export-to-cloud.test.ts`**

Update all existing `exportToCloud('proj-1', 'test@example.com')` calls to:
```ts
exportToCloud('proj-1', 'test@example.com', 'My Flow', 'public')
```

Add two new tests at the end of the `describe` block:

```ts
it('uses seeflow.private.json in zip when visibility is link', async () => {
  let capturedBody: ArrayBuffer | null = null;

  installMock((url, init) => {
    if (url.includes('/api/demos/')) return { status: 200, body: makeDetail() };
    if (url.includes('seeflow.dev')) {
      const raw = init?.body;
      capturedBody = raw instanceof ArrayBuffer ? raw : null;
      return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
    }
    throw new Error(`Unexpected: ${url}`);
  });

  await exportToCloud('proj-1', 'test@example.com', 'My Flow', 'link');

  assertArrayBuffer(capturedBody);
  const entries = unzipSync(new Uint8Array(capturedBody));
  expect('seeflow.private.json' in entries).toBe(true);
  expect('seeflow.json' in entries).toBe(false);
});

it('includes name in the cloud API query params', async () => {
  const requests: string[] = [];

  installMock((url) => {
    requests.push(url);
    if (url.includes('/api/demos/')) return { status: 200, body: makeDetail() };
    if (url.includes('seeflow.dev')) return { status: 201, body: { url: 'https://seeflow.dev/flow/x' } };
    throw new Error(`Unexpected: ${url}`);
  });

  await exportToCloud('proj-1', 'test@example.com', 'My Flow Name', 'public');

  const cloudUrl = requests.find((u) => u.includes('seeflow.dev')) ?? '';
  expect(cloudUrl).toContain('name=My+Flow+Name');
});
```

**Step 3: Run tests**
```bash
cd apps/web && bun test src/hooks/use-export-to-cloud.test.ts
```
Expected: all pass.

**Step 4: Commit**
```bash
git add apps/web/src/hooks/use-export-to-cloud.ts apps/web/src/hooks/use-export-to-cloud.test.ts
git commit -m "feat(web): add name and visibility params to exportToCloud"
```

---

## Task 4 — Update `export-dialog.tsx`

**Files:**
- Modify: `apps/web/src/components/export-dialog.tsx`

No new test file — the dialog is UI-only; the hook has full test coverage.

**Full replacement of `export-dialog.tsx`:**

```tsx
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useExportToCloud, type Visibility } from '@/hooks/use-export-to-cloud';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const EMAIL_STORAGE_KEY = 'seeflow.export.email';
const NAME_STORAGE_KEY = 'seeflow.export.name';
const VISIBILITY_STORAGE_KEY = 'seeflow.export.visibility';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; shareUrl: string }
  | { kind: 'error'; message: string };

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function ExportDialog({ open, onOpenChange, projectId }: ExportDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const exportToCloud = useExportToCloud(projectId);

  useEffect(() => {
    if (open) {
      setEmail(localStorage.getItem(EMAIL_STORAGE_KEY) ?? '');
      setName(localStorage.getItem(NAME_STORAGE_KEY) ?? '');
      setVisibility((localStorage.getItem(VISIBILITY_STORAGE_KEY) as Visibility) ?? 'public');
      setState({ kind: 'idle' });
      setCopied(false);
    }
  }, [open]);

  const handleExport = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const { shareUrl } = await exportToCloud(email.trim(), name.trim(), visibility);
      localStorage.setItem(EMAIL_STORAGE_KEY, email.trim());
      localStorage.setItem(NAME_STORAGE_KEY, name.trim());
      localStorage.setItem(VISIBILITY_STORAGE_KEY, visibility);
      setState({ kind: 'done', shareUrl });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [exportToCloud, email, name, visibility]);

  const handleCopy = useCallback(() => {
    if (state.kind !== 'done') return;
    navigator.clipboard.writeText(state.shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [state]);

  const isLoading = state.kind === 'loading';
  const canSubmit = !isLoading && email.trim().length > 0 && name.trim().length > 0;

  const inputClass =
    'rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="export-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.querySelector<HTMLInputElement>('[data-testid="export-name-input"]')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Export to seeflow.dev</DialogTitle>
          <DialogDescription>
            Upload this diagram to the cloud and get a shareable link.
          </DialogDescription>
        </DialogHeader>

        {state.kind !== 'done' ? (
          <>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Name</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  placeholder="My architecture diagram"
                  data-testid="export-name-input"
                  className={inputClass}
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Visibility</span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as Visibility)}
                  disabled={isLoading}
                  data-testid="export-visibility-select"
                  className={inputClass}
                >
                  <option value="public">Public — anyone can discover it</option>
                  <option value="link">Anyone with the link</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  data-testid="export-email-input"
                  className={inputClass}
                />
              </label>

              {state.kind === 'error' ? (
                <div
                  role="alert"
                  data-testid="export-error"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {state.message}
                </div>
              ) : null}
            </div>

            <DialogFooter>
              {state.kind === 'error' ? (
                <>
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="export-cancel">
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => setState({ kind: 'idle' })} data-testid="export-retry">
                    Try again
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isLoading} data-testid="export-cancel">
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleExport} disabled={!canSubmit} data-testid="export-submit">
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>Uploading…</span>
                      </>
                    ) : (
                      'Export'
                    )}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Your diagram is live. Share this link:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={state.shareUrl}
                  data-testid="export-share-url"
                  className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 text-sm outline-none"
                />
                <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label="Copy link" data-testid="export-copy">
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(state.shareUrl, '_blank', 'noopener,noreferrer')}
                  aria-label="View flow"
                  data-testid="export-view"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)} data-testid="export-done">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 1: Typecheck**
```bash
cd apps/web && bun run typecheck
```

**Step 2: Commit**
```bash
git add apps/web/src/components/export-dialog.tsx
git commit -m "feat(web): add Name, Visibility fields and View button to export dialog"
```

---

## Task 5 — `MiniCanvas` component (viewer)

**Files:**
- Create: `apps/viewer/src/components/mini-canvas.tsx`

```tsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { convertConnector, convertNode } from '../lib/demo-to-flow';
import type { Demo } from '../types';
import { ViewEdge } from './view-edge';
import { ViewHtmlNode } from './nodes/view-html-node';
import { ViewIconNode } from './nodes/view-icon-node';
import { ViewImageNode } from './nodes/view-image-node';
import { ViewPlayNode } from './nodes/view-play-node';
import { ViewShapeNode } from './nodes/view-shape-node';
import { ViewStateNode } from './nodes/view-state-node';

const nodeTypes = {
  playNode: ViewPlayNode,
  stateNode: ViewStateNode,
  shapeNode: ViewShapeNode,
  imageNode: ViewImageNode,
  iconNode: ViewIconNode,
  htmlNode: ViewHtmlNode,
};

const edgeTypes = { viewEdge: ViewEdge };

interface MiniCanvasProps {
  demo: Demo;
}

export function MiniCanvas({ demo }: MiniCanvasProps) {
  const nodes = useMemo(() => demo.nodes.map(convertNode), [demo.nodes]);
  const edges = useMemo(() => demo.connectors.map(convertConnector), [demo.connectors]);

  return (
    <div style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}
```

**Step 1: Typecheck**
```bash
cd apps/viewer && bun run typecheck
```

**Step 2: Commit**
```bash
git add apps/viewer/src/components/mini-canvas.tsx
git commit -m "feat(viewer): add MiniCanvas non-interactive preview component"
```

---

## Task 6 — `FlowCard` component (viewer)

**Files:**
- Create: `apps/viewer/src/components/flow-card.tsx`

```tsx
import { MiniCanvas } from './mini-canvas';
import type { FlowListItem } from '../types';

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

interface FlowCardProps {
  flow: FlowListItem;
  onClick: () => void;
}

export function FlowCard({ flow, onClick }: FlowCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden hover:border-zinc-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      {/* 16:9 canvas preview */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 bg-zinc-950">
          <MiniCanvas demo={flow.demo} />
        </div>
      </div>

      {/* Info overlay bar */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-t border-zinc-800">
        <span
          className="text-sm font-medium text-zinc-100 truncate group-hover:text-white transition-colors"
          title={flow.name}
        >
          {flow.name}
        </span>
        <span className="text-xs text-zinc-500 shrink-0">{formatRelativeDate(flow.createdAt)}</span>
      </div>
    </button>
  );
}
```

**Step 1: Typecheck**
```bash
cd apps/viewer && bun run typecheck
```

**Step 2: Commit**
```bash
git add apps/viewer/src/components/flow-card.tsx
git commit -m "feat(viewer): add FlowCard component with mini canvas preview"
```

---

## Task 7 — `/flows` page (viewer)

**Files:**
- Create: `apps/viewer/src/pages/flows.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FlowCard } from '../components/flow-card';
import { fetchFlows } from '../lib/viewer-api';
import type { FlowListItem } from '../types';

const LIMIT = 12;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; flows: FlowListItem[]; totalPages: number; page: number };

function SkeletonCard() {
  return (
    <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden animate-pulse">
      <div className="w-full bg-zinc-800" style={{ paddingBottom: '56.25%' }} />
      <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-t border-zinc-800">
        <div className="h-4 w-2/3 bg-zinc-800 rounded" />
        <div className="h-3 w-12 bg-zinc-800 rounded" />
      </div>
    </div>
  );
}

export function FlowsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    fetchFlows(page, LIMIT)
      .then(({ flows, totalPages }) => setState({ status: 'done', flows, totalPages, page }))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load flows';
        setState({ status: 'error', message: msg });
      });
  }, [page]);

  function goToPage(p: number) {
    setSearchParams({ page: String(p) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#09090b', color: '#e4e4e7', fontFamily: "'Inter', sans-serif" }}
    >
      <div className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 mb-8">
          Recent flows
        </h1>

        {state.status === 'loading' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: LIMIT }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {state.status === 'error' && (
          <p className="text-zinc-400">{state.message}</p>
        )}

        {state.status === 'done' && (
          <>
            {state.flows.length === 0 ? (
              <p className="text-zinc-400">No flows yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {state.flows.map((flow) => (
                  <FlowCard
                    key={flow.uuid}
                    flow={flow}
                    onClick={() => navigate(`/flow/${flow.uuid}`)}
                  />
                ))}
              </div>
            )}

            {state.totalPages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 disabled:opacity-40 hover:border-zinc-500 transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-zinc-500">
                  Page {page} of {state.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= state.totalPages}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 disabled:opacity-40 hover:border-zinc-500 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 1: Typecheck**
```bash
cd apps/viewer && bun run typecheck
```

**Step 2: Commit**
```bash
git add apps/viewer/src/pages/flows.tsx
git commit -m "feat(viewer): add /flows discovery page with grid and pagination"
```

---

## Task 8 — Wire `/flows` route and update header (viewer)

**Files:**
- Modify: `apps/viewer/src/app.tsx`
- Modify: `apps/viewer/src/components/viewer-header.tsx`

**Step 1: Update `app.tsx`**

Add import and route:
```tsx
import { FlowsPage } from './pages/flows.tsx';

// Inside <Routes>, add alongside the existing /flow/:uuid route:
<Route path="/flows" element={<FlowsPage />} />
```

The `/flows` route should be inside the `<ViewerLayout>` wrapper (so it gets the header):
```tsx
<Route element={<ViewerLayout />}>
  <Route path="/flows" element={<FlowsPage />} />
  <Route path="/flow/:uuid" element={<FlowView />} />
</Route>
```

**Step 2: Update `viewer-header.tsx`** — add a "Flows" nav link:

```tsx
import { Workflow } from 'lucide-react';
import { Link, useMatch } from 'react-router-dom';

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 20px',
  height: 52,
  background: '#fff',
  borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
  zIndex: 20,
};

const logoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 700,
  fontSize: 16,
  color: '#0f172a',
  textDecoration: 'none',
  letterSpacing: '-0.02em',
};

const navLinkStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#64748b',
  textDecoration: 'none',
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
  transition: 'color 0.15s, background 0.15s',
};

export function ViewerHeader() {
  const isFlowView = useMatch('/flow/:uuid');
  return (
    <header style={headerStyle}>
      <Link to="/" style={logoStyle}>
        <Workflow size={20} color="#34d399" strokeWidth={2} />
        SeeFlow
      </Link>
      <div style={{ display: 'flex', gap: 8 }}>
        {!isFlowView && (
          <Link to="/flows" style={navLinkStyle}>
            Flows
          </Link>
        )}
        <Link to="/" style={navLinkStyle}>
          SeeFlow Studio
        </Link>
      </div>
    </header>
  );
}
```

**Step 3: Typecheck**
```bash
cd apps/viewer && bun run typecheck
```

**Step 4: Commit**
```bash
git add apps/viewer/src/app.tsx apps/viewer/src/components/viewer-header.tsx
git commit -m "feat(viewer): wire /flows route and add Flows nav link to header"
```

---

## Task 9 — "Discover recent flows" section on home page

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx`

**Step 1: Add the Discover section**

Add this import at the top of `home.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlowCard } from '../components/flow-card';
import { fetchFlows } from '../lib/viewer-api';
import type { FlowListItem } from '../types';
```

Note: `home.tsx` already imports `useState`. Merge the imports — add `useEffect`, `useNavigate`, `FlowCard`, `fetchFlows`, `FlowListItem`.

Add a `DiscoverSection` component inside `home.tsx` (above the `Home` function):

```tsx
function DiscoverSection() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFlows(1, 6)
      .then(({ flows }) => setFlows(flows))
      .catch(() => { /* hide section on error */ })
      .finally(() => setLoading(false));
  }, []);

  if (!loading && flows.length === 0) return null;

  return (
    <section className="max-w-6xl mx-auto px-6 py-8 md:py-16 border-t border-zinc-800/50">
      <div className="flex items-baseline justify-between mb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Discover recent flows
        </h2>
        <a
          href="/flows"
          className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
        >
          View all →
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
              <div
                key={i}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden animate-pulse"
              >
                <div className="w-full bg-zinc-800" style={{ paddingBottom: '56.25%' }} />
                <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-t border-zinc-800">
                  <div className="h-4 w-2/3 bg-zinc-800 rounded" />
                  <div className="h-3 w-12 bg-zinc-800 rounded" />
                </div>
              </div>
            ))
          : flows.map((flow) => (
              <FlowCard
                key={flow.uuid}
                flow={flow}
                onClick={() => navigate(`/flow/${flow.uuid}`)}
              />
            ))}
      </div>
    </section>
  );
}
```

In the `Home` function, insert `<DiscoverSection />` just above the `{/* Footer */}` comment:
```tsx
        <DiscoverSection />
      </main>

      {/* Footer */}
```

**Step 2: Typecheck**
```bash
cd apps/viewer && bun run typecheck
```

**Step 3: Full lint**
```bash
bun run format && bun run lint
```

**Step 4: Commit**
```bash
git add apps/viewer/src/pages/home.tsx
git commit -m "feat(viewer): add Discover recent flows section to home page"
```

---

## Final verification

```bash
bun run typecheck   # from repo root
bun test            # all tests pass
bun run format && bun run lint
```

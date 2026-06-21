# Canvas Node Status UI Uplift — Design

Date: 2026-05-19
Scope: `packages/canvas/`

## Goal

Make node execution state instantly legible on the canvas. Today, status is spread across three surfaces (`PlayNodeData.status`, `StatusPill` text, `StatusReport.state` footer badge) with inconsistent treatments and no shared visual language between PlayNode and StateNode. We unify the visual model, add a small set of carefully scoped animations, and reduce visual noise.

Non-goals: cascading flow animations across the entire graph, particle-stream edges, a global status orchestrator, new SSE event types.

## 1. Unified Status Model

Introduce a derived canonical type inside each node component:

```ts
type VisualStatus = 'idle' | 'active' | 'success' | 'error';
//                                ^^^^^^ "running" for PlayNode, "checking" for StateNode
```

Derivation (pure helper, `src/nodes/lib/visual-status.ts`):

- **PlayNode**: `status` maps directly — `'running'`→`'active'`, `'done'`→`'success'`, `'error'`→`'error'`, otherwise `'idle'`.
- **StateNode**: `'active'` when `status === 'running'` **OR** `statusReport?.state === 'pending'`. `'success'` when `statusReport?.state === 'ok'` or `status === 'done'`. `'error'` when either source reports error. `'idle'` otherwise.

Every animation, color, icon, and `aria-live` message reads from `VisualStatus`. This eliminates drift between the play button, header pill, and edge handoff.

Tokens (existing palette from `design/design.html`):

| State    | Color           | Notes                                                  |
| -------- | --------------- | ------------------------------------------------------ |
| idle     | slate-300/-400  | no glow, default border                                |
| active   | amber `#f59e0b` | animated ring                                          |
| success  | emerald `#10b981` | one-shot pop + halo, then settled tick               |
| error    | rose `#ef4444`  | one-shot shake (reuse `inline-edit-shake`)             |

Accessibility: a node-level `aria-live="polite"` region announces transitions once per change ("Order action running… succeeded").

## 2. PlayNode Button Visual States

32px circle, lucide `Play` icon centered. Layered structure:

```
<button data-status={visualStatus} aria-label="Run | Running… | Succeeded, run again | Failed, run again">
  <span class="play-ring" />     // animated overlay (only when active)
  <Icon />                       // Play / Check / AlertCircle — hover-reveals Play when success/error
</button>
```

- **Idle** — 1px emerald border, `Play` icon, hover lift (unchanged).
- **Active** — Play icon at ~80% opacity. `.play-ring` overlay is a `conic-gradient` ring (2px, emerald-hi `#34d399` → transparent) rotating 1.2s linear infinite via `mask` to clip to ring. `prefers-reduced-motion` → static solid emerald-hi border, no rotation.
- **Success** — Icon morphs to lucide `Check` (emerald). 320ms scale pop (1.0→1.15→1.0) + soft emerald halo fading out by 600ms (reuse `seeflow-ping-fast` keyframe, sibling halo div). Border becomes solid emerald.
- **Error** — Icon morphs to lucide `AlertCircle` (rose). 320ms shake (reuse `inline-edit-shake`). Border becomes solid rose. Error message stays on `title=`.
- **Hover-reveals-Play** — On `:hover` when status is success/error, icon transitions back to `Play`, color returns to emerald. CSS-only via `data-status`-aware selectors. Click re-runs and animation cycles again.

No JS state machine for animation; all transitions are CSS-driven off `data-status`.

## 3. StateNode Header Pill

Remove the text `StatusPill` entirely. Add a compact icon pill on the **top-right of the header row**, mirroring the play button position on PlayNode so the two node types align visually.

Geometry: 20px tall, ~22–24px wide, fully rounded, 1.5px border.

| State   | Icon                  | Color   |
| ------- | --------------------- | ------- |
| idle    | (pill not rendered)   | —       |
| active  | lucide `Radar`        | amber, animated border |
| success | lucide `Check`        | emerald |
| error   | lucide `AlertTriangle`| rose    |

- **Active border animation:** same conic-gradient ring as the play button, scaled to pill size, 1.2s linear infinite, amber gradient. The icon itself does **not** rotate — only the border.
- **Success/error one-shots:** 240ms scale pop (1.0→1.1→1.0) when entering the state. Triggered via `data-just-changed` attribute auto-cleared on `animationend`.
- **Tooltip:** native `title` attribute with the StatusReport summary ("Checking inventory...").
- **Reduced-motion fallback:** static amber border + static dot for active; no pop on transitions.

The footer `StatusBadge` row stays — pill is at-a-glance, footer is readable detail.

## 4. Edges and Inter-Node Cues

Click-driven, single node — no autonomous flow animation on edges. Two subtle additions so the canvas doesn't feel static:

1. **Source-node halo on success.** When a node enters `success`, its outer box gets a 600ms expanding emerald `box-shadow` (reuse `seeflow-ping-fast`). Counterpart to the running amber pulse. No effect on edges or neighbors.
2. **Outgoing-edge handoff pulse (opt-in).** When a source node hits `success`, its outgoing edges briefly animate `stroke-width` from current → +1px → current over 500ms, then revert. Single subtle "blink" — no dashing flow, no traveling particles. Implemented by setting `data-handoff="true"` on the edge for 500ms after the source transition; CSS handles the animation.

Each downstream node still lights up only from its own status update — no coordination code needed.

**Error edges:** no edge animation on error. The source node's button turns red and shakes; that's the signal. Coloring downstream edges red would imply propagation that may not be happening.

`prefers-reduced-motion`: disables halo, handoff pulse, and rotation animations. Color and icon updates still happen instantly.

## 5. Files, Sequence, and Verification

### Files to touch (all under `packages/canvas/`)

1. `src/styles/index.css` — new keyframes: `seeflow-ring-spin` (conic-gradient rotation), `seeflow-pop` (240ms scale), `seeflow-success-halo` (emerald variant of `seeflow-ping-fast`), `seeflow-edge-handoff` (stroke-width blink). All wrapped in `@media (prefers-reduced-motion: no-preference)` where appropriate.
2. `src/nodes/status-pill.tsx` → **replaced** by `src/nodes/status-icon-pill.tsx`. Exports `<StatusIconPill visualStatus summary />`. Old `StatusPill` is deleted; consumers updated.
3. `src/nodes/lib/visual-status.ts` *(new)* — pure helper exporting `deriveVisualStatus(status, statusReport)` from Section 1. Unit-tested.
4. `src/nodes/play-node.tsx` — extract play-button JSX into an internal `<PlayButton>` reading from `deriveVisualStatus`. Renders ring overlay, hover-reveals-Play, icon morph, halo on success.
5. `src/nodes/state-node.tsx` — render `<StatusIconPill>` on the right of the header row; remove the old text `StatusPill`; keep footer `StatusBadge` untouched.
6. `src/edges/editable-edge.tsx` — add `data-handoff` attribute set by an effect listening for the source node's `visualStatus` becoming `'success'`. Verify the canvas's existing state-access pattern (React Flow `useStore` vs. Zustand selector) before coding.

### Implementation order (each commit independently shippable)

1. CSS keyframes + reduced-motion guards. No behavior change.
2. `visual-status.ts` + unit tests.
3. PlayNode `<PlayButton>` refactor with idle/active/success/error states.
4. StateNode `<StatusIconPill>` replacing text pill; keep footer badge.
5. Edge handoff pulse wiring.
6. Visual review in `bun run dev`, then `bun run format && bun run lint && bun test`.

### Verification

Unit tests cover `deriveVisualStatus` (the only branching logic). Visual states are exercised manually against the demo at `apps/studio/examples/order-pipeline`, which already covers play actions and status reports.

### Out of scope (YAGNI)

- Traveling-particle edge animations.
- Multi-node orchestration coordinator.
- New SSE event types.
- A global "reset all to idle" action.

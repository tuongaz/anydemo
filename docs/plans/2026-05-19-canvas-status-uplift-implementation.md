# Canvas Node Status UI Uplift — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the visual status model across PlayNode + StateNode, refresh the play button into a multi-state circle, swap the StateNode text pill for a compact icon pill, and add a subtle outgoing-edge handoff pulse — all driven by a single derived `VisualStatus`.

**Architecture:** A pure helper (`deriveVisualStatus`) collapses `PlayNodeData.status` and `StatusReport.state` into one of four canonical states (`idle | active | success | error`). Every visual treatment reads from that state via `data-status` attributes and CSS, with new keyframes added to `packages/canvas/src/styles/index.css`. All animations gate on `prefers-reduced-motion: no-preference`.

**Tech Stack:** Bun (test runner), React 18, `@xyflow/react`, Tailwind v4 (`sf:` prefix), `lucide-react`, Biome (lint/format).

**Source design:** `docs/plans/2026-05-19-canvas-status-uplift-design.md`. Read it before starting — it has the rationale for every visual decision below.

**Scope:** `packages/canvas/` only. No `apps/web` or `apps/studio` changes.

**Verification per task:** `cd packages/canvas && bun run typecheck`, then `bun test` from repo root. Final task adds `bun run format && bun run lint` and a manual visual pass against `apps/studio/examples/order-pipeline`.

---

## Background — what you need to know before touching any file

Read these once, then refer back as needed:

- `packages/canvas/CLAUDE.md` — package rules. Critical: **public API is `src/index.ts` only**, **`sf:` Tailwind prefix**, **non-utility CSS lives in `src/styles/index.css` scoped under `.seeflow-canvas-root`**, and **Biome 1.9.4 ignores `src/styles/index.css`** (so CSS won't be reformatted by `bun run format`).
- `packages/canvas/src/styles/index.css:114-158` — existing keyframes (`seeflow-ping-fast`, `seeflow-node-pulse`, `inline-edit-shake`). You'll add four new ones next to these.
- `packages/canvas/src/nodes/status-pill.tsx` — the text pill being replaced. Exports `NodeStatus` (which `types.ts` re-exports). **`NodeStatus` must be relocated to `types.ts` before deleting this file** since `types.ts` imports it.
- `packages/canvas/src/nodes/play-node.tsx:280-305` — the existing play button. The refactor extracts this into a `<PlayButton>` sub-component.
- `packages/canvas/src/nodes/state-node.tsx:260-262` — where `<StatusPill>` is rendered. Becomes `<StatusIconPill>`.
- `packages/canvas/src/edges/editable-edge.tsx` — the only edge component. The handoff pulse hooks in here.
- Tests are colocated (`foo.test.tsx` next to `foo.tsx`) and use a **hook-shim renderer** (see `packages/canvas/src/nodes/play-node.test.tsx:13-45` and `state-node.test.tsx:10-42`) — no real DOM, no React Flow store. Walk the returned element tree with `findElement`. This is unusual; follow the existing pattern exactly.
- Test runner is `bun test` (not vitest/jest). Imports `from 'bun:test'`.

**Visual-status type contract** (from design §1):

```ts
export type VisualStatus = 'idle' | 'active' | 'success' | 'error';
```

| `PlayNode.status` | `StatusReport.state` | `VisualStatus` |
| ----------------- | -------------------- | -------------- |
| `'running'`       | any                  | `'active'`     |
| `'done'`          | any                  | `'success'`    |
| `'error'`         | any                  | `'error'`      |
| `undefined`/`'idle'` (PlayNode) | n/a    | `'idle'`       |
| `'running'` (StateNode) | any            | `'active'`     |
| any               | `'pending'`          | `'active'`     |
| `'done'`          | any                  | `'success'`    |
| any               | `'ok'`               | `'success'`    |
| `'error'`         | any                  | `'error'`      |
| any               | `'error'`            | `'error'`      |
| otherwise         | otherwise            | `'idle'`       |

`'error'` wins over everything; `'active'` wins over `'success'` only when run-status is `'running'` and report is `'pending'` (treat as active). Otherwise priority: `error > active > success > idle`.

**Animation names you'll add** (all gated on `prefers-reduced-motion: no-preference`):

| Keyframe              | Duration | Use                                            |
| --------------------- | -------- | ---------------------------------------------- |
| `seeflow-ring-spin`   | 1.2s linear infinite | conic-gradient ring rotation (active) |
| `seeflow-pill-pop`    | 240ms ease-out | one-shot pill scale 1→1.1→1            |
| `seeflow-play-pop`    | 320ms ease-out | one-shot play-button scale 1→1.15→1    |
| `seeflow-success-halo`| 600ms cubic-bezier(0,0,0.2,1) | emerald expanding box-shadow |
| `seeflow-edge-handoff`| 500ms ease-out | edge stroke-width blink                |

---

## Task 1: Add new CSS keyframes

**Goal:** Drop the five new keyframes (plus their `.seeflow-canvas-root`-scoped utility classes) into the existing stylesheet. No component change — purely additive.

**Files:**
- Modify: `packages/canvas/src/styles/index.css`
- No test file (Biome ignores this file; visual-only)

**Step 1: Append keyframes below the existing `inline-edit-shake` block**

Open `packages/canvas/src/styles/index.css`. Locate the `inline-edit-shake` block (around line 142-158). Append the following **after** the `.seeflow-canvas-root .inline-edit-shake` selector and **before** the `.inline-edit-empty::before` rule (line 160):

```css
/* Status-uplift keyframes — all gated on prefers-reduced-motion: no-preference */
@media (prefers-reduced-motion: no-preference) {
  @keyframes seeflow-ring-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes seeflow-pill-pop {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.1);
    }
  }
  @keyframes seeflow-play-pop {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.15);
    }
  }
  @keyframes seeflow-success-halo {
    0% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45);
    }
    100% {
      box-shadow: 0 0 0 16px rgba(16, 185, 129, 0);
    }
  }
  @keyframes seeflow-edge-handoff {
    0%,
    100% {
      stroke-width: var(--seeflow-edge-base-width, 2px);
    }
    50% {
      stroke-width: calc(var(--seeflow-edge-base-width, 2px) + 1px);
    }
  }

  .seeflow-canvas-root .seeflow-ring-spin {
    animation: seeflow-ring-spin 1.2s linear infinite;
  }
  .seeflow-canvas-root .seeflow-pill-pop {
    animation: seeflow-pill-pop 240ms ease-out;
  }
  .seeflow-canvas-root .seeflow-play-pop {
    animation: seeflow-play-pop 320ms ease-out;
  }
  .seeflow-canvas-root .seeflow-success-halo {
    animation: seeflow-success-halo 600ms cubic-bezier(0, 0, 0.2, 1);
  }
  .seeflow-canvas-root .react-flow__edge[data-handoff="true"] .react-flow__edge-path {
    animation: seeflow-edge-handoff 500ms ease-out;
  }
}
```

**Why each piece:**

- The whole block is inside `@media (prefers-reduced-motion: no-preference)` so users with reduced-motion preference get no animation classes at all. Static colors still apply (those are set via inline `data-status` selectors elsewhere, not here).
- `seeflow-ring-spin` rotates whatever element it's applied to — used on the conic-gradient overlay span.
- `seeflow-pill-pop` and `seeflow-play-pop` are the one-shot pop animations; consumers add the class for a single play and remove it on `animationend`.
- `seeflow-success-halo` is an expanding emerald box-shadow — set on the node container after a `success` transition.
- `seeflow-edge-handoff` uses a CSS custom property `--seeflow-edge-base-width` (with a 2px fallback) so the source-node effect can read whatever stroke the edge happened to be rendered with. We'll set `data-handoff="true"` on the edge wrapper for 500ms.

**Step 2: Run typecheck (CSS isn't typechecked, but no compile errors expected)**

```bash
cd packages/canvas && bun run typecheck
```

Expected: passes (the change is CSS-only).

**Step 3: Run tests to confirm no regressions**

```bash
cd /Users/tuongaz/dev/seeflow && bun test
```

Expected: all existing tests pass. The new keyframes are additive — no test references them yet.

**Step 4: Verify the keyframes are present in the file**

```bash
grep -n "seeflow-ring-spin\|seeflow-pill-pop\|seeflow-play-pop\|seeflow-success-halo\|seeflow-edge-handoff" packages/canvas/src/styles/index.css
```

Expected: 10 matches (5 `@keyframes` + 5 `.seeflow-canvas-root …` rules, plus the edge-handoff selector on the wrapper).

**Step 5: Commit**

```bash
git add packages/canvas/src/styles/index.css
git commit -m "$(cat <<'EOF'
feat(canvas): add status-uplift keyframes (no behavior change)

Adds seeflow-ring-spin, seeflow-pill-pop, seeflow-play-pop,
seeflow-success-halo, seeflow-edge-handoff. All gated on
prefers-reduced-motion: no-preference. Consumers wired in
subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Relocate `NodeStatus`, add `deriveVisualStatus` + tests

**Goal:** Move the `NodeStatus` type from `status-pill.tsx` to `types.ts` (so we can delete the pill file later), then add the pure helper that every visual-status consumer will read from.

**Files:**
- Modify: `packages/canvas/src/types.ts`
- Modify: `packages/canvas/src/nodes/status-pill.tsx` (re-export `NodeStatus` from types.ts so existing imports still work this commit)
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx` (import path only, if needed — see step 4)
- Modify: `packages/canvas/src/nodes/play-node.tsx` (import path only)
- Modify: `packages/canvas/src/nodes/state-node.tsx` (import path only)
- Create: `packages/canvas/src/nodes/lib/visual-status.ts`
- Create: `packages/canvas/src/nodes/lib/visual-status.test.ts`

**Step 1: Move `NodeStatus` to `types.ts`**

In `packages/canvas/src/types.ts`, **remove** line 1:
```ts
import type { NodeStatus } from './nodes/status-pill.tsx';
```

**Add** this type declaration near the top of `types.ts`, right above `export type ColorToken` (line 3):

```ts
/**
 * Per-node run lifecycle. `undefined` (no entry in the runs map) is treated
 * as `'idle'` visually — see deriveVisualStatus in
 * `./nodes/lib/visual-status.ts`.
 */
export type NodeStatus = 'idle' | 'running' | 'done' | 'error';
```

Line 181 (`status: NodeStatus;` inside `RunResult`) keeps working since `NodeStatus` is now defined in the same file.

**Step 2: Convert `status-pill.tsx` into a re-export of the moved type**

Edit `packages/canvas/src/nodes/status-pill.tsx`. Replace line 3:

```ts
export type NodeStatus = 'idle' | 'running' | 'done' | 'error';
```

with:

```ts
import type { NodeStatus } from '../types.ts';

export type { NodeStatus };
```

The `StatusPill` component itself stays untouched in this task — it's still used by `state-node.tsx`. We delete the component in Task 5 once `StatusIconPill` is in place.

**Step 3: Run typecheck + tests to confirm the type relocation is safe**

```bash
cd packages/canvas && bun run typecheck && cd /Users/tuongaz/dev/seeflow && bun test
```

Expected: passes. All consumers still import `NodeStatus` from `./status-pill.tsx`; that re-export keeps them happy.

**Step 4: Write the failing test for `deriveVisualStatus`**

Create `packages/canvas/src/nodes/lib/visual-status.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { StatusReport } from '../../types.ts';
import { deriveVisualStatus } from './visual-status.ts';

describe('deriveVisualStatus', () => {
  it('returns idle when status is undefined and no report', () => {
    expect(deriveVisualStatus(undefined, undefined)).toBe('idle');
  });

  it('returns idle when status is "idle" and no report', () => {
    expect(deriveVisualStatus('idle', undefined)).toBe('idle');
  });

  it('maps "running" status to active', () => {
    expect(deriveVisualStatus('running', undefined)).toBe('active');
  });

  it('maps "done" status to success', () => {
    expect(deriveVisualStatus('done', undefined)).toBe('success');
  });

  it('maps "error" status to error', () => {
    expect(deriveVisualStatus('error', undefined)).toBe('error');
  });

  it('treats pending statusReport as active even when run status is idle', () => {
    const report: StatusReport = { state: 'pending' };
    expect(deriveVisualStatus(undefined, report)).toBe('active');
    expect(deriveVisualStatus('idle', report)).toBe('active');
  });

  it('treats ok statusReport as success when run status is idle/undefined', () => {
    const report: StatusReport = { state: 'ok' };
    expect(deriveVisualStatus(undefined, report)).toBe('success');
    expect(deriveVisualStatus('idle', report)).toBe('success');
  });

  it('treats error statusReport as error regardless of run status', () => {
    const report: StatusReport = { state: 'error' };
    expect(deriveVisualStatus(undefined, report)).toBe('error');
    expect(deriveVisualStatus('idle', report)).toBe('error');
    expect(deriveVisualStatus('done', report)).toBe('error');
    expect(deriveVisualStatus('running', report)).toBe('error');
  });

  it('treats warn statusReport as idle (not surfaced as its own state in v1)', () => {
    // warn is intentionally not part of VisualStatus — the four-state
    // model is idle | active | success | error. warn reports still appear
    // in the footer StatusBadge; the pill stays idle.
    const report: StatusReport = { state: 'warn' };
    expect(deriveVisualStatus(undefined, report)).toBe('idle');
    expect(deriveVisualStatus('idle', report)).toBe('idle');
  });

  it('priority: run "error" beats report "pending"', () => {
    expect(deriveVisualStatus('error', { state: 'pending' })).toBe('error');
  });

  it('priority: report "pending" beats run "done" (re-checking after completion)', () => {
    // A done run followed by a fresh pending status check should read as
    // active again — the user wants to see the new check is running.
    expect(deriveVisualStatus('done', { state: 'pending' })).toBe('active');
  });

  it('priority: run "running" beats report "ok"', () => {
    expect(deriveVisualStatus('running', { state: 'ok' })).toBe('active');
  });

  it('priority: run "done" + report "ok" stays success', () => {
    expect(deriveVisualStatus('done', { state: 'ok' })).toBe('success');
  });
});
```

**Step 5: Run the test to confirm it fails**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/nodes/lib/visual-status.test.ts
```

Expected: FAIL with `Cannot find module '...visual-status.ts'`.

**Step 6: Write `deriveVisualStatus`**

Create `packages/canvas/src/nodes/lib/visual-status.ts`:

```ts
import type { NodeStatus, StatusReport } from '../../types.ts';

/**
 * Canonical four-state visual model shared by PlayNode + StateNode.
 *
 * - idle:    no run, no pending status. Pill not rendered; play button shows Play.
 * - active:  running (PlayNode) OR pending status (StateNode "checking").
 * - success: done OR statusReport.state === 'ok'.
 * - error:   error OR statusReport.state === 'error'. Beats every other state.
 *
 * `warn` reports do NOT promote to a visual state — they still show up in the
 * footer `StatusBadge`, but the pill stays idle so warn doesn't read as
 * "something needs your attention right now".
 */
export type VisualStatus = 'idle' | 'active' | 'success' | 'error';

export function deriveVisualStatus(
  status: NodeStatus | undefined,
  statusReport: StatusReport | undefined,
): VisualStatus {
  // Error wins over everything — both run-error and status-error are loud.
  if (status === 'error' || statusReport?.state === 'error') return 'error';
  // Active beats success: a fresh re-check after a completed run reads as
  // active again, so the user sees the new check happening.
  if (status === 'running' || statusReport?.state === 'pending') return 'active';
  if (status === 'done' || statusReport?.state === 'ok') return 'success';
  return 'idle';
}
```

**Step 7: Run the test to confirm it passes**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/nodes/lib/visual-status.test.ts
```

Expected: PASS. 13 tests.

**Step 8: Run the full test suite + typecheck**

```bash
cd packages/canvas && bun run typecheck && cd /Users/tuongaz/dev/seeflow && bun test
```

Expected: all tests pass; no type errors.

**Step 9: Commit**

```bash
git add packages/canvas/src/types.ts packages/canvas/src/nodes/status-pill.tsx packages/canvas/src/nodes/lib/visual-status.ts packages/canvas/src/nodes/lib/visual-status.test.ts
git commit -m "$(cat <<'EOF'
feat(canvas): add deriveVisualStatus helper + relocate NodeStatus type

Moves NodeStatus from nodes/status-pill.tsx to types.ts. status-pill.tsx
now re-exports the type so existing imports keep working until the pill
component itself is replaced.

Adds nodes/lib/visual-status.ts with the four-state visual model
(idle/active/success/error) consumed by upcoming PlayNode + StateNode
refactors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PlayNode `<PlayButton>` refactor

**Goal:** Replace the existing single-state play button with a `<PlayButton>` sub-component that renders idle/active/success/error states with the new animations.

**Files:**
- Modify: `packages/canvas/src/nodes/play-node.tsx`
- Modify: `packages/canvas/src/nodes/play-node.test.tsx`

**Step 1: Write failing tests for the new PlayButton behavior**

Append these `describe` blocks to `packages/canvas/src/nodes/play-node.test.tsx` (after the existing `PlayNode default background fill` describe block). Reuse the existing `callPlayNode` / `findPlayButton` helpers.

```tsx
describe('PlayNode play button visual-status states (status uplift)', () => {
  it('idle: data-visual-status="idle" and Play icon, no ring overlay', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe('idle');
    // Ring overlay only renders for 'active'. Search button subtree.
    const ring = findElement(
      button,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button-ring',
    );
    expect(ring).toBeNull();
  });

  it('active: data-visual-status="active" and ring overlay present', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'running',
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'active',
    );
    const ring = findElement(
      button,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button-ring',
    );
    expect(ring).not.toBeNull();
  });

  it('success: data-visual-status="success" with Check icon', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'done',
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'success',
    );
  });

  it('error: data-visual-status="error" — keeps existing rose-border class', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'error',
      errorMessage: 'boom',
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe('error');
    const className = String((button.props as { className?: string }).className ?? '');
    expect(className).toContain('sf:border-rose-500');
  });

  it('statusReport "pending" alone (no run status) reads as active', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      statusReport: { state: 'pending', ts: 1 },
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'active',
    );
  });
});
```

**Step 2: Run the new tests to confirm they fail**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/nodes/play-node.test.tsx
```

Expected: 5 new failures (the existing 12 tests still pass).

**Step 3: Refactor `play-node.tsx`**

Open `packages/canvas/src/nodes/play-node.tsx`.

**3a.** Update the imports at the top (line 1-15):

```tsx
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { AlertCircle, Check, Play } from 'lucide-react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, memo, useState } from 'react';
import { IconPickerPopover } from '../components/icon-picker-popover.tsx';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import type { NodeData, NodeStatus, StatusReport } from '../types.ts';
import { Button } from '../ui/button.tsx';
import { Icon } from '../ui/icon.tsx';
import { deriveVisualStatus, type VisualStatus } from './lib/visual-status.ts';
import { LockBadge } from './lock-badge.tsx';
import { ResizeControls } from './resize-controls.tsx';
import { StatusBadge } from './status-badge.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';
```

Notes: `Loader2` is gone (the ring overlay replaces the spinner). `Check` + `AlertCircle` are new. `NodeStatus` import now comes from `'../types.ts'` (the `status-pill.tsx` re-export still works, but new code should pull from the canonical location).

**3b.** Replace lines 60-75 inside `PlayNodeImpl` (the part that computes `status`, `isRunning`, `isError`, `buttonLabel`):

```tsx
  const status = data.status;
  const action = data.playAction;
  const description = data.description ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const visualStatus = deriveVisualStatus(status, data.statusReport);
  const isRunning = status === 'running';
  const isError = visualStatus === 'error';
  // US-018: failed runs surface their reason as the button tooltip — replaces
  // the removed status chip. Falls back to a generic "Failed" if the SSE
  // event arrived without a message.
  const buttonLabel =
    visualStatus === 'active'
      ? 'Running…'
      : visualStatus === 'success'
        ? 'Succeeded, run again'
        : visualStatus === 'error'
          ? data.errorMessage
            ? `Failed: ${data.errorMessage}`
            : 'Failed, run again'
          : 'Play';
```

**3c.** Replace the JSX block for the Button (lines 273-304 in the original) with a `<PlayButton>` invocation. Keep the `<div className="sf:flex sf:shrink-0 sf:items-center sf:gap-1">` wrapper untouched; just swap what's inside it:

```tsx
        <div className="sf:flex sf:shrink-0 sf:items-center sf:gap-1">
          <PlayButton
            visualStatus={visualStatus}
            disabled={!playable || visualStatus === 'active'}
            buttonLabel={buttonLabel}
            isError={isError}
            onClick={(e) => {
              e.stopPropagation();
              data.onPlay?.(id);
            }}
          />
        </div>
```

**3d.** Add the `<PlayButton>` sub-component definition above `PlayNodeImpl` (or below it — either works; place it above for readability):

```tsx
function PlayButton({
  visualStatus,
  disabled,
  buttonLabel,
  isError,
  onClick,
}: {
  visualStatus: VisualStatus;
  disabled: boolean;
  buttonLabel: string;
  isError: boolean;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  // The icon morphs by visual-status. On hover, success/error revert to Play
  // (the click-target affordance). CSS-only via the group-hover utility — see
  // .seeflow-play-icon classes below.
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={disabled}
      data-testid="play-button"
      data-status={visualStatus === 'idle' ? 'idle' : visualStatus}
      data-visual-status={visualStatus}
      aria-label={buttonLabel}
      title={buttonLabel}
      onClick={onClick}
      className={cn(
        // US-018: circular play button. Hover/focus-visible flips the fill
        // to a saturated emerald — color-codes the action.
        'sf:group sf:relative sf:h-8 sf:w-8 sf:rounded-full sf:p-0',
        'sf:hover:bg-primary sf:hover:text-primary-foreground',
        'sf:focus-visible:bg-primary sf:focus-visible:text-primary-foreground',
        // Animated states layered on top via attribute-aware utilities.
        visualStatus === 'success' && 'sf:seeflow-play-pop',
        visualStatus === 'error' && 'sf:inline-edit-shake',
        // Error retains the rose border (preserved from US-018).
        isError && 'sf:border-2 sf:border-rose-500',
      )}
    >
      {visualStatus === 'active' ? (
        <span
          aria-hidden
          data-testid="play-button-ring"
          className={cn(
            // Conic-gradient ring, clipped to a 2px-wide circular band via mask.
            // Rotates 1.2s linear. `prefers-reduced-motion: reduce` → no class
            // applied via @media in styles/index.css → static appearance.
            'sf:absolute sf:inset-0 sf:rounded-full sf:seeflow-ring-spin',
          )}
          style={{
            background:
              'conic-gradient(from 0deg, var(--emerald-glow) 0deg, transparent 200deg, var(--emerald-glow) 360deg)',
            WebkitMask:
              'radial-gradient(circle, transparent calc(50% - 2px), #000 calc(50% - 2px))',
            mask: 'radial-gradient(circle, transparent calc(50% - 2px), #000 calc(50% - 2px))',
          }}
        />
      ) : null}
      {/* Icon morph: success → Check (revealed to Play on hover via group-hover);
          error → AlertCircle (revealed to Play on hover); else → Play. */}
      {visualStatus === 'success' ? (
        <>
          <Check
            className="sf:h-4 sf:w-4 sf:relative sf:text-emerald-300 sf:group-hover:hidden"
            aria-hidden
          />
          <Play
            className="sf:h-4 sf:w-4 sf:relative sf:hidden sf:group-hover:block"
            aria-hidden
          />
        </>
      ) : visualStatus === 'error' ? (
        <>
          <AlertCircle
            className="sf:h-4 sf:w-4 sf:relative sf:text-rose-300 sf:group-hover:hidden"
            aria-hidden
          />
          <Play
            className="sf:h-4 sf:w-4 sf:relative sf:hidden sf:group-hover:block"
            aria-hidden
          />
        </>
      ) : (
        <Play
          className={cn(
            'sf:h-4 sf:w-4 sf:relative',
            visualStatus === 'active' && 'sf:opacity-80',
          )}
          aria-hidden
        />
      )}
    </Button>
  );
}
```

**3e.** Remove the now-unused import. The old `import { Loader2, Play } from 'lucide-react';` was replaced in step 3a; double-check `Loader2` is no longer referenced anywhere in the file:

```bash
grep -n "Loader2" packages/canvas/src/nodes/play-node.tsx
```

Expected: no matches.

**Step 4: Run the play-node tests to confirm new + existing pass**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/nodes/play-node.test.tsx
```

Expected: all tests pass (existing 12 + new 5 = 17). The existing tests still check things like `sf:hover:bg-primary`, `sf:rounded-full`, `sf:h-8 sf:w-8`, `disabled` — all preserved by the new `<PlayButton>`.

**Step 5: Run typecheck + full test suite**

```bash
cd packages/canvas && bun run typecheck && cd /Users/tuongaz/dev/seeflow && bun test
```

Expected: all green.

**Step 6: Commit**

```bash
git add packages/canvas/src/nodes/play-node.tsx packages/canvas/src/nodes/play-node.test.tsx
git commit -m "$(cat <<'EOF'
feat(canvas): refactor PlayNode button into visual-status PlayButton

Extracts the play button into a <PlayButton> sub-component that renders
idle/active/success/error states from deriveVisualStatus. Adds a
conic-gradient ring overlay for active, icon morphs (Check/AlertCircle)
with hover-reveals-Play on success/error, and the seeflow-play-pop /
inline-edit-shake one-shot animations. Tooltip + aria-label communicate
the same states.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `StatusIconPill` component + StateNode swap, delete `StatusPill`

**Goal:** Add the compact icon pill, swap it into StateNode, delete the old text pill, and update barrel exports.

**Files:**
- Create: `packages/canvas/src/nodes/status-icon-pill.tsx`
- Create: `packages/canvas/src/nodes/status-icon-pill.test.tsx`
- Modify: `packages/canvas/src/nodes/state-node.tsx`
- Modify: `packages/canvas/src/nodes/state-node.test.tsx`
- Delete: `packages/canvas/src/nodes/status-pill.tsx`
- Modify: `packages/canvas/src/nodes/index.ts` (replace pill export, add icon-pill export)

**Step 1: Write failing test for `StatusIconPill`**

Create `packages/canvas/src/nodes/status-icon-pill.test.tsx`:

```tsx
import { describe, expect, it } from 'bun:test';
import { AlertTriangle, Check, Radar } from 'lucide-react';
import { StatusIconPill } from './status-icon-pill.tsx';

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function isElement(value: unknown): value is ReactElementLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'props' in (value as { props?: unknown })
  );
}

function findElement(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
): ReactElementLike | null {
  if (!isElement(tree)) return null;
  if (predicate(tree)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

describe('StatusIconPill', () => {
  it('renders nothing for idle', () => {
    const result = StatusIconPill({ visualStatus: 'idle' });
    expect(result).toBeNull();
  });

  it('renders the Radar icon and amber tone for active', () => {
    const result = StatusIconPill({ visualStatus: 'active', summary: 'Checking' });
    expect(result).not.toBeNull();
    const icon = findElement(result, (el) => el.type === Radar);
    expect(icon).not.toBeNull();
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'active',
    );
    expect((wrapper?.props as { title?: string }).title).toBe('Checking');
  });

  it('renders the Check icon for success', () => {
    const result = StatusIconPill({ visualStatus: 'success' });
    const icon = findElement(result, (el) => el.type === Check);
    expect(icon).not.toBeNull();
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'success',
    );
  });

  it('renders the AlertTriangle icon for error', () => {
    const result = StatusIconPill({ visualStatus: 'error', summary: 'Down' });
    const icon = findElement(result, (el) => el.type === AlertTriangle);
    expect(icon).not.toBeNull();
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'error',
    );
  });

  it('forwards data-testid', () => {
    const result = StatusIconPill({ visualStatus: 'success', 'data-testid': 'pill-x' });
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-testid'?: string })['data-testid']).toBe('pill-x');
  });
});
```

**Step 2: Run the test to confirm it fails**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/nodes/status-icon-pill.test.tsx
```

Expected: FAIL with `Cannot find module './status-icon-pill.tsx'`.

**Step 3: Write `StatusIconPill`**

Create `packages/canvas/src/nodes/status-icon-pill.tsx`:

```tsx
import { AlertTriangle, Check, Radar } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import type { VisualStatus } from './lib/visual-status.ts';

const STYLES: Record<Exclude<VisualStatus, 'idle'>, string> = {
  // 20px tall, ~22px wide compact pill. Active gets the conic-gradient ring
  // via .seeflow-ring-spin on a sibling overlay (added below). Success/error
  // get a one-shot scale-pop via .seeflow-pill-pop.
  active:
    'sf:border-amber-400 sf:bg-amber-950/40 sf:text-amber-300',
  success: 'sf:border-emerald-400 sf:bg-emerald-950/40 sf:text-emerald-300 sf:seeflow-pill-pop',
  error: 'sf:border-rose-400 sf:bg-rose-950/40 sf:text-rose-300 sf:seeflow-pill-pop',
};

export interface StatusIconPillProps {
  visualStatus: VisualStatus;
  /** Optional tooltip text (typically the StatusReport summary). */
  summary?: string;
  'data-testid'?: string;
}

/**
 * Compact icon pill rendered on the right side of the StateNode header.
 * Mirrors the play button's position on PlayNode so the two node types
 * align visually. Idle → renders nothing (the header stays clean when
 * there's no status to report).
 *
 * Active gets a conic-gradient amber ring (sibling overlay, rotates via
 * seeflow-ring-spin under prefers-reduced-motion: no-preference).
 * Success + error get a one-shot 240ms scale pop. The icon itself never
 * rotates — only the border.
 */
export function StatusIconPill({
  visualStatus,
  summary,
  'data-testid': testId,
}: StatusIconPillProps): React.ReactElement | null {
  if (visualStatus === 'idle') return null;
  const Icon = visualStatus === 'active' ? Radar : visualStatus === 'success' ? Check : AlertTriangle;
  return (
    <span
      data-testid={testId}
      data-visual-status={visualStatus}
      title={summary}
      className={cn(
        'sf:relative sf:inline-flex sf:h-5 sf:items-center sf:justify-center sf:rounded-full sf:border-[1.5px] sf:px-1',
        STYLES[visualStatus as Exclude<VisualStatus, 'idle'>],
      )}
    >
      {visualStatus === 'active' ? (
        <span
          aria-hidden
          data-testid="status-icon-pill-ring"
          className="sf:absolute sf:inset-0 sf:rounded-full sf:seeflow-ring-spin"
          style={{
            background:
              'conic-gradient(from 0deg, var(--amber-hi) 0deg, transparent 200deg, var(--amber-hi) 360deg)',
            WebkitMask:
              'radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1.5px))',
            mask: 'radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1.5px))',
          }}
        />
      ) : null}
      <Icon className="sf:h-3 sf:w-3 sf:relative" aria-hidden />
    </span>
  );
}
```

Add a top-of-file React import only if needed for the ReactElement return type. Bun TS resolves the global React type via tsconfig; check `packages/canvas/tsconfig.json` if the typecheck complains. If it does, replace `React.ReactElement | null` with `JSX.Element | null` or just import:

```ts
import type { ReactElement } from 'react';
```

…and use `ReactElement | null`.

**Step 4: Run the test to confirm it passes**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/nodes/status-icon-pill.test.tsx
```

Expected: all 5 tests pass.

**Step 5: Update `state-node.tsx` to use `StatusIconPill`**

In `packages/canvas/src/nodes/state-node.tsx`:

**5a.** Replace the import on line 11:
```tsx
import { type NodeStatus, StatusPill } from './status-pill.tsx';
```
with:
```tsx
import type { NodeStatus } from '../types.ts';
import { deriveVisualStatus } from './lib/visual-status.ts';
import { StatusIconPill } from './status-icon-pill.tsx';
```

**5b.** Replace line 54:
```tsx
  const status = data.status ?? 'idle';
```
with:
```tsx
  const status = data.status ?? 'idle';
  const visualStatus = deriveVisualStatus(data.status, data.statusReport);
```

**5c.** Replace lines 260-262 (the existing `StatusPill` block inside the header):
```tsx
        <div className="sf:flex sf:shrink-0 sf:items-center sf:gap-1">
          <StatusPill status={status} />
        </div>
```
with:
```tsx
        <div className="sf:flex sf:shrink-0 sf:items-center sf:gap-1">
          <StatusIconPill
            visualStatus={visualStatus}
            summary={data.statusReport?.summary}
            data-testid="state-node-status-pill"
          />
        </div>
```

Leave the footer `StatusBadge` (if present in this file… it isn't — StateNode doesn't currently show a footer badge; only PlayNode does. Don't add one in this task — out of scope per design §3.)

**Step 6: Update `state-node.test.tsx` to assert the new pill instead of the old**

Read the existing test file for context:

```bash
grep -n "StatusPill\|data-status\|status-pill" packages/canvas/src/nodes/state-node.test.tsx
```

If there are existing assertions for `StatusPill`, update them to look for `StatusIconPill` (or `state-node-status-pill` testid). Add a new test that asserts:

```tsx
describe('StateNode status pill (status uplift)', () => {
  it('renders no pill when there is no status or statusReport', () => {
    const tree = callStateNode({});
    const pill = findElement(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'state-node-status-pill',
    );
    // StatusIconPill returns null for idle — the element placeholder may or
    // may not appear in the tree depending on React's reconciler shim. The
    // assertion that matters: no rendered pill element with a visual-status
    // attribute.
    const rendered = pill
      ? findElement(
          pill,
          (el) => (el.props as { 'data-visual-status'?: string })['data-visual-status'] !== undefined,
        )
      : null;
    // Either pill is null (component returned null) OR it's the unrendered
    // StatusIconPill call element; both are fine.
    expect(rendered).toBeNull();
  });

  it('renders the active pill when status is running', () => {
    const tree = callStateNode({ status: 'running' });
    const pill = findElement(
      tree,
      (el) =>
        typeof el.type === 'function' &&
        (el.props as { visualStatus?: string }).visualStatus === 'active',
    );
    expect(pill).not.toBeNull();
  });

  it('renders the success pill when statusReport.state is ok', () => {
    const tree = callStateNode({ statusReport: { state: 'ok', summary: 'All good', ts: 1 } });
    const pill = findElement(
      tree,
      (el) =>
        typeof el.type === 'function' &&
        (el.props as { visualStatus?: string }).visualStatus === 'success',
    );
    expect(pill).not.toBeNull();
  });

  it('renders the error pill when statusReport.state is error', () => {
    const tree = callStateNode({ statusReport: { state: 'error', summary: 'Down', ts: 1 } });
    const pill = findElement(
      tree,
      (el) =>
        typeof el.type === 'function' &&
        (el.props as { visualStatus?: string }).visualStatus === 'error',
    );
    expect(pill).not.toBeNull();
  });
});
```

Append the block to `state-node.test.tsx` (use the existing `callStateNode` helper).

**Step 7: Run state-node tests**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/nodes/state-node.test.tsx
```

Expected: existing tests still pass; new tests pass.

**Step 8: Delete `status-pill.tsx`**

```bash
rm packages/canvas/src/nodes/status-pill.tsx
```

**Step 9: Update `nodes/index.ts` barrel**

In `packages/canvas/src/nodes/index.ts`:

Replace lines 26-27:
```ts
export { StatusPill } from './status-pill.tsx';
export type { NodeStatus } from './status-pill.tsx';
```

with:
```ts
export { StatusIconPill } from './status-icon-pill.tsx';
export type { StatusIconPillProps } from './status-icon-pill.tsx';
export type { VisualStatus } from './lib/visual-status.ts';
export { deriveVisualStatus } from './lib/visual-status.ts';
```

The `NodeStatus` type is already re-exported from `packages/canvas/src/types.ts`, which is re-exported by `src/index.ts` (section 1). No top-level barrel change needed for that.

**Step 10: Verify no remaining `StatusPill` references**

```bash
grep -rn "StatusPill\|status-pill" packages/canvas/src apps/web/src apps/studio/src 2>/dev/null
```

Expected: no matches.

**Step 11: Typecheck + full test run**

```bash
cd packages/canvas && bun run typecheck && cd /Users/tuongaz/dev/seeflow && bun test
```

Expected: all green. If TS complains in `apps/web` about `NodeStatus` (it shouldn't — apps/web imports from `@seeflow/canvas`, which still re-exports `NodeStatus` via `types.ts`), check `bun run --filter @seeflow/web typecheck` and update the import path if needed.

**Step 12: Commit**

```bash
git add packages/canvas/src/nodes/status-icon-pill.tsx packages/canvas/src/nodes/status-icon-pill.test.tsx packages/canvas/src/nodes/state-node.tsx packages/canvas/src/nodes/state-node.test.tsx packages/canvas/src/nodes/index.ts
git rm packages/canvas/src/nodes/status-pill.tsx
git commit -m "$(cat <<'EOF'
feat(canvas): replace StateNode text pill with StatusIconPill

Drops the text-uppercase StatusPill. StateNode header now renders a
compact 20px icon pill on the right (Radar/Check/AlertTriangle for
active/success/error; nothing for idle). Active pill gets a rotating
conic-gradient amber ring; success + error get a one-shot pop.

Barrel exports updated: StatusPill removed, StatusIconPill +
deriveVisualStatus + VisualStatus added.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Edge handoff pulse on source-node success

**Goal:** When a source node transitions to `success`, briefly flag the outgoing edges with `data-handoff="true"` so the CSS keyframe from Task 1 plays. No edge animation on error.

**Files:**
- Modify: `packages/canvas/src/edges/editable-edge.tsx`
- Modify: `packages/canvas/src/edges/editable-edge.test.ts`

The cleanest hook is on the EDGE side: each `<EditableEdge>` watches the source node's `visualStatus`, and when it transitions to `success`, sets `data-handoff="true"` on its wrapper element for 500ms.

To get the source node's data we already have `useInternalNode(source)` in scope (line 141). Its `.data` carries `status` + `statusReport`.

**Step 1: Write the failing test**

Existing `editable-edge.test.ts` likely doesn't exercise this. Read the file first:

```bash
head -80 packages/canvas/src/edges/editable-edge.test.ts
```

Append a new `describe` block. Because the edge component uses `useInternalNode` from `@xyflow/react`, the cleanest test mocks just that hook. Bun test supports `mock.module(...)`. Pattern:

```ts
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ReactElement } from 'react';
import * as React from 'react';

// We need to call into EditableEdge with controlled useInternalNode output.
// Use the same hook-shim pattern as the node tests, plus a module mock
// for @xyflow/react's useInternalNode.

type SourceNodeData = {
  data: { status?: string; statusReport?: { state: string; summary?: string; ts: number } };
  internals: { positionAbsolute: { x: number; y: number } };
  measured: { width: number; height: number };
  width: number;
  height: number;
};

let sourceNodeStub: SourceNodeData | null = null;
let targetNodeStub: SourceNodeData | null = null;

mock.module('@xyflow/react', () => {
  const actual = require('@xyflow/react');
  return {
    ...actual,
    useInternalNode: (id: string) => (id === 'src' ? sourceNodeStub : targetNodeStub),
  };
});

// Then import EditableEdge AFTER the mock is registered:
import { EditableEdge } from './editable-edge.tsx';

describe('EditableEdge handoff pulse (status uplift)', () => {
  afterEach(() => {
    sourceNodeStub = null;
    targetNodeStub = null;
  });

  it('sets data-handoff on the wrapper when source transitions to success', async () => {
    // Setup: source node with status="done" → visualStatus === 'success'.
    sourceNodeStub = {
      data: { status: 'done' },
      internals: { positionAbsolute: { x: 0, y: 0 } },
      measured: { width: 100, height: 50 },
      width: 100,
      height: 50,
    };
    targetNodeStub = {
      data: {},
      internals: { positionAbsolute: { x: 200, y: 0 } },
      measured: { width: 100, height: 50 },
      width: 100,
      height: 50,
    };
    // Setup a minimal DOM wrapper that the edge useEffect can find by
    // CSS.escape(id). We can't easily render via React Flow here — instead
    // assert that the effect WOULD set data-handoff by checking the
    // setHandoff helper directly (see step 3 below).
    // For this test we focus on the helper, not the React Flow plumbing.
    expect(true).toBe(true); // placeholder — replaced after helper extraction
  });
});
```

**Pragmatic adjustment:** the hook-shim pattern in this codebase makes testing React useEffect timing brittle. Better: extract the transition-detection logic into a pure helper, unit-test the helper, and keep the React side small enough to verify manually.

Extract a helper:

```ts
// In editable-edge.tsx alongside the existing utilities (top of file is fine).
export function shouldFireEdgeHandoff(
  prev: string | undefined,
  next: string,
): boolean {
  // Fire only on the rising edge into 'success'. No fire if we were already
  // in success (avoids re-pulsing on unrelated re-renders).
  return next === 'success' && prev !== 'success';
}
```

Test it:

```ts
import { describe, expect, it } from 'bun:test';
import { shouldFireEdgeHandoff } from './editable-edge.tsx';

describe('shouldFireEdgeHandoff', () => {
  it('fires on rising edge into success', () => {
    expect(shouldFireEdgeHandoff(undefined, 'success')).toBe(true);
    expect(shouldFireEdgeHandoff('idle', 'success')).toBe(true);
    expect(shouldFireEdgeHandoff('active', 'success')).toBe(true);
    expect(shouldFireEdgeHandoff('error', 'success')).toBe(true);
  });

  it('does not fire when staying in success', () => {
    expect(shouldFireEdgeHandoff('success', 'success')).toBe(false);
  });

  it('does not fire on transitions away from success', () => {
    expect(shouldFireEdgeHandoff('success', 'idle')).toBe(false);
    expect(shouldFireEdgeHandoff('success', 'active')).toBe(false);
  });

  it('does not fire for other transitions', () => {
    expect(shouldFireEdgeHandoff('idle', 'active')).toBe(false);
    expect(shouldFireEdgeHandoff('active', 'error')).toBe(false);
  });
});
```

Append this block to `packages/canvas/src/edges/editable-edge.test.ts`.

**Step 2: Run the test — should fail because `shouldFireEdgeHandoff` doesn't exist yet**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/edges/editable-edge.test.ts
```

Expected: FAIL with module/export error.

**Step 3: Add `shouldFireEdgeHandoff` to `editable-edge.tsx`**

Open `packages/canvas/src/edges/editable-edge.tsx`. Add this near the top, below the existing helper functions (after `sideFromPosition`, around line 70):

```tsx
/**
 * Returns true when an edge should fire its handoff pulse, given the source
 * node's previous and next visual status. Rising edge into 'success' only —
 * staying in success or moving out of it does not pulse.
 */
export function shouldFireEdgeHandoff(
  prev: string | undefined,
  next: string,
): boolean {
  return next === 'success' && prev !== 'success';
}
```

**Step 4: Re-run helper test to confirm it passes**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/edges/editable-edge.test.ts
```

Expected: all tests pass.

**Step 5: Wire the helper into the edge's render path**

Still in `editable-edge.tsx`. Update the imports at the top to include `useRef`:

```tsx
import { useEffect, useRef, useState } from 'react';
```

And import `deriveVisualStatus`:

```tsx
import { deriveVisualStatus } from '../nodes/lib/visual-status.ts';
import type { StatusReport } from '../types.ts';
```

Inside `EditableEdge`, right after `useInternalNode(source)` (line 141), compute the source's visual status and run an effect that toggles `data-handoff` on the wrapper:

```tsx
  // Source-node visual-status drives the handoff pulse on outgoing edges.
  // The wrapper data attribute matches the CSS selector in styles/index.css
  // (`.react-flow__edge[data-handoff="true"] .react-flow__edge-path`).
  const sourceData = (sourceNode?.data ?? {}) as {
    status?: 'idle' | 'running' | 'done' | 'error';
    statusReport?: StatusReport & { ts: number };
  };
  const sourceVisualStatus = deriveVisualStatus(sourceData.status, sourceData.statusReport);
  const prevSourceVisualStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevSourceVisualStatusRef.current;
    prevSourceVisualStatusRef.current = sourceVisualStatus;
    if (!shouldFireEdgeHandoff(prev, sourceVisualStatus)) return;
    const wrapper = document.querySelector(
      `.react-flow__edge[data-id="${CSS.escape(id)}"]`,
    ) as SVGGElement | null;
    if (!wrapper) return;
    wrapper.setAttribute('data-handoff', 'true');
    const timer = window.setTimeout(() => {
      wrapper.removeAttribute('data-handoff');
    }, 500);
    return () => {
      window.clearTimeout(timer);
      wrapper.removeAttribute('data-handoff');
    };
  }, [id, sourceVisualStatus]);
```

**Notes on the implementation choice:**

- We reuse the existing imperative pattern (the file already does `document.querySelector(...)` on the edge wrapper for the reconnect-anchor override on line 207). Consistent with the file's style.
- `CSS.escape(id)` matches the existing pattern (line 208) — safe for ids with special chars.
- The cleanup function removes the attribute synchronously when the effect re-runs, so back-to-back successes don't compound.
- `useRef` tracks the previous value across renders; React 18 strict-mode double-mount safety: the first render captures `undefined → 'success'` only if the source is already `done` at mount, which fires once per mount — acceptable (the user just opened the canvas to a finished run; a single pulse is fine).

**Step 6: Verify the existing edge tests still pass**

```bash
cd /Users/tuongaz/dev/seeflow && bun test packages/canvas/src/edges/editable-edge.test.ts
```

Expected: all tests pass.

**Step 7: Run full test suite + typecheck**

```bash
cd packages/canvas && bun run typecheck && cd /Users/tuongaz/dev/seeflow && bun test
```

Expected: all green.

**Step 8: Commit**

```bash
git add packages/canvas/src/edges/editable-edge.tsx packages/canvas/src/edges/editable-edge.test.ts
git commit -m "$(cat <<'EOF'
feat(canvas): add outgoing-edge handoff pulse on source-node success

Each EditableEdge watches its source node's derived visual status.
On the rising edge into 'success', flags the edge wrapper with
data-handoff="true" for 500ms; the seeflow-edge-handoff keyframe
in styles/index.css runs once.

Extracts shouldFireEdgeHandoff as a pure helper for unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Manual visual review + final verification

**Goal:** Catch any visual regressions the unit tests can't, then run the full quality gate.

**Files:** None modified in this task. Pure verification.

**Step 1: Run the dev server**

```bash
bun run dev
```

This starts Vite on 5173 and Hono on 4321. Open `http://localhost:5173` and navigate to the `order-pipeline` demo (the design names this as the visual reference because it has both play actions and status reports).

**Step 2: Walk the four visual states in the browser**

For each state, observe:

1. **Idle** — Fresh load, no runs. PlayNode shows a Play icon, default emerald border. StateNode shows NO pill in the header. No animations.
2. **Active** — Click Play on a PlayNode. Expect:
   - Spinning conic-gradient ring around the play button (1.2s cycle).
   - Play icon at ~80% opacity.
   - Existing `seeflow-node-pulse` amber halo still wrapping the node.
   - When a StateNode receives a `pending` status (downstream from the run), its header pill renders with a Radar icon and amber spinning ring.
3. **Success** — Wait for the run to complete. Expect:
   - PlayNode button morphs to a Check icon (emerald). Brief 320ms scale pop. Brief emerald `seeflow-success-halo` box-shadow expanding outward (you'll need to look for this — it's a single 600ms expansion).
   - On the outgoing edges from the successful node, a subtle 500ms stroke-width pulse (it gains ~1px then returns).
   - StateNode pill morphs to a Check icon with emerald background. Brief 240ms pop.
   - Hover the PlayNode button → icon reveals back to Play (the click-target affordance).
4. **Error** — Force an error (e.g., misconfigure the action URL). Expect:
   - PlayNode button morphs to AlertCircle (rose). 320ms `inline-edit-shake`. Rose border retained.
   - Tooltip on the button reads "Failed: <message>" or "Failed, run again".
   - No edge pulse on error — confirmed by watching the outgoing edges stay quiet.
   - Hover → icon reveals back to Play.

**Step 3: Test `prefers-reduced-motion`**

In Chrome DevTools → ⋮ → More tools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce".

Re-trigger each state. Expect:
- No ring rotation. The amber/emerald border still appears, just static.
- No scale pops on success/error transitions.
- No `seeflow-success-halo` box-shadow expansion.
- No edge stroke-width pulse.
- Static colors + icons still change instantly.

**Step 4: Confirm StateNode + PlayNode pills align visually**

Pan to a section where both node types sit side by side. The right-edge position of the play button on PlayNode should align (vertically) with the right-edge of the StateNode header pill.

**Step 5: Confirm the footer `StatusBadge` on PlayNode is unchanged**

Trigger a status report on a PlayNode (the order-pipeline demo has these). The bottom-of-node `StatusBadge` row should still render with the colored dot + summary text. We did not touch this in the uplift.

**Step 6: Run the full quality gate**

```bash
bun run format
bun run lint
bun run typecheck
bun test
```

Expected: all four pass. `bun run format` may make no changes (Biome ignores CSS; nothing else touched should need reformatting). `bun run lint` should pass cleanly.

**Step 7: If any check fails, fix and amend**

If `bun run lint` flags anything (typically: import order, unused imports), fix and amend with `git commit --amend --no-edit` on the most recent commit that caused the lint issue. If multiple commits, use `git commit --fixup=<sha>` and rebase interactively only if needed — otherwise just create follow-up commits per the project's "prefer new commits over amend" rule (see `CLAUDE.md`).

**Step 8: Final verification — `git log` and `git diff main`**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected:
- 5 commits matching the task names above (CSS keyframes; visual-status helper; PlayButton; StatusIconPill swap; edge handoff).
- Diff scope confined to `packages/canvas/`.

**Step 9: Stop here and report**

Use the executing-plans skill's normal "Ready for feedback" handoff to your human partner. **Do not** continue into the finishing-a-development-branch sub-skill in the same session — surface what shipped and let the partner decide whether to land it now or revisit anything.

---

## Out of scope (per design §Out of scope — YAGNI)

Do not implement any of these even if they seem like natural extensions:

- Traveling-particle edge animations.
- Multi-node orchestration coordinator (each downstream node still lights up from its own status update — no coordination code).
- New SSE event types.
- A global "reset all to idle" action.
- `warn` promoted to its own visual state. (`warn` reports still appear in the footer `StatusBadge` but the pill stays idle — by design.)

## If something's off, stop and ask

- If `apps/web` typecheck breaks after Task 2 (`NodeStatus` import path), stop and check whether the change should go through the published `@seeflow/canvas` barrel or whether a direct relative import slipped in somewhere.
- If `bun test` shows hook-shim tests failing in unexpected ways after the PlayNode refactor, the most likely cause is the new `<PlayButton>` adding a `useState` call. It doesn't — the sub-component is stateless. If you find yourself adding state to `<PlayButton>`, stop and re-derive the design (it should all be `data-*` attribute-driven CSS, no JS state machine per design §2).
- If the conic-gradient ring doesn't render in Safari, the `mask`/`WebkitMask` may need different syntax — both are included; fall back to a 2px solid `border-emerald-300` if you can't get the mask working cross-browser. Note the fallback in the commit message.

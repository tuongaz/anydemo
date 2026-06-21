# Tailwind 3.x → 4.x Upgrade — Design

**Status:** ready for implementation
**Date:** 2026-05-19
**Scope:** `packages/canvas` + `apps/web` in a single PR.

## Why

Both packages are pinned to `tailwindcss@^3.4.14`. Staying on v3 is fine forever, but moving to v4 gets us the v4 build-speed gains, native CSS cascade layers, modern `@property` and `color-mix()` features, and removes drift from the wider shadcn ecosystem (shadcn's published v4 guide is now the only path for new tokens).

## What stays the same

- The `sf:`-prefixed isolation contract for canvas. Class strings change shape but the namespace lives on.
- The `.seeflow-canvas-root` wrapper as the sole place canvas tokens are defined.
- `apps/web`'s manually-mirrored tokens at `:root` (the comment in `apps/web/src/index.css` calls this out). Consolidating into a shared token source is a separate decision, not in scope.
- The `build-canvas.yml` action that commits `dist/` to `main` after pushes to `packages/canvas/src/**`.

## Architecture after upgrade

### `packages/canvas/`

```
package.json            tailwindcss → @tailwindcss/cli + @tailwindcss/postcss (^4)
                        tailwindcss-animate → tw-animate-css (^1)
postcss.config.cjs      plugins: { '@tailwindcss/postcss': {} }
tailwind.config.cjs     DELETED
scripts/
  prefix-tailwind.mjs   Rewritten to splice `sf:` (colon) instead of `sf-`
src/styles/index.css    @import "tailwindcss" prefix(sf);
                        @import "tw-animate-css";
                        .seeflow-canvas-root { --background: hsl(240 10% 3.9%); ... }
                        @theme inline { --color-background: var(--background); ... }
```

Why `@theme inline`: without it, `@theme` evaluates the value at theme-build time, so wrapper-scoped overrides on `.seeflow-canvas-root` would have no effect. `inline` preserves the `var(--token)` reference in generated utilities — same trick shadcn v4 uses for the `.dark` class.

### `apps/web/`

Same shape: drop config, swap directives, swap deps, wrap HSL tokens. No prefix. Its own `index.css` keeps the "Mirrored from @seeflow/canvas" comment + token list intact.

### Class-string shape

```jsx
// v3
<div className="sf-flex sf-px-2 data-[state=open]:sf-animate-in" />

// v4
<div className="sf:flex sf:px-2 data-[state=open]:sf:animate-in" />
```

## Migration plan

### Canvas

1. **Capture v3 baseline.** Build canvas, freeze a copy of `dist/style.css`. Screenshot canonical surfaces via `gstack`/browser tooling into `docs/plans/2026-05-19-tailwind-v4-upgrade/baseline/`: every Radix wrapper (tooltip, popover, dropdown, dialog, sheet, context-menu) in open state, every node type (play/state/shape/image/icon/html), edit-mode chrome, mini-mode thumbnail, detail-panel selected.
2. **Run `npx @tailwindcss/upgrade`** in `packages/canvas/`. Commit the tool's diff in isolation as `chore(canvas): run @tailwindcss/upgrade`. Tool handles: deps, `@tailwind` → `@import "tailwindcss"`, `tailwind.config.cjs` → `@theme inline` in `src/styles/index.css`, `hsl()` wrapping of token values, postcss plugin swap.
3. **Add prefix.** Edit `src/styles/index.css`: `@import "tailwindcss";` → `@import "tailwindcss" prefix(sf);`. Rewrite `scripts/prefix-tailwind.mjs` to splice `sf:` instead of `sf-`; teach its regex/tokenizer to treat `sf:foo` as already-prefixed (idempotency). Dry-run the codemod into a tmp dir, grep output for malformed double-colons (`sf::`, `:sf:sf:`), then apply to all 29 source files. Spot-check the 13 `data-[state=*]:sf-animate-*` occurrences — verify they produce `data-[state=open]:sf:animate-in`.
4. **Swap animate plugin.** `bun remove tailwindcss-animate && bun add -D tw-animate-css@^1`. Add `@import "tw-animate-css";` after the Tailwind import. Drop the dead `accordion-down/up` keyframes from the migrated `@theme inline` block — no `sf:animate-accordion-*` exists in source.
5. **Verify.** `bun run --filter @seeflow/canvas build && bun run typecheck && bun test`. Diff new `dist/style.css` byte-size against the v3 baseline; investigate wild deltas.

### Apps/web

6. **Run `npx @tailwindcss/upgrade`** in `apps/web/`. Verify the mirrored-tokens comment + token list survive the rewrite intact. `bun run --filter @seeflow/web build && bun run typecheck`.

### Integration verification

7. **Re-screenshot** the same canonical surfaces with `gstack`, diff against `baseline/`. Pixel-near-identical is the bar. Real differences come from v4's preflight changes (e.g., `button` default border now `currentColor`) — accept those if intentional, fix anything else.
8. **Repo scan** for variant-stacking-flip patterns (`first:*:` → `*:first:`). Canvas has none today; verify apps/web is also clean.

### Ship

Single PR, commits in this order:
1. canvas — upgrade-tool diff
2. canvas — prefix manual fix + codemod sweep
3. canvas — animate plugin swap + dead keyframe cleanup
4. apps/web — upgrade-tool diff
5. PR body includes baseline+after screenshots side by side

`.github/workflows/build-canvas.yml` rebuilds `dist/` on `main` after merge.

## Risks

- **Browser floor rises** to Safari 16.4+ / Chrome 111+ / Firefox 128+ (all early 2023). Note in canvas CHANGELOG for external consumers.
- **Codemod tokenizer + variant colon.** `data-[state=open]:sf:animate-in` is unusual; double-colon edge cases are the highest-risk transformation. Mitigation: mandatory dry-run + grep before apply.
- **Layer-order shift.** v4 uses native CSS cascade layers. Wrapper-scoped overrides on `.seeflow-canvas-root` should still win on specificity, but the react-flow overrides in `index.css` aren't Tailwind utilities and need visual smoke-testing.
- **`tw-animate-css` v2.0.0** has documented breaking changes per its README. Pin to `^1`.
- **`apps/studio/dist/web/assets/*`** ships stale bundled CSS from a prior build. Re-run the studio build after merge so its dist matches.

## Verification gate

Upgrade is mergeable when:
- `bun run --filter @seeflow/canvas build` succeeds and `dist/style.css` byte-size is within ~20% of baseline.
- `bun run --filter @seeflow/web build` succeeds.
- `bun run typecheck && bun test` pass at repo root.
- Side-by-side screenshot diff shows no unintended visual regressions across all canonical surfaces listed in step 1.

## Out of scope

- Consolidating canvas + apps/web tokens into a shared source.
- Adding Playwright snapshot tests as permanent CI infrastructure.
- Shadow-DOM isolation for the canvas.
- Updating external consumer docs beyond a one-line browser-floor note in the canvas CHANGELOG.

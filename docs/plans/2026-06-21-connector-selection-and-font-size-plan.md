# Connector selection markers + font-size slider/input — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show selection-marker dots on every selected connector (not just single-select), and turn the font-size control into a slider+number input (slider max 64, input up to 200) that applies to both nodes and connector labels in a mixed selection.

**Architecture:** Two independent areas of `packages/canvas/`. (A) The custom edge `EditableEdge` already renders endpoint dots gated on `data.reconnectable`; we add a second, non-interactive gate `data.selectedMarker` set for *any* selected connector in `seeflow-canvas.tsx`. (B) `style-strip.tsx` already fans color out to nodes+connectors; we unify the font-size apply/preview the same way, widen the slider range to 8–64, and make `SliderControl` optionally render an editable number input that accepts values above the slider max.

**Tech Stack:** React 18, @xyflow/react v12, Tailwind v4 (`sf:` prefix), Bun test, Biome.

**Conventions (read first):**
- `packages/canvas/CLAUDE.md` — Tailwind `sf:` prefix rules, edge wrapper rules, append-only useState for shim tests.
- Tests live beside sources. Run from repo root. `bun run format` BEFORE `bun run lint`.
- After editing canvas source, the web/mcp bundles are stale — fine for unit tests; only matters for e2e.

---

### Task 1: Connector selection-marker dots (any selection count)

Render the visible endpoint dots for every *selected* connector, while keeping the draggable reconnect handles single-selection only.

**Files:**
- Modify: `packages/canvas/src/edges/editable-edge.tsx:383`
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx:3969-3987` (the `decorate` return)
- Test: `packages/canvas/src/edges/editable-edge.test.ts`

**Step 1: Write the failing test**

Open `packages/canvas/src/edges/editable-edge.test.ts`, find the existing test that asserts the endpoint dots render when `data.reconnectable` is true (search `edge-endpoint-source` / `reconnectable`). Mirror it to add a test that the dots ALSO render when `data.selectedMarker` is true and `reconnectable` is false/absent:

```ts
it('renders endpoint marker dots when selectedMarker is set (multi-select, non-draggable)', () => {
  const tree = renderEditableEdge({
    data: { selectedMarker: true }, // reconnectable absent
  });
  expect(findByTestId(tree, `edge-endpoint-source-${EDGE_ID}`)).not.toBeNull();
  expect(findByTestId(tree, `edge-endpoint-target-${EDGE_ID}`)).not.toBeNull();
});
```

Match the existing test's render helper + assertion utilities exactly (names like `renderEditableEdge`, `EDGE_ID`, `findByTestId` may differ — copy whatever the neighbouring reconnectable test uses).

**Step 2: Run test to verify it fails**

Run: `bun test packages/canvas/src/edges/editable-edge.test.ts`
Expected: FAIL — dots not rendered because `showEndpointDots` only checks `reconnectable`.

**Step 3: Implement the minimal change**

In `editable-edge.tsx`, widen the gate at line 383:

```ts
// US-024 + selection markers: render the visible endpoint dots when this edge
// is reconnectable (sole-selected, dots align over the draggable native
// EdgeUpdateAnchors) OR when it's part of a multi-selection (selectedMarker) —
// in the latter case there are no native anchors, so the dots are pure
// pointer-events:none selection feedback.
const showEndpointDots = data?.reconnectable === true || data?.selectedMarker === true;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/canvas/src/edges/editable-edge.test.ts`
Expected: PASS (new test + all existing).

**Step 5: Set the flag in the canvas**

In `seeflow-canvas.tsx`, in the `decorate` function's returned `data` object (~3970-3987), add `selectedMarker: isSelected` alongside `reconnectable: enableReconnect`:

```ts
      return {
        ...next,
        data: {
          ...next.data,
          onLabelChange: isEditMode ? onConnectorLabelChange : undefined,
          reconnectable: enableReconnect,
          // Selection feedback for ANY selected connector (single OR multi).
          // Drives the non-interactive endpoint dots in EditableEdge; unlike
          // `reconnectable` it is not gated to the sole-selected connector.
          selectedMarker: isSelected,
          registerEditHandle,
          getEditingConnectorId,
          setEditingConnectorId,
        },
      };
```

`isSelected` is already computed at ~3951; `selectedConnectorIdSet` is already a dep of the `useMemo`, so no deps change is needed.

**Step 6: Typecheck + run canvas tests**

Run: `cd packages/canvas && bun run typecheck` → Expected: clean.
Run: `bun test packages/canvas/src/edges packages/canvas/src/components/seeflow-canvas.test.tsx` → Expected: PASS.

**Step 7: Commit**

```bash
git add packages/canvas/src/edges/editable-edge.tsx packages/canvas/src/edges/editable-edge.test.ts packages/canvas/src/components/seeflow-canvas.tsx
git commit -m "feat(canvas): show endpoint marker dots for every selected connector"
```

---

### Task 2: Font size applies to both nodes and connectors (mixed selection)

Unify the font-size apply/preview so one control drives node text AND connector labels. Today `applyFontSize`/`previewFontSize` touch nodes only and `applyConnectorFontSize`/`previewConnectorFontSize` touch connectors only; the popover picks one set based on `pureConnector`, so a mixed selection never updates connectors.

**Files:**
- Modify: `packages/canvas/src/components/style-strip.tsx` (apply helpers ~339-392; popover wiring ~924-942)
- Test: `packages/canvas/src/components/style-strip.test.tsx`

**Step 1: Write the failing test**

In `style-strip.test.tsx`, find an existing test that renders `StyleStrip` with a mixed selection (search `connectors:` props and `onStyleConnector`). Add a test that committing the font-size slider on a mixed selection calls BOTH `onStyleNode`/`onStyleNodes` (with `fontSize`) AND `onStyleConnector` (with `fontSize`):

```ts
it('font size commit on a mixed selection updates nodes and connectors', () => {
  const onStyleNode = mock();
  const onStyleConnector = mock();
  const tree = renderStyleStrip({
    nodes: [makeVisualNode('n1')],
    connectors: [makeConnector('c1')],
    onStyleNode,
    onStyleConnector,
  });
  const slider = findByTestId(tree, 'style-tab-font-size-slider');
  commitSlider(slider, 40); // mirror existing slider-commit helper in this file
  expect(onStyleNode).toHaveBeenCalledWith('n1', { fontSize: 40 });
  expect(onStyleConnector).toHaveBeenCalledWith('c1', { fontSize: 40 });
});
```

Copy the real render helper / slider-commit utility names from neighbouring font-size tests in the same file.

**Step 2: Run test to verify it fails**

Run: `bun test packages/canvas/src/components/style-strip.test.tsx`
Expected: FAIL — `onStyleConnector` not called for the mixed selection.

**Step 3: Add unified apply/preview helpers**

In `style-strip.tsx`, after `applyConnectorFontSize`/`previewConnectorFontSize` (~389), add helpers that fan out to whichever entities are present (each existing helper is already a no-op when its collection is empty):

```ts
// Unified text font-size fan-out: one control drives node text AND connector
// labels. Each underlying helper is a no-op when its collection is empty, so
// this is correct for nodes-only, connectors-only, and mixed selections.
const applyTextFontSize = (n: number) => {
  applyFontSize(n);
  applyConnectorFontSize(n);
};
const previewTextFontSize = (n: number) => {
  previewFontSize(n);
  previewConnectorFontSize(n);
};
// Indeterminate across the WHOLE selection: nodes default to 22, connectors to
// 11, so a genuine mix of node+connector text reads "Mixed" — which is honest,
// they ARE different sizes until the user picks one.
const textFontSizeIndeterminate = (() => {
  const vals = new Set<number>();
  for (const n of visualNodes) vals.add(n.data.fontSize ?? NODE_FONT_SIZE_DEFAULT);
  for (const c of connectors) vals.add(c.fontSize ?? CONNECTOR_FONT_SIZE_DEFAULT);
  return vals.size > 1;
})();
```

**Step 4: Rewire the popover slider (still in this task; range stays 8–64 wiring lands in Task 4)**

Update the `SliderControl` block at ~924-942 to use the unified helpers and a single value/default source:

```tsx
                <SliderControl
                  value={
                    hasNodes ? firstVisualNode?.data.fontSize : firstConnector?.fontSize
                  }
                  defaultValue={hasNodes ? NODE_FONT_SIZE_DEFAULT : CONNECTOR_FONT_SIZE_DEFAULT}
                  min={8}
                  max={64}
                  suffix="px"
                  editable
                  inputMax={200}
                  indeterminate={textFontSizeIndeterminate}
                  onPreview={previewTextFontSize}
                  onCommit={applyTextFontSize}
                  testId={
                    pureConnector
                      ? 'style-tab-connector-font-size-slider'
                      : 'style-tab-font-size-slider'
                  }
                />
```

(`editable` + `inputMax` props are implemented in Task 3 — this file won't typecheck until Task 3 lands, so run the combined typecheck at the end of Task 3. If you prefer green-between-tasks, do Task 3 before this step.)

**Step 5: Commit**

```bash
git add packages/canvas/src/components/style-strip.tsx packages/canvas/src/components/style-strip.test.tsx
git commit -m "feat(canvas): font size applies to nodes and connector labels in mixed selections"
```

---

### Task 3: SliderControl gains an editable number input that can exceed the slider max

Replace the read-only value `<span>` with an editable number input when `editable` is set. The slider thumb pins at `max` (64) while the input accepts up to `inputMax` (200).

**Files:**
- Modify: `packages/canvas/src/components/style-strip.tsx` — `SliderControl` (~1258-1325)
- Test: `packages/canvas/src/components/style-strip.test.tsx`

**Step 1: Write the failing tests**

```ts
it('SliderControl input commits a value above the slider max (clamped to inputMax)', () => {
  const onCommit = mock();
  const tree = renderSliderControl({ value: 22, min: 8, max: 64, editable: true, inputMax: 200, onCommit });
  const input = findByTestId(tree, 'style-tab-font-size-slider-input');
  typeAndBlur(input, '120'); // mirror existing input helpers; fall back to firing change+blur
  expect(onCommit).toHaveBeenCalledWith(120);
});

it('SliderControl input clamps above inputMax', () => {
  const onCommit = mock();
  const tree = renderSliderControl({ value: 22, min: 8, max: 64, editable: true, inputMax: 200, onCommit });
  typeAndBlur(findByTestId(tree, 'style-tab-font-size-slider-input'), '999');
  expect(onCommit).toHaveBeenCalledWith(200);
});
```

If the file has no `renderSliderControl` helper (SliderControl is module-private), test it via the full `StyleStrip` font-size path instead, asserting `onStyleNode`/`onStyleConnector` receive the clamped value.

**Step 2: Run to verify failure**

Run: `bun test packages/canvas/src/components/style-strip.test.tsx`
Expected: FAIL — no input element / `editable` prop unknown.

**Step 3: Implement**

Extend the `SliderControl` signature and body:

```tsx
function SliderControl({
  value,
  defaultValue,
  min,
  max,
  step = 1,
  suffix,
  indeterminate,
  editable,
  inputMax,
  onPreview,
  onCommit,
  testId,
}: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  indeterminate?: boolean;
  /** Render an editable number input instead of a read-only readout. */
  editable?: boolean;
  /** Hard cap for typed input (defaults to `max`). Lets the input exceed the
   *  slider's max while the thumb pins at `max`. */
  inputMax?: number;
  onPreview?: (n: number) => void;
  onCommit: (n: number) => void;
  testId: string;
}) {
  const hardMax = inputMax ?? max;
  const upstream = value ?? defaultValue;
  const [local, setLocal] = useState<number>(upstream);
  const [picked, setPicked] = useState<boolean>(false);
  useEffect(() => {
    setLocal(upstream);
    setPicked(false);
  }, [upstream]);
  const showPlaceholder = indeterminate && !picked;
  const clampInput = (n: number) => Math.min(hardMax, Math.max(min, n));
  return (
    <div className="sf:flex sf:w-48 sf:items-center sf:gap-3">
      <Slider
        min={min}
        max={max}
        step={step}
        value={[Math.min(local, max)]}
        onValueChange={([v]) => {
          const next = v ?? min;
          setLocal(next);
          setPicked(true);
          onPreview?.(next);
        }}
        onValueCommit={([v]) => onCommit(v ?? min)}
        data-testid={testId}
        data-indeterminate={showPlaceholder ? 'true' : undefined}
        className={cn('sf:flex-1', showPlaceholder && 'sf:opacity-60')}
      />
      {editable ? (
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={hardMax}
          data-testid={`${testId}-input`}
          aria-label="Font size"
          value={showPlaceholder ? '' : local}
          placeholder={showPlaceholder ? 'Mixed' : undefined}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (Number.isNaN(raw)) return;
            const next = clampInput(raw);
            setLocal(next);
            setPicked(true);
            onPreview?.(next);
          }}
          onBlur={() => onCommit(clampInput(local))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onCommit(clampInput(local));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="sf:w-14 sf:shrink-0 sf:rounded sf:border sf:border-input sf:bg-background sf:px-1.5 sf:py-0.5 sf:text-right sf:text-xs sf:tabular-nums"
        />
      ) : (
        <span
          data-testid={`${testId}-value`}
          className="sf:w-12 sf:shrink-0 sf:text-right sf:text-xs sf:tabular-nums sf:text-muted-foreground"
        >
          {showPlaceholder ? (
            'Mixed'
          ) : (
            <>
              {local}
              {suffix}
            </>
          )}
        </span>
      )}
    </div>
  );
}
```

Notes:
- Non-editable call sites (border size, corner radius, shadow) are unchanged — they don't pass `editable`, so they keep the `<span>` readout and `inputMax` defaults to `max` (no behaviour change).
- The slider passes `Math.min(local, max)` so a typed 120 keeps the thumb pinned at 64 without Radix clamping `local`.
- Verify the `sf:` classes used (`sf:border-input`, `sf:bg-background`) exist in the compiled CSS; if Tailwind doesn't emit them, reuse classes already present in the file (grep `sf:border` / `sf:bg-` in `style-strip.tsx` and the design tokens). Re-run the canvas CSS build (final task) so new literals get picked up.

**Step 4: Run to verify pass**

Run: `bun test packages/canvas/src/components/style-strip.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/canvas/src/components/style-strip.tsx packages/canvas/src/components/style-strip.test.tsx
git commit -m "feat(canvas): SliderControl supports an editable number input above slider max"
```

---

### Task 4: Full verification + CSS/bundle rebuild

**Step 1: Typecheck everything**

Run: `bun run typecheck`
Expected: clean across all workspaces.

**Step 2: Format then lint**

Run: `bun run format` then `bun run lint`
Expected: no errors (format first, per CLAUDE.md).

**Step 3: Rebuild canvas (compiled CSS + dist) so new `sf:` classes ship**

Run: `bun run --filter @seeflow/canvas build`
Expected: success. (The GitHub Action commits `dist/` on `main`; locally we build to confirm the new classes compile.)

**Step 4: Full canvas unit suite**

Run: `bun test packages/canvas`
Expected: all pass (baseline was 1423/0).

**Step 5: Manual smoke (optional but recommended)**

Run `bun run dev`, then in the browser:
- Box-select / Cmd+A across nodes+connectors → every connector shows endpoint marker dots.
- Open the Text popover → drag the slider (caps at 64) and type `120` in the input → node text and connector labels both grow.
- Single-connector select still allows endpoint drag-reconnect.

**Step 6: Commit any formatting/dist changes**

```bash
git add -A
git commit -m "chore(canvas): rebuild dist + biome format for connector selection/font-size changes"
```

---

## Out of scope (confirmed)
- `text-align` stays node-only.
- Reconnect-by-drag stays a single-connector action.
- No schema change (`fontSize` already exists on both `NodeVisual` and `ConnectorBase`).

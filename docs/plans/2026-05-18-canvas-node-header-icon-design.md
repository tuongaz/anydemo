# Canvas Node Header Icon — Design

**Date:** 2026-05-18
**Status:** Approved (brainstorming)

## Summary

Add an optional icon to the header of `playNode`, `stateNode`, and the caption of `htmlNode`. Icons are referenced by kebab-case Lucide name in the JSON schema. Host apps may register custom React components by name via a new `customIcons` prop on `<SeeflowCanvas>`. A new `<Icon>` UI primitive does the lookup and renders.

The `/seeflow` skill is updated so generated flows include an icon on every meaningful play/state node.

## Goals

- Visual: a small glyph in the header makes node kind scannable at a glance.
- JSON-first: demo files (`seeflow.json`) carry only a string name — portable, diff-friendly.
- Pluggable: hosts can extend the registry with custom React components without forking the canvas.
- No layout shift when icon is absent.

## Non-goals

- Per-node icon color / size knobs (icon inherits `textColor`; size is fixed per render site).
- Icon picker in the floating StyleStrip (only the DetailPanel field).
- Touching `iconNode` semantics (the standalone glyph node already has its own `icon` field).

## Data model

### `packages/canvas/src/types.ts`

Add `icon?: string` to:

- `NodeData` — covers `playNode` and `stateNode`.
- `HtmlNodeData`.

`iconNode.data.icon` (existing, required) is unchanged.

### `apps/studio/src/schema.ts` (single source of truth)

Add `icon: z.string().optional()` to `NodeDataSchema` and `HtmlNodeDataSchema`. Canvas types mirror this; no enum check — any string is accepted.

### Render-time fallback

Unknown name → `ICON_FALLBACK_NAME` (`help-circle`). Typos in JSON are visible but never throw.

## `<Icon>` component

New file `packages/canvas/src/ui/icon.tsx`:

```tsx
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  name?: string;
  as?: ComponentType<LucideProps>;
  size?: number | string;   // default 16
  fallback?: string;        // default ICON_FALLBACK_NAME
}
```

Resolution order inside `<Icon>`:

1. `as` prop (direct component injection — programmatic escape hatch).
2. `useContext(IconRegistryContext).custom[name]` (host-registered).
3. `ICON_REGISTRY[name]` (built-in Lucide).
4. `ICON_REGISTRY[fallback]`.

Color from `currentColor`. Caller controls via `color` style or Tailwind `text-*`.

### Host registry seam

New internal `IconRegistryContext` + `IconRegistryProvider`, mounted once inside `<SeeflowCanvas>`. New prop:

```tsx
<SeeflowCanvas customIcons={{ 'my-thing': MyComponent }} ... />
```

`SeeflowCanvasProps` gains `customIcons?: Record<string, ComponentType<LucideProps>>`. Context default is empty object; no host change = no behaviour change.

### Public exports (`src/index.ts` §8 — UI primitives)

- `Icon`, `IconProps`
- `IconRegistryProvider`, `useIconRegistry`

## Render integration

### play-node.tsx + state-node.tsx — header

Prepend the icon inside the existing `<div data-testid="node-header">`:

```tsx
{data.icon ? (
  <Icon
    name={data.icon}
    size={16}
    className="shrink-0"
    style={colorTokenStyle(data.textColor, 'text')}
    aria-hidden
  />
) : null}
```

Layout: `[icon?] [name (flex-1)] [play-button | status-pill]`. `shrink-0` prevents the icon from squeezing.

### html-node.tsx — caption

Wrap the existing `<div data-testid="html-node-label">` content in a flex row when `icon` set:

```tsx
<div className="flex items-center justify-center gap-1">
  {data.icon ? <Icon name={data.icon} size={12} aria-hidden /> : null}
  <span className="truncate">{data.name}</span>
</div>
```

Smaller (12 px) to match the 11 px caption text.

### `React.memo` impact

None. Existing `arePropsEqual` checks `prev.data === next.data`; `icon` is inside `data`.

## DetailPanel field

Add an "Icon" row to the General/Info section for play/state/html nodes. Reuse the existing exported `IconPickerPopover` plus a Clear affordance.

New optional callback on `DetailPanelProps` and `SeeflowCanvasProps`:

```tsx
onIconChange?: (nodeId: string, icon: string | null) => void;
```

When unset, the row is hidden (matches the pattern for `onNameChange` / `onDescriptionChange`).

## `/seeflow` skill update (`skills/seeflow/SKILL.md`)

1. **New rule** under "detail on important nodes":

   > **RULE — icon on important nodes:** Every `playNode` and `stateNode` SHOULD include an `icon` field — a kebab-case Lucide icon name that visually echoes the node's `kind`. The icon renders left of the name in the header. Decorative; not a status indicator.

2. **Kind → suggested icon** table appended to the `kind` enum:

   | `kind` | suggested `icon` |
   |---|---|
   | `service` | `server` |
   | `endpoint` | `plug` |
   | `worker` | `cog` |
   | `workflow` | `git-branch` |
   | `queue` | `list-ordered` |
   | `topic` / `bus` | `radio-tower` |
   | `db` | `database` |
   | `store` | `archive` |
   | `cache` | `zap` |
   | `scheduler` | `clock` |
   | `external-api` | `cloud` |
   | `trigger` | `play` |

3. **Worked JSON examples** in the schema cheatsheet get `"icon": "server"` (playNode) and `"icon": "database"` (stateNode).

4. **htmlNode optional field list** appends `icon`.

5. **No agent-side validation** — schema accepts any string.

## Tests

- `icon.test.tsx`: renders by name; falls back on unknown; honors `as`; honors `customIcons` from context; passes through `className` + `strokeWidth`.
- `play-node.test.tsx`: icon renders next to name when `data.icon` set; absent otherwise.
- `state-node.test.tsx`: same.
- `html-node.test.tsx`: icon renders next to caption; absent otherwise.
- `detail-panel.test.tsx`: emits `onIconChange` with picked name and with `null` for clear; row hidden when `onIconChange` unset.

## Open questions

None.

## Build order (rough)

1. Studio schema field (single source of truth).
2. Canvas types mirror.
3. `<Icon>` + registry context + tests.
4. Header / caption render integration + tests.
5. `SeeflowCanvas` wires `customIcons` prop into provider.
6. DetailPanel icon row + `onIconChange` plumbing + tests.
7. `apps/web` host wires `onIconChange` to the existing patch endpoint.
8. `/seeflow` skill update.

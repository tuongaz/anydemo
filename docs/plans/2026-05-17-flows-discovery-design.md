# Flows Discovery & Export Enhancements

## Summary

Three related features:
1. Enhanced export dialog (Name, Visibility, View button)
2. New `/flows` discovery page in the viewer
3. "Discover recent flows" section on the home page

---

## 1. Visibility Encoding — File Naming Convention

Visibility is encoded in the zip filename sent to the cloud API — no schema changes to the flow JSON itself.

| User choice | File in zip | Cloud stores as |
|---|---|---|
| Public | `seeflow.json` | `public = true` |
| Anyone with link | `seeflow.private.json` | `public = false` |

- `GET /api/flows` (list) filters to `public = true` only
- `GET /api/flows/:uuid` serves either regardless of visibility

---

## 2. Export Dialog Changes

**Files touched:**
- `apps/web/src/components/export-dialog.tsx`
- `apps/web/src/hooks/use-export-to-cloud.ts`

### New fields

| Field | Type | Storage | API |
|---|---|---|---|
| Name | Required text input | `localStorage` key `seeflow.export.name` | `?name=` query param |
| Visibility | Select: Public / Anyone with link | `localStorage` key `seeflow.export.visibility` | Encoded in zip filename |

### Hook signature change

```ts
exportToCloud(projectId, email, name, visibility: 'public' | 'link')
```

Inside `use-export-to-cloud.ts`:
```ts
const zipKey = visibility === 'public' ? 'seeflow.json' : 'seeflow.private.json';
zipEntries[zipKey] = strToU8(JSON.stringify(demo));
```

### Post-success state

Alongside the existing copy-link field, add a **View** button:
```tsx
<Button onClick={() => window.open(state.shareUrl, '_blank')}>
  View
</Button>
```

---

## 3. `/flows` Discovery Page

**Files to create:**
- `apps/viewer/src/pages/flows.tsx`
- `apps/viewer/src/components/mini-canvas.tsx`
- `apps/viewer/src/components/flow-card.tsx`

**Route added to `apps/viewer/src/app.tsx`:**
```tsx
<Route path="/flows" element={<FlowsPage />} />
```

### API

`GET https://seeflow.dev/api/flows?page=1&limit=12`

```ts
type FlowListItem = {
  uuid: string;
  name: string;
  createdAt: string; // ISO 8601
  demo: Demo;        // full demo payload for mini canvas rendering
};

type FlowsResponse = {
  flows: FlowListItem[];
  total: number;
  page: number;
  totalPages: number;
};
```

### Grid layout

| Breakpoint | Columns |
|---|---|
| Mobile | 1 |
| Tablet (md) | 2 |
| Desktop (lg) | 3 |

12 items per page → 3×4 on desktop.

### Flow card

- Fixed 16:9 aspect ratio container
- Dark background matching viewer theme (`#09090b`)
- **Mini canvas** rendered inside (see below)
- Bottom overlay bar: flow name (left) + relative date (right)
- Full card is clickable → navigates to `/flow/:uuid`

### MiniCanvas component

Wraps React Flow with all interaction disabled:

```tsx
<ReactFlow
  nodes={demo.nodes}
  edges={demo.edges}
  nodeTypes={viewerNodeTypes}
  fitView
  panOnDrag={false}
  zoomOnScroll={false}
  zoomOnPinch={false}
  zoomOnDoubleClick={false}
  nodesDraggable={false}
  nodesConnectable={false}
  elementsSelectable={false}
  proOptions={{ hideAttribution: true }}
/>
```

Container has `pointer-events: none` to block all interaction.

### Pagination

Simple Prev / Next buttons with "Page N of M" label. No page number list.

---

## 4. Home Page "Discover Recent Flows" Section

**File touched:** `apps/viewer/src/pages/home.tsx`

Added just above the footer.

- Heading: *"Discover recent flows"* + *"View all →"* link to `/flows`
- Fetches `GET /api/flows?page=1&limit=6` on mount
- Same `<FlowCard>` component as the `/flows` page
- Grid: 3 columns desktop, 2 tablet, 1 mobile (6 cards = 2 rows on desktop)
- **Loading state:** 6 skeleton placeholder cards matching card dimensions
- **Empty / error state:** section hidden entirely (no error shown on marketing page)

---

## Implementation Order

1. `use-export-to-cloud.ts` — add `name` + `visibility` params, switch zip key
2. `export-dialog.tsx` — add Name field, Visibility dropdown, View button
3. `mini-canvas.tsx` — shared non-interactive React Flow wrapper
4. `flow-card.tsx` — card with mini canvas + name/date overlay
5. `flows.tsx` — `/flows` page with grid, fetch, pagination
6. `app.tsx` (viewer) — add `/flows` route
7. `home.tsx` — add Discover section above footer

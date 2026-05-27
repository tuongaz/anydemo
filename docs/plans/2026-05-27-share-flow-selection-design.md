# Share to seeflow.dev — flow selection

**Status**: Design locked, ready for implementation
**Date**: 2026-05-27
**Repos**: `seeflow` (studio) + `seeflow-viewer` (cloud + SPA)

## Problem

Projects now hold multiple flows. The "Export to seeflow.dev" dialog currently
behaves one of two ways:

- Default (`VITE_SEEFLOW_PROJECT_EXPORT` unset) — exports only the active
  flow via `POST /api/flows`.
- Flagged on — exports *every* flow in the project via `POST /api/projects`,
  with no way to pick a subset.

Users want to share a chosen subset of flows. By default the picker ticks
every flow, so the common case still works in one click.

The flagged-on path has never been exercised end-to-end against prod because
`seeflow-viewer` has no `POST /projects` route, no `GET /projects/*` reads,
and no `/project/:uuid` SPA page. This design ships both halves together.

No backward compatibility is required — no project bundles exist in prod,
no deployed viewer SPA knows about projects.

## Decisions

| Decision | Choice |
|---|---|
| Bundle semantics | Project, filtered. Selected flows only; `defaultFlow` falls back to first selected if the original default is unchecked. |
| Picker UI | Inline checkbox list in the existing dialog, below Visibility. |
| Picker default | All flows checked. |
| Single-flow project | Picker hidden entirely. |
| Feature flag | Keep `IS_PROJECT_EXPORT_ENABLED`; picker only renders when on. |
| Backward compat | None required. |

## Studio side (`seeflow`)

### Files touched

- `apps/web/src/components/export-dialog.tsx` — new Flows section.
- `apps/web/src/hooks/use-export-to-cloud.ts` — new `selectedFlowSlugs` arg.
- `apps/web/src/lib/build-project-bundle.ts` — `defaultFlow` fallback.
- `apps/web/src/lib/build-project-bundle.test.ts` — subset cases.
- `apps/web/src/components/export-dialog.test.tsx` — picker behaviour.
- `apps/studio/e2e/multi-flow.e2e.ts` or new `export-picker.e2e.ts`.

### Dialog state

```ts
const projectFlowsApi = useProjectFlows(
  open && IS_PROJECT_EXPORT_ENABLED ? project : null,
);
const [selected, setSelected] = useState<Set<string>>(new Set());

useEffect(() => {
  if (open && projectFlowsApi.flows) {
    setSelected(new Set(projectFlowsApi.flows.map(f => f.flowSlug)));
  }
}, [open, projectFlowsApi.flows]);
```

No localStorage for the selection — fresh "all checked" each open.

### Render rules for the Flows section

- Flag off → don't render.
- `loading` → header + `Loader2` spinner; Export disabled.
- `error` → inline error row matching existing `export-error` style; Export disabled.
- `flows.length === 1` → don't render; selection auto-set to that slug.
- `flows.length >= 2` → header "Flows" with right-aligned `[Select all]` / `[Clear]`
  toggle (label flips based on `selected.size === flows.length`). Below: a
  scrollable `max-h-48 overflow-y-auto` `<ul>` of checkbox rows. Row content:
  `<input type=checkbox> {icon?} {name} {isDefault && <Star/>}`. Each row gets
  `data-testid="export-flow-checkbox-<slug>"`.

### Export button gating

```ts
canExport = email && name && (!IS_PROJECT_EXPORT_ENABLED || selected.size > 0)
```

Zero selected → button stays disabled, no toast.

### Wiring through to the bundle

```ts
useExportToCloud(project, flow)(email, name, visibility, preview, selectedSlugs)
  → exportProjectToCloud(project, email, name, visibility, preview, selectedSlugs)
    → buildProjectBundle({
        project,
        flows: selectedSlugs.map(s => ({ flowSlug: s })),
      })
```

`exportProjectToCloud` no longer fetches the project flow list — the caller
already has it. Drop that `fetchProjectFlows(project)` call.

### `buildProjectBundle` change

One line in the manifest builder:

```ts
const fallbackDefault = flows.find(f => f.flowSlug === meta.defaultFlow)
  ? meta.defaultFlow
  : flows[0]?.flowSlug;
```

Used as `manifest.defaultFlow`. New test: subset that excludes the default →
manifest's `defaultFlow` is the first selected slug.

## Viewer side (`seeflow-viewer`)

### Cloud — uploader lambda

`cloud/lambda/uploader/index.ts`: add `handlePostProjects` and route
`POST /projects` to it. Logic mirrors `handlePostFlows`:

- 400 if `email` missing, 413 if `body > MAX_TOTAL`, 413 if any entry > `MAX_FILE`.
- `uuid = randomUUID()`.
- Write every zip entry verbatim to `${uuid}/<filePath>` — bundle layout matches
  S3 layout.
- Write `${uuid}/metadata.json` with `{ email, name, visibility, kind: 'project', createdAt }`.
- Return `{ url: "https://seeflow.dev/project/<uuid>" }`.

`kind: 'project'` lets viewer routes disambiguate from single-flow uploads
without probing for `seeflow.json`.

### Cloud — viewer lambda

`cloud/lambda/viewer/index.ts`: add four route handlers.

- `GET /projects/{uuid}` — read `${uuid}/seeflow.json`, return manifest JSON.
  404 if missing.
- `GET /projects/{uuid}/flows/{slug}` — read `${uuid}/flows/<slug>/flow.json`,
  return envelope. 404 if missing.
- `GET /projects/{uuid}/flows/{slug}/files/{proxy+}` — stream asset bytes.
  Mirror existing `/flows/{uuid}/files/{proxy+}` handler (same content-type
  inference).
- `GET /project/{uuid}` — SPA HTML shell. Clone `handleFlowPage`; pull title /
  OG tags from manifest `name`/`description` and preview from `${uuid}/preview.png`.

Visibility: `link` projects are accessible but excluded from any future
listing endpoint; `public` projects are listable. Today's `/flows` listing is
out of scope.

### Cloud — CDK

`cloud/lib`: register the four new route keys against the existing uploader
and viewer lambdas — same pattern as the existing `/flows*` routes. No new
lambdas.

### SPA

`src/app.tsx`: new route `/project/:uuid`.

`src/pages/project-view.tsx`:

```tsx
const { uuid } = useParams();
const flowSlug = useSearchParam('flow');

const manifest   = useQuery(`/api/projects/${uuid}`);
const activeSlug = flowSlug ?? manifest?.defaultFlow;
const envelope   = useQuery(activeSlug ? `/api/projects/${uuid}/flows/${activeSlug}` : null);

<ViewerLayout>
  <FlowSwitcher flows={manifest.flows} active={activeSlug}
                onChange={slug => setSearchParam('flow', slug)} />
  <ViewCanvas
    flow={envelope}
    projectId={uuid}
    fileBaseUrl={`https://seeflow.dev/api/projects/${uuid}/flows/${activeSlug}`} />
</ViewerLayout>
```

- Deep linking via `?flow=<slug>` (matches `/embed/:uuid?theme=` precedent).
- `fileBaseUrl` changes per active flow because bundle nests assets under
  `flows/<slug>/files/<path>`.
- Empty manifest → empty-state card. Single flow → no switcher chrome.

`src/components/flow-switcher.tsx`: small dark-themed dropdown or tab strip.
Reuse studio's visual treatment from `@seeflow/canvas` if exported; otherwise
build a thin viewer-local one.

Embed variant (`/embed/project/:uuid?flow=&theme=`) deferred until needed.
`/flows` listing keeps showing single flows; surfacing projects is a separate
problem.

## Testing

### Studio — unit

- `build-project-bundle.test.ts`: subset includes default → manifest unchanged;
  subset excludes default → defaultFlow fallback; only selected flows' image
  assets fetched.
- `export-dialog.test.tsx`: single-flow → no Flows section; multi-flow → all
  checked; Clear → all unchecked, Export disabled; uncheck one → cloud call
  receives remaining slugs; default-flow star marker; loading and error states.
- `use-export-to-cloud.test.ts`: project mode + subset → POSTs zip whose
  manifest contains only selected flows + correct fallback.

### Studio — e2e

Extend `apps/studio/e2e/multi-flow.e2e.ts` or add
`apps/studio/e2e/export-picker.e2e.ts`:

- 3 flows → dialog shows 3 checked checkboxes.
- Uncheck one + submit (stubbed cloud) → request body's manifest has 2 flows.
- Visual baseline (`chromium-linux`) of the dialog with the Flows section.

### Viewer — unit

- `cloud/lambda/uploader/index.test.ts`: `POST /projects` happy path,
  missing email → 400, oversized file/total → 413, returned url shape.
- `cloud/lambda/viewer/index.test.ts`: `GET /projects/{uuid}` returns manifest;
  `GET /projects/{uuid}/flows/{slug}` returns envelope; file route streams
  bytes; 404 on missing uuid/slug.

### Viewer — manual smoke

(No SPA test suite per `seeflow-viewer/CLAUDE.md`.)

- Load `/project/<uuid>` → switcher lists all bundled flows.
- Switch flow → canvas updates, `?flow=` URL updates.
- Deep link `?flow=<slug>` → lands on that flow.
- Image nodes load from `/api/projects/.../files/...`.

## Rollout

1. Land viewer cloud + SPA changes; deploy. The new routes exist but are
   unreachable from prod studio (flag still off).
2. Land studio dialog + bundle changes behind the existing
   `VITE_SEEFLOW_PROJECT_EXPORT` flag.
3. Flip the flag; ship.

Single-flow export (`POST /api/flows`) keeps working throughout — no users
are affected by step 1 or 2.

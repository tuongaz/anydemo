# Cloud Share Feature Design

**Date:** 2026-05-16  
**Scope:** Export local SeeFlow diagrams to seeflow.dev and share via link

---

## Overview

Users can export a diagram from the local studio to seeflow.dev and get a shareable URL. Anyone with the link can view the diagram read-only. No auth, no editing, no playback on the viewer.

---

## Architecture

```
Local Studio                seeflow.dev
─────────────               ─────────────────────────────────
ShareMenu
  └─ ExportDialog  ──POST──▶  CloudFront → API Gateway
       email +                  └─ Lambda: POST /flows
       zip (seeflow.json              └─ S3 (diagrams bucket)
            + bundled files)               {uuid}/seeflow.json
                                           {uuid}/metadata.json
                    ◀── url ──             {uuid}/files/{path}

Anyone with link   ──GET──▶  CloudFront → S3 (static bucket)
  /flow/{uuid}                 viewer SPA fetches:
                               GET /flows/{uuid}          → seeflow.json
                               GET /flows/{uuid}/files/*  → bundled assets
```

**Infrastructure:**
- S3 bucket (diagrams) — private, Lambda read/write
- S3 bucket (static viewer SPA) — CloudFront origin
- Lambda — handles all API routes
- API Gateway HTTP API — routes to Lambda
- CloudFront — `/api/*` → API Gateway, `/*` → static bucket
- ACM certificate — `seeflow.dev` in `us-east-1`
- Route53 A record — `seeflow.dev` → CloudFront

---

## Upload API

### `POST /flows?email=user@example.com`

**Request:**
```
Content-Type: application/zip
Body: <zip bytes>
```

**Zip contents:**
```
seeflow.json
files/
  path/to/image.png     ← imageNode .data.path
  path/to/page.html     ← htmlNode .data.htmlPath
```

**Lambda:**
1. Validate zip size (≤50MB total, ≤10MB per file)
2. Generate `crypto.randomUUID()`
3. Unzip in memory
4. Write each entry to `flows/{uuid}/` in the diagrams S3 bucket
5. Write `flows/{uuid}/metadata.json` → `{ "email": "...", "createdAt": "<ISO>" }`
6. Return `{ "url": "https://seeflow.dev/flow/{uuid}" }`

### `GET /flows/{uuid}`

Returns `{uuid}/seeflow.json` from S3.

### `GET /flows/{uuid}/files/{path+}`

Streams `{uuid}/files/{path}` from S3 with inferred `Content-Type`.

---

## S3 Layout

```
diagrams-bucket/
  {uuid}/
    seeflow.json
    metadata.json        ← { email, createdAt }
    files/
      {relative-path}   ← mirrors original .seeflow/ paths
```

---

## CDK Infrastructure (`apps/cloud/`)

```
apps/cloud/
  bin/
    app.ts
  lib/
    seeflow-stack.ts
  lambda/
    api/
      index.ts           ← all routes in one handler
  package.json
  cdk.json
```

Single `SeeflowStack` defines all resources. Viewer SPA build output deployed to the static bucket via `BucketDeployment` construct as part of `cdk deploy`.

---

## Local UI Changes (`apps/web/`)

### `ShareMenu` — new prop

```tsx
onExportToCloud?: () => Promise<unknown> | unknown;
```

Adds "Export to seeflow.dev" as a third dropdown item. When present and clicked, opens `ExportDialog`.

### `ExportDialog` (new component)

States: `idle` → `loading` → `done` | `error`

- **idle:** email input (pre-filled from `localStorage` key `seeflow.export.email`) + Export button
- **loading:** spinner with "Uploading…"
- **done:** share URL with copy button + Done button
- **error:** message + Try again

On successful export: saves email to `localStorage`.

### `useExportToCloud(projectId)` hook (new)

1. Read `seeflow.json` from local studio API
2. Collect `imageNode .data.path` and `htmlNode .data.htmlPath` values
3. Fetch each file from `GET /api/projects/:id/files/:path`
4. Zip in memory using `fflate`
5. `POST https://api.seeflow.dev/flows?email=...` with zip as body
6. Return share URL

---

## Viewer (`apps/viewer/`)

Minimal Vite + React app deployed to the static S3 bucket.

```
apps/viewer/
  src/
    main.tsx
    pages/
      flow-view.tsx      ← fetches seeflow.json by uuid, renders canvas
    components/
      view-canvas.tsx    ← React Flow, read-only (panOnDrag only)
```

**Read-only constraints:**
- No node drag, no selection, no resize
- No toolbar, no sidebar, no play/restart buttons
- `imageNode` file URLs rewritten to `https://api.seeflow.dev/flows/{uuid}/files/{path}`
- `htmlNode` content fetched from same base URL

---

## Implementation Order

1. `apps/cloud/` — CDK stack + Lambda API (infrastructure first, testable independently)
2. `apps/viewer/` — viewer SPA (can be developed against the deployed API)
3. `apps/web/` — `ExportDialog`, `useExportToCloud` hook, `ShareMenu` prop

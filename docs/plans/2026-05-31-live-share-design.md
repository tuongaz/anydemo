# Live Share — realtime co-edit with host-side source data

**Status:** Design locked, ready for review
**Date:** 2026-05-31
**Repos:** `seeflow` (studio, thin client) + `seeflow-viewer` (relay lambdas, peer SPA)

## Summary

A one-click way for a host to share a live editing session of their entire
project. Anyone with the generated URL (`https://share.seeflow.dev/<token>`)
joins as a full editor — cursors, presence, optimistic edits, live runtime
events. The host's `flow.json` files and all node-attached assets stay on the
host's disk; the only place they are read or written is the host machine. A
SeeFlow-operated relay forwards messages between host and peers but never
persists or inspects payload bytes.

This is distinct from the existing "Share to seeflow.dev" feature, which
publishes a point-in-time snapshot to the public read-only viewer.

| | Share to seeflow.dev (existing) | Live Share (this design) |
|---|---|---|
| Mode | Read-only public viewer | Multi-editor live session |
| Storage | Snapshot uploaded to S3 | Host disk only; relay is stateless |
| Lifetime | Persistent until deleted | Ephemeral; ends with host disconnect + 30 s grace |
| URL | `seeflow.dev/flow/<uuid>` | `share.seeflow.dev/<token>` |

## Non-goals

- Persistent multiplayer rooms that survive host going offline.
- OAuth / per-user identity. Anyone-with-link semantics by design.
- CRDT-based merging. Host is the sole serializer.
- Mobile-first peer SPA. Same desktop-first layout as the existing viewer.
- End-to-end encryption of payload bytes (deferred — see *Future options*).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Collab scope | Full co-edit | Pair-debugging requires it. |
| Transport | SeeFlow-hosted relay via outbound WS from host | One-click UX; no tunnel binaries; NAT-friendly. |
| Write authority | Host-as-authority RPC | Reuses existing `operations.ts`; Zod stays on host. |
| Conflict model | Last-arriving patch wins; optimistic peer apply + revert on reject | Simpler than CRDT; rare in practice with single serializer. |
| Trust model | Open link, anyone-with-URL | Lowest friction. Mitigated by kick + rotate-URL + end-session. |
| Runtime scope | Live read + trigger | Real pair-debugging. Mitigated by attribution + rate-limit. |
| Share unit | Whole project (all flows) | Peers can switch flows via `FlowSwitcher`. |
| File transfer | Layered: WS chunks ≤256 KB; ephemeral S3 with auto-delete >256 KB | Bytes never persist outside host; large files still fast. |
| Session id in URL | Token (32-byte URL-safe random) | The URL *is* the secret. |
| Host auth | `hostKey` sent in first WS frame, never in URL | Keeps it out of CloudFront / CloudWatch logs. |
| Idle TTL | 30 minutes | DDB TTL handles cleanup automatically. |

## Architecture

Three actors, three repos:

```
┌──────────────────┐        ┌──────────────────────┐        ┌──────────────────┐
│  Host studio     │        │     Relay (AWS)      │        │  Peer browsers   │
│  apps/studio     │◀──WSS─▶│  API GW WebSocket    │◀──WSS─▶│  /share/:token   │
│  share.ts        │        │  + DDB ShareSessions │        │  share-client.ts │
│  operations.ts   │        │  + S3 ephemeral      │        │  <SeeflowCanvas  │
│  events.ts (SSE) │        │  + HTTP /files proxy │        │     mode="edit"> │
│  on user disk    │        │  no payload at rest  │        │  optimistic apply │
└──────────────────┘        └──────────────────────┘        └──────────────────┘
```

Critical property: the relay never sees flow content at rest. It routes
opaque envelopes and proxies file bytes through to the host (or via
auto-deleted S3 staging for large payloads).

## Relay (`seeflow-viewer/cloud`)

New files added to the existing CDK stack `cloud/lib/seeflow-stack.ts`:

```
cloud/lambda/share/
├── session-create.ts   POST /api/share/sessions     -> { sessionId, token, hostKey, wsUrl }
├── session-join.ts     POST /api/share/join         -> { sessionId, wsUrl, peerJwt, flowList, hostOnline }
├── ws-connect.ts       WebSocket $connect (host or peer; auth in first frame)
├── ws-disconnect.ts    WebSocket $disconnect
├── ws-default.ts       WebSocket $default — message router
├── files-proxy.ts      GET /api/share/<sessionId>/files/* — file-read proxy
└── shared/             DDB client, zod envelope schemas, JWT helpers
```

### `ShareSessions` DDB table

```ts
{
  sessionId: string,            // PK (8-char short id)
  token: string,                // GSI; 32-byte url-safe random
  hostKey: string,              // 32-byte secret; not exposed to peers
  hostConnId: string | null,    // current host WebSocket connection id
  peers: Record<connId, {
    peerId: string,
    displayName: string,
    joinedAt: number,
    role: 'editor'
  }>,
  createdAt: number,
  lastActivity: number,
  ttl: number                   // DDB TTL — 30 min from lastActivity
}
```

### Message envelope (all WS frames, both directions)

```ts
{
  v: 1,
  type: 'rpc' | 'rpc-result' | 'sse' | 'presence' | 'file-request'
      | 'file-bytes' | 'file-redirect' | 'file-upload-intent'
      | 'file-upload-done' | 'node-patched' | 'files-manifest' | 'kick',
  id?: string,           // request id for rpc/rpc-result correlation
  from: connId,
  to?: connId | 'host' | 'all',
  payload: unknown       // opaque to relay
}
```

`ws-default` is a dumb router. Peer → `to:'host'` is rewritten to
`hostConnId`. Host → `to:'all'` fans out to every entry in `peers`. Lambda
logs only `{ type, from, to, sizeBytes }` — never `payload`.

### File transfer

**Reads** — `GET /api/share/<sessionId>/files/<path>` hits `files-proxy.ts`:

1. Lookup `sessionId → hostConnId`. Send `file-request { reqId, path }` over WS to host. Await reply (timeout 25 s — under API GW's 29 s cap).
2. Host responds either:
   - `file-bytes { reqId, base64, contentType, etag }` → Lambda returns `200` with bytes + `Cache-Control: private, must-revalidate` + `ETag`.
   - `file-redirect { reqId, getUrl }` → Lambda returns `302 → getUrl` (ephemeral S3 with TTL + delete-on-first-GET hook).

**Writes** — peer drops a file onto a node:

1. Peer SPA sends `file-upload-intent { filename, size, contentType, nodeId }` over WS.
2. Host validates size + content-type, resolves safe path under `<projectPath>/nodes/<nodeId>/`, replies `{ via: 'ws' | 's3', key?, uploadUrl? }`.
3. **WS path** (≤256 KB): peer sends `file-bytes` chunks; host writes via `atomic-write.ts`.
4. **S3 path** (>256 KB): peer PUTs to pre-signed URL; sends `file-upload-done { key }`; host pulls, writes, calls `DeleteObject`.
5. Host broadcasts `node-patched { flowId, nodeId, diff }` to all peers.

**Manifest on join** — host sends `files-manifest { entries: [{path, size, etag}, ...] }` once per peer to prime cache keys and placeholder sizing. No eager bulk fetch.

### Auth handshake

1. `POST /api/share/sessions` → `{ sessionId, token, hostKey, wsUrl }`. Host stores `hostKey` only in memory.
2. Host opens `wss://...?sessionId=<id>`. After `$connect`, host sends `{ type: 'auth-host', hostKey }` as the first frame. Relay validates against DDB, writes `hostConnId`. Wrong key → `1008` close.
3. Peer opens `share.seeflow.dev/<token>`. SPA `POST /api/share/join { token, displayName }` → relay validates token, mints 5-minute JWT bound to `sessionId + peerId + role:'editor'`, returns `{ wsUrl, peerJwt, flowList, hostOnline }`.
4. Peer opens `wss://...?sessionId=<id>` → first frame `{ type: 'auth-peer', peerJwt }`. JWT expired → relay sends `auth-refresh-required`; SPA re-calls `/join` with token; reconnect.

## Host studio (`seeflow/apps/studio`, `seeflow/apps/web`)

### New module `apps/studio/src/share.ts`

Owns all live-share state. Public API consumed by `api.ts`:

```ts
export interface ShareController {
  start(): Promise<{ url: string, sessionId: string }>;
  stop(): Promise<void>;
  kick(peerId: string): Promise<void>;
  rotateUrl(): Promise<{ url: string }>;
  state(): ShareState;            // emits over local SSE
}
```

Responsibilities:

- Outbound WebSocket client (Bun's `WebSocket`) with exponential-backoff reconnect using the same `hostKey`.
- Incoming router (all payloads Zod-validated first):
  - `rpc` → allowlist `{ addNode, patchNode, patchConnector, moveNode, reorderNode, addConnector, deleteNode, deleteConnector, addBulk }` mapping to existing `operations.ts`. Anything else → drop + log.
  - `file-request` → resolve path under `<projectPath>/nodes/`, reject traversal, reply per Section above.
  - `file-upload-intent` / `file-upload-done` → write via `atomic-write.ts`, broadcast.
  - `presence` → update presence store, forward to local SSE (toolbar UI).
- SSE bridge: subscribe to local `events.ts` SSE, wrap each event as `{ type: 'sse', to: 'all', payload }`, forward.
- Rate limit per peer: token bucket, 30 ops/sec, 5 MB/min file bytes.
- Audit log: append accepted ops to `~/.seeflow/share-history/<sessionId>.jsonl` (`{ peerId, displayName, op, ts, accept/reject, reason }`).

### New endpoints in `apps/studio/src/api.ts`

All local-only (`cors.ts` already restricts to localhost):

| Route | Purpose |
|---|---|
| `POST /api/share/start` | Triggers `ShareController.start` |
| `POST /api/share/stop` | `stop()` |
| `POST /api/share/kick` | `kick(peerId)` |
| `POST /api/share/rotate` | `rotateUrl()` |
| `GET /api/share/state` (SSE) | Streams presence + status for the toolbar UI |

### UI additions in `apps/web`

- **Live Share** menu item added next to the existing **Share to seeflow.dev** item in the header Share menu (preserves the work from `2026-05-30-share-button-to-header-design.md`).
- New **LiveShareDialog** (`apps/web/src/components/live-share-dialog.tsx`):
  - Pre-start: explanatory copy + emerald "Start sharing" CTA.
  - Active: copyable URL, live peer list with kick, "Rotate URL", "End session". Per `design/design.html` tokens.
- Canvas overlay component `apps/web/src/components/peer-presence-layer.tsx`:
  - Renders remote cursors with display name + seeded color.
  - Flashes attribution badges ("Alice moved Node X") on each accepted remote op.

## Peer SPA (`seeflow-viewer/src`)

### New route in `src/app.tsx`

`/share/:token` → `src/pages/share-session.tsx`.

### `src/pages/share-session.tsx`

1. Display-name modal on first load (emerald CTA, JetBrains Mono label, deterministic color seeded from name).
2. `POST /api/share/join` → connect WS → on success render canvas.
3. Reuses `ViewerHeader` chrome (dark per design system) with a `FlowSwitcher` driven by `flowList` from the join response.
4. Failure pages:
   - Host offline → "Host stopped sharing" with retry.
   - Kicked → "You were removed from this session".
   - Token revoked → "This share link is no longer active".

### New module `src/lib/share-client.ts`

Typed WebSocket client implementing the same I/O surface `<SeeflowCanvas>` already consumes from the studio's REST API. Wraps mutation callbacks into `rpc` frames with `reqId`; resolves on matching `rpc-result`. Throttled cursor + viewport into `presence` frames at ~30 fps. Dispatches incoming `sse`, `node-patched`, `presence`, `files-manifest` to the canvas / presence store.

### Canvas mount

```tsx
<SeeflowCanvas
  mode="edit"
  flow={currentFlow}
  projectId={sessionId}
  fileBaseUrl={`/api/share/${sessionId}/files`}
  ioAdapter={shareClient}
  presenceLayer={<PeerCursorsLayer peers={peers} />}
  onChange={shareClient.dispatch}
/>
```

The canvas component does not change. We inject an `ioAdapter` and a
`presenceLayer` slot — both will need to be added to the public API in
`@seeflow/canvas` (see *Canvas package changes* below).

### Optimistic edits

Peer applies edits locally, awaits host rebroadcast. On `rpc-result { ok: false, reason }`, revert to last-known-good state + show `"Edit reverted: <reason>"` toast.

## Canvas package changes (`packages/canvas`)

Minimal, additive — preserves public API for embedders.

- `SeeflowCanvasProps` gains `ioAdapter?: IoAdapter` and `presenceLayer?: ReactNode`.
- New interface `IoAdapter` mirrors the REST methods the canvas currently calls directly. When `undefined`, default fetch-based adapter is used (current behaviour). When provided, all mutations and reads route through it.
- This unblocks future embedders that want non-HTTP I/O (e.g., MCP App host).

## Security model

| Layer | Protection |
|---|---|
| Transport | TLS for all hops (HTTPS, WSS). |
| URL | Token = 32-byte URL-safe random. The URL is the secret. |
| Host auth | `hostKey` sent in first WS frame (not in URL). Wrong key → close with code 1008. |
| Peer auth | 5-minute JWT bound to `sessionId + peerId`. Auto-refresh from token. |
| RPC | Allowlist of `operations.ts` ops. No shell, no FS outside `<projectPath>/nodes/`. |
| Schema | Zod re-validation of every payload against `apps/studio/src/schema.ts`. |
| Path | All file paths resolved + asserted to start with `<projectPath>/nodes/`. |
| Rate | 30 ops/sec, 5 MB/min uploads per peer. |
| Caps | Max 20 peers / session, 1 GB ephemeral S3 / session. |
| Audit | Per-op JSONL log at `~/.seeflow/share-history/<sessionId>.jsonl`. |
| Kill | Kick peer, end session, rotate URL. |
| Relay log discipline | Lambdas log only `{ type, from, to, sizeBytes }`. Never `payload`. |
| Auto-cleanup | DDB TTL 30 min idle. S3 object TTL 60 s + delete-on-first-GET hook. |

## End-to-end walkthrough — Alice drags node X

| T+ms | Where | What |
|---|---|---|
| 0 | Alice browser | Drag end. Canvas `onChange` → shareClient applies optimistically, sends `{ v:1, type:'rpc', id:'r7f3', payload:{ op:'moveNode', flowId, nodeId, position } }` |
| 5 | Relay `$default` | Lookup `sessionId → hostConnId`. Rewrite `to: hostConnId`. `PostToConnection` to host. No payload logged. |
| 30 | Host `share.ts` | Allowlist → Zod → rate-limit → `operations.moveNode` → `atomic-write` `flow.json`. |
| 35 | Host | Append audit log. Fire local "Alice moved Node X" toast in studio UI. |
| 40 | Host → relay | Broadcast `node-patched { flowId, nodeId, diff, version: 42 }` with `to:'all'`. Send `rpc-result { id:'r7f3', ok:true }` to Alice. |
| 50 | Relay | Parallel `PostToConnection` to every peer. |
| 80 | All peers | Canvases converge. Alice's optimistic apply matches → no flicker. |

Failure paths:

- **Zod reject** → `rpc-result { ok: false, reason }`. Alice's SPA reverts + toast. No broadcast.
- **Concurrent overlap** → Bun's single-threaded loop serializes; second patch lands on top; both peers see both broadcasts in order; convergent.
- **Host disconnects mid-op** → 5 s timeout on Alice's pending `rpc-result`; revert + "Disconnected from host" toast. On reconnect, host sends a full-state snapshot.
- **Peer disconnects mid-op** → if RPC reached host: applies + broadcasts; on rejoin peer gets current state.

## Future options

- **E2E payload encryption** — derive a session key from the token (HKDF over a high-entropy fragment); relay sees only ciphertext. Defers operational debugging on the relay side. Not in v1.
- **WebRTC data channels for file bytes** — peer ↔ host direct via signaling on the relay + TURN fallback. Relay never sees file bytes even in flight. Adds substantial complexity; v2.
- **Persistent rooms** — survive host offline using a thin server-side CRDT cache. Conflicts with the "source on host" invariant; would need a separate explicit opt-in.
- **Role granularity** — viewer / commenter / editor split. Today every peer is `editor`.

## Open questions

- Should `LiveShareDialog` and `ExportDialog` (Share-to-seeflow.dev) be merged into a single Share panel with two tabs, or stay separate menu items? Lean separate — they target different mental models.
- Do we surface remote cursors on the studio host's canvas too, or only on peer SPAs? Lean yes on host too — symmetry and host needs to know who's editing what.
- Where does the audit log live in the studio UI? Lean: a collapsible drawer in `LiveShareDialog` while active; the JSONL file is the persistent record.

## Implementation phasing

Suggested order (each phase ships independently):

1. **Relay + DDB + auth handshake** — no client integration; tested with a CLI client.
2. **Host `share.ts` + local API** — `share start/stop` works end-to-end with a stubbed peer.
3. **Peer SPA route + `share-client.ts`** — one peer connects, sees the flow read-only.
4. **Canvas `ioAdapter` + edit RPC** — first co-edit working; no presence, no files.
5. **Presence + remote cursors + attribution toasts.**
6. **File transfer** (reads, then writes).
7. **SSE bridge** for live runtime events.
8. **Kick, rotate URL, audit log UI, kill-switches.**
9. **Hardening:** rate limits, caps, abuse tests, leak rehearsal.

## Hardening (Phase 9)

Final posture after Phase 9 shipped. All limits live in [`cloud/lambda/share/shared/limits.ts`](https://github.com/tuongaz/seeflow-viewer/blob/main/cloud/lambda/share/shared/limits.ts) (single source of truth, imported by the relay handlers, host upload guard, and abuse-test suite).

### Enforced caps

| Cap | Value | Where enforced | Rejection |
|---|---|---|---|
| `MAX_PEERS_PER_SESSION` | 20 | `ws-default.handleAuthPeer` after `verifyPeerToken` | `429 peer-cap-reached` + courtesy `kick` frame |
| `MAX_FRAME_BYTES` | 256 KB | Top of `ws-default` handler before JSON.parse | `413 frame-too-large` |
| `MAX_UPLOAD_BYTES` | 10 MB | `ws-default.handleFileUploadIntent` (per-intent) | `413 upload-too-large` |
| `MAX_SESSION_UPLOAD_TOTAL_BYTES` | 1 GB | DDB conditional UpdateExpression on `uploadBytesUsed` | `413 session-upload-cap-reached` |
| `FRAMES_PER_SEC_PER_CONN` | 30 (1800/min/conn) | `recordFrame` token bucket on session row | `429 rate-limited:rate` + courtesy `kick` |
| `MAX_BYTES_PER_MIN_PER_SESSION` | 10 MB/min | `recordFrame` summed across conns | `429 rate-limited:bytes` |
| `MAX_DISPLAY_NAME_CHARS` | 40 | Host SPA + Zod on `auth-peer` payload | 400 from peer SPA before send |
| JWT replay window | 256 nonces / session | `seenJwtNonces` map on session row, pruned on touch | `401 replay-detected` |
| HTTP throttling — `POST /share/sessions` | burst 5 / rate 1 rps | API Gateway stage RouteSettings | 429 from API Gateway |
| HTTP throttling — `POST /share/join` | burst 20 / rate 5 rps | API Gateway stage RouteSettings | 429 from API Gateway |

Peer impersonation is rejected by `routeFrame`: it overwrites `env.from = connId` after `findConnRole`, forbids peer-originated `kick` / `files-manifest` / `rpc-result` (403 `host-only-type`), rewrites peer `to:'all'` to `to:'host'` (only the host can broadcast), and returns `404 unknown-target` for unknown specific connIds.

### CloudWatch alarms

Three EMF-style structured log lines feed three MetricFilters in namespace `Seeflow/Share`, and three alarms fire on bursty thresholds (`GREATER_THAN_OR_EQUAL_TO_THRESHOLD`, `TreatMissingData.NOT_BREACHING`):

| Alarm | Metric | Threshold | What it means |
|---|---|---|---|
| `AuthFailureBurst` | `share.auth_failure` | ≥ 20 / 5 min | Bots replaying or brute-forcing peer JWTs. |
| `RateLimitedBurst` | `share.rate_limited` | ≥ 50 / 5 min | A conn (or several) is being throttled — typically only legitimate during a host deploy. |
| `PeerCapHit` | `share.peer_cap_reached` | ≥ 5 / 5 min | A leaked URL is fan-out joining beyond the 20-peer cap. |

CDK definitions live in `cloud/lib/seeflow-stack.ts`; assertion coverage is `cloud/lib/seeflow-stack.share.test.ts`.

### Abuse-test suite

`cloud/lambda/share/abuse.test.ts` drives the real handlers against a fake DDB + fake `ApiGatewayManagementApiClient` and exercises eight regression scenarios end-to-end: flood, oversized frame, replay, impersonation, JWT storm, oversized upload intent, peer-cap, and idempotent `addPeer`. Run via `bun run test:abuse` (or as part of `bun test`).

### Leak rehearsal

See [2026-05-31-live-share-leak-rehearsal.md](./2026-05-31-live-share-leak-rehearsal.md) for the operator-facing runbook: detection signals (alarms + audit log + in-UI peer list), host containment (kick / rotate / kill-switch), operator containment (DDB row delete + JWT secret rotation), and the quarterly rehearsal procedure. Findings from each rehearsal append to the bottom of that doc.

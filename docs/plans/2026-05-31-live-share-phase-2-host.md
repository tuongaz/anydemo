# Live Share — Phase 2: Host Studio (`apps/studio`) + UI (`apps/web`)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the host studio to the Phase 1 relay. A single click in the studio header opens a `LiveShareDialog` showing a copyable `https://share.seeflow.dev/<token>` URL. The studio holds an authenticated outbound WebSocket to the relay, surfaces presence (peer list with kick) over a local SSE stream, and can rotate-URL / end-session. No real RPC dispatch yet — that lands in Phase 4.

**Architecture:** New module `apps/studio/src/share-controller.ts` owns the relay WebSocket and a `ShareController` state machine (`idle → starting → active → stopping → idle`). Five local HTTP endpoints under `/api/share/*` drive it from the UI. The web UI gets one new dialog (`LiveShareDialog`), one hook (`useLiveShare`), one header badge, and a 4th callback on the existing `HeaderShareCallbacks`. The canvas package gets a small additive prop on `ShareMenu` (`onStartLiveShare?`) so embedders are unaffected.

**Tech stack:** Bun's native `WebSocket` (server-side, in studio), Hono routes, Zod (already in `apps/studio`), React + Vitest + RTL (`apps/web`), `@seeflow/canvas` for the menu component.

**Repo:** `/Users/tuongaz/dev/seeflow` — touches `apps/studio`, `apps/web`, and `packages/canvas`. Phase 1 must be deployed to the dev relay first (we need a live `SHARE_HTTP_URL` and `SHARE_WS_URL` to integration-test against).

**Reference:**
- Design doc: [`docs/plans/2026-05-31-live-share-design.md`](./2026-05-31-live-share-design.md) — Section 3 "Host studio changes".
- Phase 1 plan: [`docs/plans/2026-05-31-live-share-phase-1-relay.md`](./2026-05-31-live-share-phase-1-relay.md) — contracts the studio consumes.
- Prior UI plan: [`docs/plans/2026-05-30-share-button-to-header-design.md`](./2026-05-30-share-button-to-header-design.md) — where the existing `ShareMenu` lives in the studio Header.

**Scope discipline — explicitly NOT in this phase:**
- Real `rpc` dispatch into `operations.ts` (Phase 4).
- Peer SPA route in `seeflow-viewer` (Phase 3).
- File transfer (Phase 6).
- SSE runtime bridge (Phase 7).
- E2E payload encryption (deferred).

We still need to receive and gracefully drop unexpected RPC frames so we don't error-loop when an out-of-band peer joins — but dispatch into `operations.ts` happens in Phase 4.

**Decision: where does the public URL pattern live?** Studio constructs `https://share.seeflow.dev/<token>` from a `SHARE_PUBLIC_URL` env var (default `https://share.seeflow.dev`). The relay does not return the URL — keeps Phase 1 contracts unchanged. If we ever change the domain, both ends update the env (single source per environment).

---

## Pre-flight

**Step P1: Worktree.**

```bash
cd /Users/tuongaz/dev/seeflow
git worktree add .claude/worktrees/live-share-phase-2 -b feat/live-share-phase-2
cd .claude/worktrees/live-share-phase-2
```

**Step P2: Confirm baseline.**

```bash
bun install
bun run typecheck
bun test
```

All green → proceed.

**Step P3: Env knobs (document only — used by tasks below).**

| Env var | Purpose | Default |
|---|---|---|
| `SHARE_HTTP_URL` | Relay HTTP origin for session-create | `https://seeflow.dev` |
| `SHARE_PUBLIC_URL` | Public URL prefix for share links | `https://share.seeflow.dev` |
| `SHARE_AUDIT_DIR` | Override for audit log dir (tests inject tmpdir) | `~/.seeflow/share-history` |

---

## Task 1: `share-config.ts` — read + validate env

**Files:**
- Create: `apps/studio/src/share-config.ts`
- Create: `apps/studio/src/share-config.test.ts`

**Step 1: Failing test.**

`apps/studio/src/share-config.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { loadShareConfig } from './share-config';

const ORIG = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIG);
});

describe('loadShareConfig', () => {
  test('defaults when env unset', () => {
    delete process.env.SHARE_HTTP_URL;
    delete process.env.SHARE_PUBLIC_URL;
    const c = loadShareConfig();
    expect(c.httpUrl).toBe('https://seeflow.dev');
    expect(c.publicUrl).toBe('https://share.seeflow.dev');
  });

  test('reads overrides', () => {
    process.env.SHARE_HTTP_URL = 'http://localhost:9001';
    process.env.SHARE_PUBLIC_URL = 'http://localhost:9001/share';
    const c = loadShareConfig();
    expect(c.httpUrl).toBe('http://localhost:9001');
    expect(c.publicUrl).toBe('http://localhost:9001/share');
  });

  test('strips trailing slash from publicUrl', () => {
    process.env.SHARE_PUBLIC_URL = 'https://share.example.com/';
    expect(loadShareConfig().publicUrl).toBe('https://share.example.com');
  });

  test('rejects non-http(s) urls', () => {
    process.env.SHARE_HTTP_URL = 'ftp://nope';
    expect(() => loadShareConfig()).toThrow();
  });
});
```

Run: `bun test apps/studio/src/share-config.test.ts` → fails (module missing).

**Step 2: Implement.**

`apps/studio/src/share-config.ts`:

```ts
export interface ShareConfig {
  httpUrl: string;
  publicUrl: string;
  auditDir: string;
}

function validateHttp(url: string, name: string): string {
  if (!/^https?:\/\//.test(url)) {
    throw new Error(`${name} must be http(s): got ${url}`);
  }
  return url.replace(/\/+$/, '');
}

export function loadShareConfig(): ShareConfig {
  const httpUrl = validateHttp(
    process.env.SHARE_HTTP_URL ?? 'https://seeflow.dev',
    'SHARE_HTTP_URL',
  );
  const publicUrl = validateHttp(
    process.env.SHARE_PUBLIC_URL ?? 'https://share.seeflow.dev',
    'SHARE_PUBLIC_URL',
  );
  const auditDir =
    process.env.SHARE_AUDIT_DIR ?? `${process.env.HOME}/.seeflow/share-history`;
  return { httpUrl, publicUrl, auditDir };
}
```

Run → pass.

**Step 3: Commit.**

```bash
git add apps/studio/src/share-config.ts apps/studio/src/share-config.test.ts
git commit -m "feat(studio): share-config env loader (httpUrl/publicUrl/auditDir)"
```

---

## Task 2: `share-audit.ts` — append-only JSONL log

**Files:**
- Create: `apps/studio/src/share-audit.ts`
- Create: `apps/studio/src/share-audit.test.ts`

**Step 1: Failing test.**

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ShareAudit } from './share-audit';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'share-audit-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ShareAudit', () => {
  test('appends one JSONL line per event', async () => {
    const a = new ShareAudit(dir);
    await a.append('sess-1', { peerId: 'p1', displayName: 'Alice', op: 'moveNode', accept: true });
    await a.append('sess-1', { peerId: 'p2', displayName: 'Bob', op: 'addNode', accept: false, reason: 'invalid' });
    const lines = readFileSync(join(dir, 'sess-1.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.peerId).toBe('p1');
    expect(first.op).toBe('moveNode');
    expect(typeof first.ts).toBe('number');
  });

  test('creates the directory if missing', async () => {
    const sub = join(dir, 'nested');
    const a = new ShareAudit(sub);
    await a.append('s', { peerId: 'p', displayName: 'X', op: 'x', accept: true });
    expect(readFileSync(join(sub, 's.jsonl'), 'utf8')).toContain('"peerId":"p"');
  });
});
```

Run → fails.

**Step 2: Implement.**

`apps/studio/src/share-audit.ts`:

```ts
import { mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AuditEntry {
  peerId: string;
  displayName: string;
  op: string;
  accept: boolean;
  reason?: string;
  ts?: number;
}

export class ShareAudit {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async append(sessionId: string, entry: AuditEntry): Promise<void> {
    const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
    await appendFile(join(this.dir, `${sessionId}.jsonl`), line, 'utf8');
  }
}
```

Run → pass. Commit:

```bash
git add apps/studio/src/share-audit.ts apps/studio/src/share-audit.test.ts
git commit -m "feat(studio): JSONL audit log writer for share sessions"
```

---

## Task 3: `share-relay-client.ts` — outbound WebSocket wrapper

**Files:**
- Create: `apps/studio/src/share-relay-client.ts`
- Create: `apps/studio/src/share-relay-client.test.ts`

A thin wrapper over Bun's `WebSocket` with: typed `send`, awaited `connect()`, message stream, exponential backoff reconnect using the same `hostKey`, and `close()`.

**Step 1: Failing test using a tiny in-process fake server.**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ShareRelayClient } from './share-relay-client';

let server: ReturnType<typeof Bun.serve> | null = null;
let port = 0;
const received: unknown[] = [];

beforeEach(() => {
  received.length = 0;
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response('no');
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ v: 1, type: 'hello', from: 'server', payload: { ok: true } }));
      },
      message(ws, msg) {
        received.push(JSON.parse(msg as string));
        ws.send(JSON.stringify({ v: 1, type: 'echo', from: 'server', payload: msg }));
      },
    },
  });
  port = server.port;
});
afterEach(() => server?.stop(true));

describe('ShareRelayClient', () => {
  test('connects and emits open + messages', async () => {
    const client = new ShareRelayClient(`ws://localhost:${port}`);
    const messages: any[] = [];
    client.onMessage((m) => messages.push(m));
    await client.connect();
    await new Promise((r) => setTimeout(r, 20));
    expect(messages[0]).toMatchObject({ type: 'hello' });
    client.close();
  });

  test('send marshals JSON', async () => {
    const client = new ShareRelayClient(`ws://localhost:${port}`);
    await client.connect();
    client.send({ v: 1, type: 'ping', from: 'host', payload: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(received[0]).toMatchObject({ type: 'ping' });
    client.close();
  });

  test('reconnect fires onReconnect after server drops', async () => {
    const client = new ShareRelayClient(`ws://localhost:${port}`, {
      backoffMs: () => 5,
    });
    let reconnects = 0;
    client.onReconnect(() => reconnects++);
    await client.connect();
    server?.stop(true); // drop
    await new Promise((r) => setTimeout(r, 30));
    // restart on same port
    server = Bun.serve({
      port,
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined;
        return new Response('no');
      },
      websocket: { open() {}, message() {} },
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(reconnects).toBeGreaterThanOrEqual(1);
    client.close();
  });
});
```

Run → fails.

**Step 2: Implement.**

`apps/studio/src/share-relay-client.ts`:

```ts
type MessageHandler = (msg: unknown) => void;
type LifecycleHandler = () => void;

export interface ShareRelayClientOptions {
  /** Returns ms to wait before next reconnect attempt, given attempt number (1-based). */
  backoffMs?: (attempt: number) => number;
  /** Hard cap on reconnect attempts; default infinite. */
  maxAttempts?: number;
}

const defaultBackoff = (attempt: number) =>
  Math.min(30_000, 500 * 2 ** Math.min(attempt - 1, 6));

export class ShareRelayClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private readonly msgHandlers = new Set<MessageHandler>();
  private readonly reconnectHandlers = new Set<LifecycleHandler>();
  private readonly closeHandlers = new Set<LifecycleHandler>();

  constructor(
    private readonly url: string,
    private readonly opts: ShareRelayClientOptions = {},
  ) {}

  async connect(): Promise<void> {
    this.attempt += 1;
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.attempt = 0;
        resolve();
      });
      ws.addEventListener('message', (e) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
        } catch {
          return;
        }
        for (const h of this.msgHandlers) h(parsed);
      });
      ws.addEventListener('close', () => {
        if (this.closed) return;
        for (const h of this.closeHandlers) h();
        this.scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        if (this.attempt === 1) reject(new Error('connect failed'));
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.opts.maxAttempts && this.attempt >= this.opts.maxAttempts) return;
    const backoff = (this.opts.backoffMs ?? defaultBackoff)(this.attempt + 1);
    setTimeout(async () => {
      try {
        await this.connect();
        for (const h of this.reconnectHandlers) h();
      } catch {
        // next close triggers another attempt
      }
    }, backoff);
  }

  send(msg: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  onMessage(h: MessageHandler): () => void {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }

  onReconnect(h: LifecycleHandler): () => void {
    this.reconnectHandlers.add(h);
    return () => this.reconnectHandlers.delete(h);
  }

  onClose(h: LifecycleHandler): () => void {
    this.closeHandlers.add(h);
    return () => this.closeHandlers.delete(h);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
```

Run → pass. Commit:

```bash
git add apps/studio/src/share-relay-client.ts apps/studio/src/share-relay-client.test.ts
git commit -m "feat(studio): outbound WebSocket client with reconnect backoff"
```

---

## Task 4: `share-controller.ts` — state machine + relay orchestration

**Files:**
- Create: `apps/studio/src/share-controller.ts`
- Create: `apps/studio/src/share-controller.test.ts`

The controller owns: session bootstrap (HTTP POST to relay), WS client, presence state, audit log, and a small event emitter the local SSE endpoint subscribes to.

**Step 1: Failing test (mocks `fetch` + `ShareRelayClient`).**

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ShareAudit } from './share-audit';
import type { ShareConfig } from './share-config';
import { ShareController } from './share-controller';

let dir: string;
const ORIG_FETCH = globalThis.fetch;
const sent: unknown[] = [];
const fakeClient = {
  connected: false,
  closed: false,
  messageHandlers: [] as ((m: unknown) => void)[],
  async connect() {
    this.connected = true;
  },
  send(m: unknown) {
    sent.push(m);
  },
  onMessage(h: (m: unknown) => void) {
    this.messageHandlers.push(h);
    return () => {};
  },
  onReconnect() { return () => {}; },
  onClose() { return () => {}; },
  close() { this.closed = true; },
  emit(msg: unknown) { this.messageHandlers.forEach((h) => h(msg)); },
};

const cfg: ShareConfig = {
  httpUrl: 'https://test.example',
  publicUrl: 'https://share.test',
  auditDir: '',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'share-ctrl-'));
  sent.length = 0;
  fakeClient.connected = false;
  fakeClient.closed = false;
  fakeClient.messageHandlers = [];
  (globalThis as any).fetch = mock(async (url: string) => {
    if (url.endsWith('/api/share/sessions')) {
      return new Response(
        JSON.stringify({
          sessionId: 's1',
          token: 'tok-1',
          hostKey: 'hk-1',
          wsUrl: 'wss://test.example/ws',
        }),
        { status: 200 },
      );
    }
    throw new Error('unmocked');
  });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = ORIG_FETCH;
});

function makeController() {
  return new ShareController({
    config: { ...cfg, auditDir: dir },
    relayClientFactory: () => fakeClient as any,
    audit: new ShareAudit(dir),
  });
}

describe('ShareController.start', () => {
  test('creates session, connects, sends auth-host, returns shareUrl', async () => {
    const c = makeController();
    const r = await c.start();
    expect(r.sessionId).toBe('s1');
    expect(r.shareUrl).toBe('https://share.test/tok-1');
    expect(fakeClient.connected).toBe(true);
    expect(sent[0]).toMatchObject({
      type: 'auth-host',
      payload: { hostKey: 'hk-1', sessionId: 's1' },
    });
    expect(c.state().status).toBe('active');
  });

  test('start twice without stop throws', async () => {
    const c = makeController();
    await c.start();
    await expect(c.start()).rejects.toThrow('already active');
  });

  test('stop closes ws + returns to idle', async () => {
    const c = makeController();
    await c.start();
    await c.stop();
    expect(fakeClient.closed).toBe(true);
    expect(c.state().status).toBe('idle');
  });

  test('rotate ends + starts a fresh session', async () => {
    const c = makeController();
    await c.start();
    const r2 = await c.rotate();
    expect(r2.shareUrl).toBe('https://share.test/tok-1'); // mock returns same; real prod = new
    expect(c.state().status).toBe('active');
  });
});

describe('ShareController.peers', () => {
  test('peer-joined / peer-left frames update presence', async () => {
    const c = makeController();
    await c.start();
    fakeClient.emit({
      v: 1,
      type: 'presence',
      from: 'relay',
      payload: { kind: 'join', peerId: 'p1', displayName: 'Alice' },
    });
    expect(c.state().peers).toHaveLength(1);
    expect(c.state().peers[0]).toMatchObject({ peerId: 'p1', displayName: 'Alice' });
    fakeClient.emit({
      v: 1,
      type: 'presence',
      from: 'relay',
      payload: { kind: 'leave', peerId: 'p1' },
    });
    expect(c.state().peers).toHaveLength(0);
  });

  test('kick sends a kick frame and removes locally', async () => {
    const c = makeController();
    await c.start();
    fakeClient.emit({
      v: 1,
      type: 'presence',
      from: 'relay',
      payload: { kind: 'join', peerId: 'p1', displayName: 'Alice' },
    });
    await c.kick('p1');
    expect(sent.at(-1)).toMatchObject({ type: 'kick', payload: { peerId: 'p1' } });
    expect(c.state().peers).toHaveLength(0);
  });
});
```

Run → fails.

**Step 2: Implement.**

`apps/studio/src/share-controller.ts`:

```ts
import { EventEmitter } from 'node:events';
import type { ShareAudit } from './share-audit';
import type { ShareConfig } from './share-config';
import type { ShareRelayClient } from './share-relay-client';

export interface SharePeer {
  peerId: string;
  displayName: string;
  joinedAt: number;
}

export type ShareStatus = 'idle' | 'starting' | 'active' | 'stopping';

export interface ShareState {
  status: ShareStatus;
  sessionId: string | null;
  shareUrl: string | null;
  peers: SharePeer[];
  lastError: string | null;
}

export interface StartResult {
  sessionId: string;
  shareUrl: string;
}

interface ControllerDeps {
  config: ShareConfig;
  relayClientFactory: (wsUrl: string) => ShareRelayClient;
  audit: ShareAudit;
}

export class ShareController {
  private status: ShareStatus = 'idle';
  private sessionId: string | null = null;
  private hostKey: string | null = null;
  private token: string | null = null;
  private client: ShareRelayClient | null = null;
  private peers = new Map<string, SharePeer>();
  private lastError: string | null = null;
  readonly events = new EventEmitter();

  constructor(private readonly deps: ControllerDeps) {}

  state(): ShareState {
    return {
      status: this.status,
      sessionId: this.sessionId,
      shareUrl: this.token ? `${this.deps.config.publicUrl}/${this.token}` : null,
      peers: [...this.peers.values()],
      lastError: this.lastError,
    };
  }

  async start(): Promise<StartResult> {
    if (this.status !== 'idle') throw new Error('share already active');
    this.status = 'starting';
    this.lastError = null;
    this.emit();
    try {
      const r = await fetch(`${this.deps.config.httpUrl}/api/share/sessions`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`create failed: ${r.status}`);
      const body = (await r.json()) as {
        sessionId: string;
        token: string;
        hostKey: string;
        wsUrl: string;
      };
      this.sessionId = body.sessionId;
      this.token = body.token;
      this.hostKey = body.hostKey;
      this.client = this.deps.relayClientFactory(body.wsUrl);
      this.client.onMessage((m) => this.onMessage(m));
      this.client.onReconnect(() => this.reauthHost());
      this.client.onClose(() => {
        if (this.status === 'active') this.emit();
      });
      await this.client.connect();
      this.reauthHost();
      this.status = 'active';
      this.emit();
      return { sessionId: this.sessionId, shareUrl: this.state().shareUrl! };
    } catch (e) {
      this.status = 'idle';
      this.lastError = (e as Error).message;
      this.emit();
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'idle') return;
    this.status = 'stopping';
    this.emit();
    this.client?.close();
    this.client = null;
    this.peers.clear();
    this.sessionId = null;
    this.token = null;
    this.hostKey = null;
    this.status = 'idle';
    this.emit();
  }

  async rotate(): Promise<StartResult> {
    await this.stop();
    return this.start();
  }

  async kick(peerId: string): Promise<void> {
    if (!this.client) return;
    this.client.send({ v: 1, type: 'kick', from: 'host', to: 'all', payload: { peerId } });
    // Optimistic local removal; relay echoes presence:leave to confirm.
    for (const [id, p] of this.peers) {
      if (p.peerId === peerId) this.peers.delete(id);
    }
    this.emit();
  }

  private reauthHost() {
    if (!this.client || !this.hostKey || !this.sessionId) return;
    this.client.send({
      v: 1,
      type: 'auth-host',
      from: 'host',
      payload: { hostKey: this.hostKey, sessionId: this.sessionId },
    });
  }

  private onMessage(raw: unknown) {
    const msg = raw as { type?: string; payload?: any };
    if (msg.type === 'presence') {
      const { kind, peerId, displayName } = msg.payload ?? {};
      if (kind === 'join' && peerId) {
        this.peers.set(peerId, {
          peerId,
          displayName: displayName ?? 'Anonymous',
          joinedAt: Date.now(),
        });
        this.emit();
      } else if (kind === 'leave' && peerId) {
        this.peers.delete(peerId);
        this.emit();
      }
      return;
    }
    if (msg.type === 'rpc') {
      // Phase 4 will dispatch into operations.ts. For now: log + reject so
      // peers see a clean "edit reverted" rather than a silent drop.
      const pid = (msg.payload as any)?.peerId ?? 'unknown';
      this.deps.audit.append(this.sessionId ?? 'unknown', {
        peerId: pid,
        displayName: this.peers.get(pid)?.displayName ?? 'unknown',
        op: (msg.payload as any)?.op ?? 'rpc',
        accept: false,
        reason: 'phase-2-dispatch-not-implemented',
      });
      this.client?.send({
        v: 1,
        type: 'rpc-result',
        from: 'host',
        to: pid,
        payload: { ok: false, reason: 'host editor not ready' },
      });
      return;
    }
    // file-request, file-upload-* etc. all deferred to Phase 6.
  }

  private emit() {
    this.events.emit('state', this.state());
  }
}
```

Run tests → pass. Commit:

```bash
git add apps/studio/src/share-controller.ts apps/studio/src/share-controller.test.ts
git commit -m "feat(studio): ShareController state machine + presence handling"
```

---

## Task 5: Local HTTP API in `apps/studio/src/api.ts`

**Files:**
- Modify: `apps/studio/src/api.ts` — add 5 routes
- Modify: `apps/studio/src/server.ts` (or wherever the singleton is constructed) — inject `ShareController`
- Create: `apps/studio/src/api.share.test.ts`

CORS in `cors.ts` already locks `/api/*` to localhost — we get that for free.

**Step 1: Failing test (uses Hono's test mode against an in-process app).**

```ts
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { ShareController } from './share-controller';
import { mountShareRoutes } from './api'; // export this helper from api.ts

function makeApp(ctrl: ShareController) {
  const app = new Hono();
  mountShareRoutes(app, ctrl);
  return app;
}

class FakeController {
  status = 'idle';
  startCount = 0;
  stopCount = 0;
  async start() { this.startCount++; this.status = 'active'; return { sessionId: 'x', shareUrl: 'https://share.test/x' }; }
  async stop() { this.stopCount++; this.status = 'idle'; }
  async rotate() { return { sessionId: 'y', shareUrl: 'https://share.test/y' }; }
  async kick(_id: string) {}
  state() { return { status: this.status, sessionId: null, shareUrl: null, peers: [], lastError: null }; }
  events = { on: () => {}, off: () => {}, emit: () => {} };
}

describe('share routes', () => {
  test('POST /api/share/start returns shareUrl', async () => {
    const ctrl = new FakeController() as unknown as ShareController;
    const app = makeApp(ctrl);
    const r = await app.request('/api/share/start', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ shareUrl: 'https://share.test/x' });
  });

  test('POST /api/share/stop returns 204', async () => {
    const ctrl = new FakeController() as unknown as ShareController;
    const app = makeApp(ctrl);
    const r = await app.request('/api/share/stop', { method: 'POST' });
    expect(r.status).toBe(204);
  });

  test('POST /api/share/kick requires peerId', async () => {
    const ctrl = new FakeController() as unknown as ShareController;
    const app = makeApp(ctrl);
    const bad = await app.request('/api/share/kick', { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);
  });

  test('GET /api/share/state returns current snapshot', async () => {
    const ctrl = new FakeController() as unknown as ShareController;
    const app = makeApp(ctrl);
    const r = await app.request('/api/share/state');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'idle' });
  });
});
```

Run → fails.

**Step 2: Implement `mountShareRoutes` in `api.ts`.**

Add near the bottom of `apps/studio/src/api.ts`:

```ts
import type { Hono } from 'hono';
import type { ShareController } from './share-controller';

export function mountShareRoutes(app: Hono, ctrl: ShareController) {
  app.post('/api/share/start', async (c) => {
    const r = await ctrl.start();
    return c.json(r);
  });

  app.post('/api/share/stop', async (c) => {
    await ctrl.stop();
    return c.body(null, 204);
  });

  app.post('/api/share/rotate', async (c) => {
    const r = await ctrl.rotate();
    return c.json(r);
  });

  app.post('/api/share/kick', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.peerId !== 'string') {
      return c.json({ error: 'missing-peerId' }, 400);
    }
    await ctrl.kick(body.peerId);
    return c.body(null, 204);
  });

  app.get('/api/share/state', (c) => {
    return c.json(ctrl.state());
  });
}
```

Wire it in `server.ts` (or whoever constructs the Hono app):

```ts
import { loadShareConfig } from './share-config';
import { ShareAudit } from './share-audit';
import { ShareRelayClient } from './share-relay-client';
import { ShareController } from './share-controller';
import { mountShareRoutes } from './api';

const shareConfig = loadShareConfig();
const shareCtrl = new ShareController({
  config: shareConfig,
  audit: new ShareAudit(shareConfig.auditDir),
  relayClientFactory: (wsUrl) => new ShareRelayClient(wsUrl),
});
mountShareRoutes(app, shareCtrl);
```

Run tests → pass. Commit:

```bash
git add apps/studio/src/api.ts apps/studio/src/api.share.test.ts apps/studio/src/server.ts
git commit -m "feat(studio): local /api/share/* endpoints + controller wire-up"
```

---

## Task 6: SSE endpoint for live state

**Files:**
- Modify: `apps/studio/src/api.ts` — extend the `GET /api/share/state` route to upgrade to SSE when `Accept: text/event-stream`
- Modify: `apps/studio/src/api.share.test.ts` — add SSE test

**Step 1: Failing test.**

```ts
test('GET /api/share/state with Accept: text/event-stream pushes updates', async () => {
  const ctrl = new ShareController({
    config: { httpUrl: '', publicUrl: 'https://x', auditDir: '' },
    audit: { append: async () => {} } as any,
    relayClientFactory: () => ({
      connect: async () => {},
      send: () => {},
      onMessage: () => () => {},
      onReconnect: () => () => {},
      onClose: () => () => {},
      close: () => {},
    } as any),
  });

  const app = new Hono();
  mountShareRoutes(app, ctrl);

  const r = await app.request('/api/share/state', {
    headers: { Accept: 'text/event-stream' },
  });
  expect(r.headers.get('content-type')).toContain('text/event-stream');

  const reader = r.body!.getReader();
  ctrl.events.emit('state', { status: 'active', sessionId: 's', shareUrl: 'u', peers: [], lastError: null });
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain('"status":"active"');
});
```

Run → fails.

**Step 2: Extend the state route.**

Replace the GET handler in `mountShareRoutes`:

```ts
app.get('/api/share/state', (c) => {
  if (!c.req.header('accept')?.includes('text/event-stream')) {
    return c.json(ctrl.state());
  }
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const push = (state: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
      push(ctrl.state());
      const handler = (s: unknown) => push(s);
      ctrl.events.on('state', handler);
      c.req.raw.signal.addEventListener('abort', () => {
        ctrl.events.off('state', handler);
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
});
```

Run → pass. Commit:

```bash
git add apps/studio/src/api.ts apps/studio/src/api.share.test.ts
git commit -m "feat(studio): SSE stream of ShareController state"
```

---

## Task 7: Canvas package — optional `onStartLiveShare` on `ShareMenu`

**Files:**
- Modify: `packages/canvas/src/components/share-menu.tsx` (or wherever ShareMenu lives — find with `rg -l 'ShareMenu' packages/canvas/src`)
- Modify: `packages/canvas/src/components/share-menu.test.tsx`

Tiny additive change — when the prop is provided, render an extra "Start Live Share…" item; otherwise unchanged so embedders are unaffected.

**Step 1: Failing test.**

Append to the existing share-menu test file:

```tsx
test('renders Start Live Share when onStartLiveShare is provided', async () => {
  const onStart = vi.fn();
  render(
    <ShareMenu
      onDownloadPdf={() => {}}
      onDownloadPng={() => {}}
      onExportToCloud={() => {}}
      onStartLiveShare={onStart}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /share/i }));
  const item = screen.getByRole('menuitem', { name: /live share/i });
  await userEvent.click(item);
  expect(onStart).toHaveBeenCalledOnce();
});

test('omits Start Live Share when callback absent', async () => {
  render(
    <ShareMenu
      onDownloadPdf={() => {}}
      onDownloadPng={() => {}}
      onExportToCloud={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /share/i }));
  expect(screen.queryByText(/live share/i)).toBeNull();
});
```

Run → fails.

**Step 2: Extend the component.**

```tsx
export interface ShareMenuProps {
  onDownloadPdf: () => void;
  onDownloadPng: () => void;
  onExportToCloud: () => void;
  onStartLiveShare?: () => void;   // NEW
}

// inside the menu items list, after onExportToCloud:
{onStartLiveShare ? (
  <DropdownMenuItem onSelect={onStartLiveShare}>
    Start Live Share…
  </DropdownMenuItem>
) : null}
```

Run → pass. Also rebuild the canvas package so the studio's `predev` picks up the change:

```bash
cd packages/canvas && bun run build && cd ../..
```

Commit:

```bash
git add packages/canvas/src/components/share-menu.tsx packages/canvas/src/components/share-menu.test.tsx packages/canvas/dist
git commit -m "feat(canvas): optional onStartLiveShare on ShareMenu"
```

---

## Task 8: `useLiveShare` hook in `apps/web`

**Files:**
- Create: `apps/web/src/hooks/use-live-share.ts`
- Create: `apps/web/src/hooks/use-live-share.test.tsx`

Subscribes to the studio's SSE stream, exposes start/stop/rotate/kick.

**Step 1: Failing test.**

```tsx
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLiveShare } from './use-live-share';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  close() {}
  emit(state: unknown) {
    this.onmessage?.({ data: JSON.stringify(state) });
  }
}

beforeEach(() => {
  (globalThis as any).EventSource = FakeEventSource;
  (globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
    if (url.endsWith('/api/share/start')) {
      return new Response(JSON.stringify({ sessionId: 's', shareUrl: 'https://share.test/abc' }));
    }
    if (url.endsWith('/api/share/stop')) return new Response(null, { status: 204 });
    if (url.endsWith('/api/share/kick')) return new Response(null, { status: 204 });
    throw new Error(`unmocked ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('useLiveShare', () => {
  test('initial state is idle', () => {
    const { result } = renderHook(() => useLiveShare());
    expect(result.current.state.status).toBe('idle');
  });

  test('start hits /api/share/start and exposes the url', async () => {
    const { result } = renderHook(() => useLiveShare());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state.shareUrl).toBe('https://share.test/abc');
  });

  test('SSE update flows into state', async () => {
    const { result } = renderHook(() => useLiveShare());
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    act(() =>
      FakeEventSource.last!.emit({
        status: 'active',
        peers: [{ peerId: 'p', displayName: 'Alice', joinedAt: 0 }],
        sessionId: 's',
        shareUrl: 'https://share.test/abc',
        lastError: null,
      }),
    );
    await waitFor(() => expect(result.current.state.peers).toHaveLength(1));
  });
});
```

Run → fails.

**Step 2: Implement.**

```ts
import { useCallback, useEffect, useState } from 'react';

export interface SharePeer { peerId: string; displayName: string; joinedAt: number; }
export type ShareStatus = 'idle' | 'starting' | 'active' | 'stopping';
export interface ShareState {
  status: ShareStatus;
  sessionId: string | null;
  shareUrl: string | null;
  peers: SharePeer[];
  lastError: string | null;
}

const INITIAL: ShareState = {
  status: 'idle',
  sessionId: null,
  shareUrl: null,
  peers: [],
  lastError: null,
};

async function call(path: string, body?: unknown): Promise<any> {
  const r = await fetch(path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.status === 204 ? null : r.json();
}

export function useLiveShare() {
  const [state, setState] = useState<ShareState>(INITIAL);

  useEffect(() => {
    const es = new EventSource('/api/share/state');
    es.onmessage = (e) => {
      try { setState(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  return {
    state,
    start: useCallback(async () => {
      const r = await call('/api/share/start');
      setState((s) => ({ ...s, status: 'active', sessionId: r.sessionId, shareUrl: r.shareUrl }));
      return r as { sessionId: string; shareUrl: string };
    }, []),
    stop: useCallback(async () => {
      await call('/api/share/stop');
    }, []),
    rotate: useCallback(async () => {
      const r = await call('/api/share/rotate');
      setState((s) => ({ ...s, sessionId: r.sessionId, shareUrl: r.shareUrl }));
      return r;
    }, []),
    kick: useCallback(async (peerId: string) => {
      await call('/api/share/kick', { peerId });
    }, []),
  };
}
```

Run → pass. Commit:

```bash
git add apps/web/src/hooks/use-live-share.ts apps/web/src/hooks/use-live-share.test.tsx
git commit -m "feat(web): useLiveShare hook with SSE state subscription"
```

---

## Task 9: `LiveShareDialog` component

**Files:**
- Create: `apps/web/src/components/live-share-dialog.tsx`
- Create: `apps/web/src/components/live-share-dialog.test.tsx`

Reuse the project's existing dialog primitives (look in `apps/web/src/components` for the `Dialog` used by `ExportDialog`). Idle state has one "Start sharing" button; active state shows URL + Copy + peer list + Rotate + End.

**Step 1: Failing test.**

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveShareDialog } from './live-share-dialog';

function makeController(overrides: any = {}) {
  return {
    state: { status: 'idle', sessionId: null, shareUrl: null, peers: [], lastError: null, ...overrides },
    start: vi.fn(async () => ({ sessionId: 's', shareUrl: 'https://share.test/abc' })),
    stop: vi.fn(async () => {}),
    rotate: vi.fn(async () => ({ sessionId: 't', shareUrl: 'https://share.test/xyz' })),
    kick: vi.fn(async () => {}),
  };
}

describe('LiveShareDialog', () => {
  test('idle: Start button calls controller.start', async () => {
    const ctrl = makeController();
    render(<LiveShareDialog open onOpenChange={() => {}} controller={ctrl as any} />);
    await userEvent.click(screen.getByRole('button', { name: /start sharing/i }));
    expect(ctrl.start).toHaveBeenCalled();
  });

  test('active: shows URL and Copy button copies to clipboard', async () => {
    const ctrl = makeController({
      status: 'active',
      sessionId: 'abc',
      shareUrl: 'https://share.test/abc',
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    render(<LiveShareDialog open onOpenChange={() => {}} controller={ctrl as any} />);
    expect(screen.getByText('https://share.test/abc')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://share.test/abc');
  });

  test('active: peer list shows Kick button per peer', async () => {
    const ctrl = makeController({
      status: 'active',
      shareUrl: 'u',
      peers: [{ peerId: 'p1', displayName: 'Alice', joinedAt: 0 }],
    });
    render(<LiveShareDialog open onOpenChange={() => {}} controller={ctrl as any} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /kick/i }));
    expect(ctrl.kick).toHaveBeenCalledWith('p1');
  });

  test('active: End session button calls stop', async () => {
    const ctrl = makeController({ status: 'active', shareUrl: 'u' });
    render(<LiveShareDialog open onOpenChange={() => {}} controller={ctrl as any} />);
    await userEvent.click(screen.getByRole('button', { name: /end session/i }));
    expect(ctrl.stop).toHaveBeenCalled();
  });
});
```

Run → fails.

**Step 2: Implement.**

Use the project's existing dialog primitives — copy the import block from `export-dialog.tsx` and reuse the same `<Dialog>`, `<Button>`, design tokens (emerald CTA per `design/design.html`).

```tsx
// apps/web/src/components/live-share-dialog.tsx
import { useLiveShare } from '@/hooks/use-live-share';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'; // adjust to actual paths
import { Button } from '@/components/ui/button';

interface LiveShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: ReturnType<typeof useLiveShare>;
}

export function LiveShareDialog({ open, onOpenChange, controller }: LiveShareDialogProps) {
  const { state, start, stop, rotate, kick } = controller;

  const onCopy = async () => {
    if (state.shareUrl) await navigator.clipboard.writeText(state.shareUrl);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Live Share</DialogTitle>
        </DialogHeader>

        {state.status === 'idle' || state.status === 'starting' ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Anyone with the share link can co-edit this project. The link works only while
              your studio is running.
            </p>
            <Button
              className="bg-emerald-500 hover:bg-emerald-600"
              disabled={state.status === 'starting'}
              onClick={() => start().catch((e) => console.error(e))}
            >
              {state.status === 'starting' ? 'Starting…' : 'Start sharing'}
            </Button>
            {state.lastError ? (
              <p className="text-sm text-red-400">{state.lastError}</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-mono text-zinc-400">Share URL</label>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-zinc-900 px-3 py-2 text-sm">
                  {state.shareUrl}
                </code>
                <Button variant="secondary" onClick={onCopy}>Copy</Button>
              </div>
            </div>

            <div>
              <p className="text-xs font-mono text-zinc-400">
                Connected ({state.peers.length})
              </p>
              <ul className="mt-2 space-y-1">
                {state.peers.length === 0 ? (
                  <li className="text-sm text-zinc-500">Waiting for someone to join…</li>
                ) : null}
                {state.peers.map((p) => (
                  <li key={p.peerId} className="flex items-center justify-between text-sm">
                    <span>{p.displayName}</span>
                    <Button variant="ghost" size="sm" onClick={() => kick(p.peerId)}>
                      Kick
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => rotate()}>Rotate URL</Button>
              <Button variant="destructive" onClick={() => stop()}>End session</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

> **NB:** before writing, run `rg "import.*Dialog" apps/web/src/components/export-dialog.tsx` to get the exact import paths and class conventions used by `ExportDialog` — mirror them so the new dialog inherits the same look/feel.

Run tests → pass. Commit:

```bash
git add apps/web/src/components/live-share-dialog.tsx apps/web/src/components/live-share-dialog.test.tsx
git commit -m "feat(web): LiveShareDialog (idle + active states)"
```

---

## Task 10: Header live status badge

**Files:**
- Create: `apps/web/src/components/header-live-share-badge.tsx`
- Create: `apps/web/src/components/header-live-share-badge.test.tsx`

Small emerald dot + peer count, shown next to the existing ShareMenu when `status === 'active'`. Clicking it re-opens `LiveShareDialog`.

**Step 1: Failing test.**

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderLiveShareBadge } from './header-live-share-badge';

describe('HeaderLiveShareBadge', () => {
  test('hidden when idle', () => {
    render(<HeaderLiveShareBadge status="idle" peerCount={0} onClick={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('shows count when active', () => {
    render(<HeaderLiveShareBadge status="active" peerCount={3} onClick={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('click invokes callback', async () => {
    const onClick = vi.fn();
    render(<HeaderLiveShareBadge status="active" peerCount={1} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

Run → fails.

**Step 2: Implement.**

```tsx
import type { ShareStatus } from '@/hooks/use-live-share';

interface Props {
  status: ShareStatus;
  peerCount: number;
  onClick: () => void;
}

export function HeaderLiveShareBadge({ status, peerCount, onClick }: Props) {
  if (status !== 'active') return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Live Share active — click to manage"
      className="flex items-center gap-1.5 rounded-pill bg-emerald-500/10 px-2 py-1 text-xs font-mono text-emerald-400 hover:bg-emerald-500/20"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
      {peerCount}
    </button>
  );
}
```

Run → pass. Commit:

```bash
git add apps/web/src/components/header-live-share-badge.tsx apps/web/src/components/header-live-share-badge.test.tsx
git commit -m "feat(web): HeaderLiveShareBadge (emerald dot + peer count)"
```

---

## Task 11: Extend `HeaderShareCallbacks` and wire badge

**Files:**
- Modify: `apps/web/src/components/header.tsx`
- Modify: `apps/web/src/components/header.test.tsx`

**Step 1: Update interface.**

```ts
export interface HeaderShareCallbacks {
  onDownloadPdf: () => void;
  onDownloadPng: () => void;
  onExportToCloud: () => void;
  onStartLiveShare: () => void;
  liveShareStatus: { status: ShareStatus; peerCount: number };
}
```

**Step 2: Render badge to the left of `ShareMenu`.**

```tsx
{share ? (
  <>
    <HeaderLiveShareBadge
      status={share.liveShareStatus.status}
      peerCount={share.liveShareStatus.peerCount}
      onClick={share.onStartLiveShare}
    />
    <ShareMenu
      onDownloadPdf={share.onDownloadPdf}
      onDownloadPng={share.onDownloadPng}
      onExportToCloud={share.onExportToCloud}
      onStartLiveShare={share.onStartLiveShare}
    />
  </>
) : null}
```

**Step 3: Update existing `header.test.tsx`** — every test that passes a `share` prop needs to include the two new fields. Adjust with a small factory:

```ts
const shareStub = (overrides = {}) => ({
  onDownloadPdf: vi.fn(),
  onDownloadPng: vi.fn(),
  onExportToCloud: vi.fn(),
  onStartLiveShare: vi.fn(),
  liveShareStatus: { status: 'idle' as const, peerCount: 0 },
  ...overrides,
});
```

Use `shareStub()` everywhere `share={...}` is set today.

**Step 4: Add new test cases.**

```tsx
test('renders the live share badge when status is active', () => {
  render(<Header share={shareStub({ liveShareStatus: { status: 'active', peerCount: 2 } })} {...otherProps} />);
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('clicking the badge invokes onStartLiveShare', async () => {
  const onStart = vi.fn();
  render(<Header share={shareStub({ onStartLiveShare: onStart, liveShareStatus: { status: 'active', peerCount: 1 } })} {...otherProps} />);
  await userEvent.click(screen.getByRole('button', { name: /live share/i }));
  expect(onStart).toHaveBeenCalled();
});
```

Run → pass. Commit:

```bash
git add apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx
git commit -m "feat(web): Header surfaces Live Share badge + onStartLiveShare callback"
```

---

## Task 12: Wire it all in `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx`

**Step 1: Edits.**

```tsx
import { LiveShareDialog } from '@/components/live-share-dialog';
import { useLiveShare } from '@/hooks/use-live-share';
```

Add state and hook (next to `exportDialogOpen`):

```tsx
const [liveShareOpen, setLiveShareOpen] = useState(false);
const liveShare = useLiveShare();
```

Extend the `share` memo:

```tsx
const share = useMemo<HeaderShareCallbacks | undefined>(() => {
  if (!demoView) return undefined;
  return {
    onDownloadPdf:    () => canvasRef.current?.exportPdf(),
    onDownloadPng:    () => canvasRef.current?.exportPng(),
    onExportToCloud:  () => setExportDialogOpen(true),
    onStartLiveShare: () => setLiveShareOpen(true),
    liveShareStatus: {
      status: liveShare.state.status,
      peerCount: liveShare.state.peers.length,
    },
  };
}, [demoView, liveShare.state.status, liveShare.state.peers.length]);
```

Mount the dialog next to `<ExportDialog>`:

```tsx
<LiveShareDialog
  open={liveShareOpen}
  onOpenChange={setLiveShareOpen}
  controller={liveShare}
/>
```

**Step 2: Manual smoke (no test for App.tsx — it's wiring).**

```bash
SHARE_HTTP_URL=https://seeflow.dev bun run dev
```

Open `http://localhost:5173`, click Share → Start Live Share, confirm URL appears. Close dialog, badge shows emerald `0` in header. Click badge, dialog re-opens.

Commit:

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): mount LiveShareDialog + wire useLiveShare into Header"
```

---

## Task 13: E2E smoke test against deployed relay

**Files:**
- Create: `apps/studio/e2e/live-share.e2e.ts`

Playwright e2e — launches studio + opens browser, clicks Share → Start Live Share, then runs `share-smoke.ts join <token>` in a child process to verify the peer side reaches `auth-peer`.

```ts
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';

test('start live share + peer joins via smoke client', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /share/i }).click();
  await page.getByRole('menuitem', { name: /live share/i }).click();
  await page.getByRole('button', { name: /start sharing/i }).click();

  const code = page.locator('code');
  await expect(code).toContainText('share.seeflow.dev/');
  const url = (await code.textContent())!;
  const token = url.split('/').pop()!;

  const peer = spawn('bun', ['../../seeflow-viewer/cloud/bin/share-smoke.ts', 'join', token], {
    env: { ...process.env, SHARE_HTTP_URL: process.env.SHARE_HTTP_URL ?? 'https://seeflow.dev' },
  });
  const out: string[] = [];
  peer.stdout?.on('data', (d) => out.push(d.toString()));
  await new Promise((r) => setTimeout(r, 4000));
  peer.kill();

  expect(out.join('')).toContain('peer <- '); // host should send presence:join echo
  await expect(page.getByText('SmokeBot')).toBeVisible();
});
```

Run:

```bash
bun run test:it:e2e -- live-share.e2e.ts
```

Commit:

```bash
git add apps/studio/e2e/live-share.e2e.ts
git commit -m "test(studio): e2e Live Share start + peer-join via smoke client"
```

---

## Done definition

- `bun test` green across `apps/studio`, `apps/web`, `packages/canvas`.
- `bun run typecheck` clean.
- `bun run lint` clean.
- E2E test in Task 13 passes against the deployed Phase 1 relay.
- Manual smoke: open studio → Share → Start Live Share → copy URL → paste into a browser (which currently 404s because Phase 3 isn't here yet — but the smoke client `join <token>` confirms the auth path).

## Risks + things to watch

- **`peer.joinedAt` not surfaced by the relay yet** — Phase 1 stores it server-side but doesn't emit a `presence` frame on join. Either add `peer-joined` emission in Phase 1 (`ws-default.ts` after `addPeer`) or have the controller assume server-side time. Plan currently assumes the relay emits — file a Phase 1 follow-up if missing.
- **Studio test runner separation** — `apps/web` uses Vitest, `apps/studio` uses `bun test`. Tests in Task 9-12 must live under `apps/web` and Task 1-6 under `apps/studio`; don't cross-pollute.
- **Canvas rebuild** — Task 7 requires rebuilding `@seeflow/canvas` (`predev` script does this, but ad-hoc tests in `apps/web` won't pick up the new prop until `packages/canvas/dist` is regenerated).
- **`design/design.html` adherence** — every Tailwind class above is illustrative; before committing each `apps/web` component, double-check against `design/design.html` tokens (`--emerald`, `--bg`, radii, etc.). Don't invent shadows or colors.
- **EventSource in Vitest** — `jsdom` doesn't ship one. The hook test uses a polyfill on `globalThis`; if `apps/web` already has a real polyfill, prefer that.

## After this phase

Phase 3 (peer SPA route in `seeflow-viewer/src`) consumes the same wsUrl + auth-peer contract Phase 1 exposed and the public URL Phase 2 generates. Phase 4 (RPC dispatch into `operations.ts`) replaces the temporary "edit reverted: host editor not ready" reject in `ShareController.onMessage` with real `operations.moveNode` etc.

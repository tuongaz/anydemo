# Live Share — Phase 1: Relay + DDB + Auth Handshake

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the SeeFlow-hosted relay (AWS API Gateway WebSocket + Lambdas + DynamoDB) with full session creation, host/peer auth handshake, and a smoke-test CLI that proves two clients can ping each other through the relay. No studio or peer-SPA integration yet.

**Architecture:** Add to the existing CDK stack in `seeflow-viewer/cloud/`. One DynamoDB table for session state, one WebSocket API for live connections, two HTTP routes for session create + peer join, five lambda handlers. Auth happens in the first WS frame (not the URL) so secrets stay out of edge/Lambda logs. Payloads are routed by `to` field and never logged.

**Tech stack:** AWS CDK (TypeScript), `aws-cdk-lib/aws-dynamodb`, `aws-cdk-lib/aws-apigatewayv2`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-apigatewaymanagementapi`, Zod for envelope schemas, Node 22.x Lambda runtime, Bun for tests.

**Repo:** `/Users/tuongaz/dev/seeflow-viewer` — all changes are inside `cloud/`. Nothing in `seeflow` or `seeflow-viewer/src` changes in this phase.

**Reference:** [Live Share design doc](./2026-05-31-live-share-design.md) — sections "Relay" and "Auth handshake" define the contracts.

---

## Pre-flight (do once before Task 1)

**Step P1: Switch to a worktree for this implementation.**

```bash
cd /Users/tuongaz/dev/seeflow-viewer
git worktree add .claude/worktrees/live-share-phase-1 -b feat/live-share-phase-1
cd .claude/worktrees/live-share-phase-1
```

**Step P2: Verify `bun test` finds the existing uploader test.**

```bash
cd cloud
bun test lambda/uploader/index.test.ts
```

Expected: tests pass. If `bun` is missing → install via `brew install bun`.

**Step P3: Add a `test` script and Zod dep.**

Edit `cloud/package.json`:

```jsonc
{
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "cdk": "cdk"
  },
  "dependencies": {
    // ... existing
    "@aws-sdk/client-dynamodb": "3.1048.0",
    "@aws-sdk/lib-dynamodb": "3.1048.0",
    "@aws-sdk/client-apigatewaymanagementapi": "3.1048.0",
    "zod": "3.23.8"
  }
}
```

Install: `bun install` (from `cloud/`).

**Step P4: Confirm baseline still passes.**

```bash
bun run typecheck
bun test
```

Both green → ready to start.

---

## Task 1: Add `ShareSessions` DDB table + WebSocket API skeleton to the CDK stack

**Files:**
- Modify: `cloud/lib/seeflow-stack.ts`
- Create: `cloud/lib/seeflow-stack.share.test.ts`

**Step 1: Write the failing CDK assertion test.**

Create `cloud/lib/seeflow-stack.share.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { SeeflowStack } from './seeflow-stack';

function synth() {
  const app = new cdk.App();
  const certStack = new cdk.Stack(app, 'CertStack', { env: { region: 'us-east-1' } });
  const cert = Certificate.fromCertificateArn(
    certStack,
    'Cert',
    'arn:aws:acm:us-east-1:000000000000:certificate/test',
  );
  const stack = new SeeflowStack(app, 'TestStack', {
    certificate: cert,
    env: { region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

describe('Live Share infra', () => {
  test('creates ShareSessions DynamoDB table with TTL', () => {
    const t = synth();
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'sessionId', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('table has a token GSI', () => {
    const t = synth();
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: [
        {
          IndexName: 'token-index',
          KeySchema: [{ AttributeName: 'token', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });
  });

  test('creates a WebSocket API with $connect/$disconnect/$default routes', () => {
    const t = synth();
    t.resourceCountIs('AWS::ApiGatewayV2::Api', 2); // existing HTTP API + new WS API
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'WEBSOCKET',
      RouteSelectionExpression: '$request.body.action',
    });
    for (const key of ['$connect', '$disconnect', '$default']) {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: key });
    }
  });
});
```

**Step 2: Run to confirm it fails.**

```bash
bun test lib/seeflow-stack.share.test.ts
```

Expected: 3 failures — no such resources yet.

**Step 3: Add the resources to `seeflow-stack.ts`.**

Add imports at the top:

```ts
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
```

After `feedbackBucket` (or anywhere before the CloudFront block) inside the `SeeflowStack` constructor:

```ts
// ---- Live Share ----
const shareSessions = new dynamodb.Table(this, 'ShareSessionsTable', {
  tableName: 'seeflow-share-sessions',
  partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',
  removalPolicy: cdk.RemovalPolicy.DESTROY, // ephemeral by design
});

shareSessions.addGlobalSecondaryIndex({
  indexName: 'token-index',
  partitionKey: { name: 'token', type: dynamodb.AttributeType.STRING },
});

const shareWsApi = new apigwv2.WebSocketApi(this, 'ShareWebSocketApi', {
  apiName: 'seeflow-share-ws',
  routeSelectionExpression: '$request.body.action',
});

const shareWsStage = new apigwv2.WebSocketStage(this, 'ShareWebSocketStage', {
  webSocketApi: shareWsApi,
  stageName: 'prod',
  autoDeploy: true,
});

new cdk.CfnOutput(this, 'ShareWebSocketUrl', {
  value: shareWsStage.url, // wss://xxxx.execute-api.us-east-1.amazonaws.com/prod
});
```

For now route handlers are empty — we'll wire them in Task 8. Add three placeholder routes:

```ts
// Placeholder integration target — replaced in Task 8.
const wsPlaceholder = new lambdaNodejs.NodejsFunction(this, 'ShareWsPlaceholder', {
  runtime: lambda.Runtime.NODEJS_22_X,
  entry: path.join(__dirname, '../lambda/share/_placeholder.ts'),
  handler: 'handler',
});

for (const route of ['$connect', '$disconnect', '$default']) {
  shareWsApi.addRoute(route, {
    integration: new apigwv2Integrations.WebSocketLambdaIntegration(
      `ShareWs${route.replace('$', '')}Integration`,
      wsPlaceholder,
    ),
  });
}
```

Create `cloud/lambda/share/_placeholder.ts`:

```ts
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

// Temporary handler so CDK synth has a real lambda to target.
// Replaced in Task 8 by per-route handlers.
export const handler = async (_event: APIGatewayProxyWebsocketEventV2) => ({
  statusCode: 200,
  body: '',
});
```

**Step 4: Run the test.**

```bash
bun test lib/seeflow-stack.share.test.ts && bun run typecheck
```

Expected: all 3 pass, typecheck green.

**Step 5: Commit.**

```bash
git add -f cloud/lib/seeflow-stack.ts cloud/lib/seeflow-stack.share.test.ts cloud/lambda/share/_placeholder.ts cloud/package.json cloud/bun.lock
git commit -m "feat(cloud): scaffold Live Share DDB table + WebSocket API"
```

---

## Task 2: Token, sessionId, peerId generators

**Files:**
- Create: `cloud/lambda/share/shared/ids.ts`
- Create: `cloud/lambda/share/shared/ids.test.ts`

**Step 1: Failing test.**

`cloud/lambda/share/shared/ids.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { newPeerId, newSessionId, newToken, urlSafe } from './ids';

describe('id generators', () => {
  test('newSessionId returns 8 url-safe chars', () => {
    const id = newSessionId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('newToken returns 43 url-safe chars (32 bytes base64url)', () => {
    const t = newToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toContain('=');
  });

  test('newPeerId returns a short id distinct between calls', () => {
    const a = newPeerId();
    const b = newPeerId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(6);
  });

  test('urlSafe strips base64 padding', () => {
    expect(urlSafe(Buffer.from([0xff, 0xff, 0xff]))).toBe('____');
    expect(urlSafe(Buffer.from('hi'))).not.toContain('=');
  });
});
```

Run: `bun test lambda/share/shared/ids.test.ts` → fails (module missing).

**Step 2: Implement.**

`cloud/lambda/share/shared/ids.ts`:

```ts
import { randomBytes } from 'node:crypto';

export function urlSafe(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newSessionId(): string {
  return urlSafe(randomBytes(6)); // 6 bytes -> 8 chars base64url
}

export function newToken(): string {
  return urlSafe(randomBytes(32)); // 32 bytes -> 43 chars base64url
}

export function newPeerId(): string {
  return urlSafe(randomBytes(6));
}
```

Run: `bun test lambda/share/shared/ids.test.ts` → pass.

**Step 3: Commit.**

```bash
git add cloud/lambda/share/shared/ids.ts cloud/lambda/share/shared/ids.test.ts
git commit -m "feat(cloud): share id generators (session/token/peer)"
```

---

## Task 3: Peer JWT mint + verify (HMAC-SHA256, no external dep)

**Files:**
- Create: `cloud/lambda/share/shared/jwt.ts`
- Create: `cloud/lambda/share/shared/jwt.test.ts`

We use a compact custom signed token (not full JWT) — we own both ends, and avoiding `jose`/`jsonwebtoken` keeps the lambda bundle small.

**Step 1: Failing test.**

`cloud/lambda/share/shared/jwt.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { mintPeerToken, verifyPeerToken } from './jwt';

const SECRET = 'a'.repeat(32);

describe('peer token', () => {
  test('round-trips a payload', () => {
    const t = mintPeerToken({ sessionId: 'abc', peerId: 'p1', role: 'editor' }, SECRET, 300);
    const got = verifyPeerToken(t, SECRET);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.payload.sessionId).toBe('abc');
      expect(got.payload.peerId).toBe('p1');
      expect(got.payload.role).toBe('editor');
    }
  });

  test('rejects tampered payload', () => {
    const t = mintPeerToken({ sessionId: 'abc', peerId: 'p1', role: 'editor' }, SECRET, 300);
    const [head, body, sig] = t.split('.');
    const tampered = `${head}.${body}X.${sig}`;
    expect(verifyPeerToken(tampered, SECRET).ok).toBe(false);
  });

  test('rejects expired token', () => {
    const t = mintPeerToken({ sessionId: 'abc', peerId: 'p1', role: 'editor' }, SECRET, -1);
    expect(verifyPeerToken(t, SECRET).ok).toBe(false);
  });

  test('rejects token signed with a different secret', () => {
    const t = mintPeerToken({ sessionId: 'abc', peerId: 'p1', role: 'editor' }, SECRET, 300);
    expect(verifyPeerToken(t, 'b'.repeat(32)).ok).toBe(false);
  });
});
```

Run → fails.

**Step 2: Implement.**

`cloud/lambda/share/shared/jwt.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { urlSafe } from './ids';

export interface PeerPayload {
  sessionId: string;
  peerId: string;
  role: 'editor';
  exp: number; // unix seconds
}

function sign(input: string, secret: string): string {
  return urlSafe(createHmac('sha256', secret).update(input).digest());
}

export function mintPeerToken(
  payload: Omit<PeerPayload, 'exp'>,
  secret: string,
  ttlSeconds: number,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = urlSafe(Buffer.from(JSON.stringify({ ...payload, exp })));
  const head = urlSafe(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'PT' })));
  const sig = sign(`${head}.${body}`, secret);
  return `${head}.${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: PeerPayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

export function verifyPeerToken(token: string, secret: string): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [head, body, sig] = parts;
  const expected = sign(`${head}.${body}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as PeerPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
```

Run tests → pass.

**Step 3: Commit.**

```bash
git add cloud/lambda/share/shared/jwt.ts cloud/lambda/share/shared/jwt.test.ts
git commit -m "feat(cloud): HMAC peer token mint + verify"
```

---

## Task 4: Envelope Zod schemas

**Files:**
- Create: `cloud/lambda/share/shared/envelope.ts`
- Create: `cloud/lambda/share/shared/envelope.test.ts`

**Step 1: Failing test.**

`cloud/lambda/share/shared/envelope.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { EnvelopeSchema, parseEnvelope } from './envelope';

describe('envelope', () => {
  test('parses a valid rpc envelope', () => {
    const got = parseEnvelope({
      v: 1,
      type: 'rpc',
      id: 'r1',
      from: 'host',
      to: 'peer-x',
      payload: { op: 'moveNode' },
    });
    expect(got.ok).toBe(true);
  });

  test('rejects wrong version', () => {
    expect(parseEnvelope({ v: 2, type: 'rpc', from: 'x', payload: {} }).ok).toBe(false);
  });

  test('rejects unknown type', () => {
    expect(parseEnvelope({ v: 1, type: 'banana', from: 'x', payload: {} }).ok).toBe(false);
  });

  test('parses auth-host frame', () => {
    expect(
      parseEnvelope({ v: 1, type: 'auth-host', from: 'host', payload: { hostKey: 'a' } }).ok,
    ).toBe(true);
  });

  test('parses auth-peer frame', () => {
    expect(
      parseEnvelope({ v: 1, type: 'auth-peer', from: 'peer', payload: { peerJwt: 'a.b.c' } }).ok,
    ).toBe(true);
  });
});
```

Run → fails.

**Step 2: Implement.**

`cloud/lambda/share/shared/envelope.ts`:

```ts
import { z } from 'zod';

export const EnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.enum([
    'auth-host',
    'auth-peer',
    'rpc',
    'rpc-result',
    'sse',
    'presence',
    'file-request',
    'file-bytes',
    'file-redirect',
    'file-upload-intent',
    'file-upload-done',
    'node-patched',
    'files-manifest',
    'kick',
  ]),
  id: z.string().optional(),
  from: z.string(),
  to: z.union([z.string(), z.literal('host'), z.literal('all')]).optional(),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

export function parseEnvelope(raw: unknown):
  | { ok: true; envelope: Envelope }
  | { ok: false; reason: string } {
  const r = EnvelopeSchema.safeParse(raw);
  if (!r.success) return { ok: false, reason: r.error.message };
  return { ok: true, envelope: r.data };
}
```

Run → pass.

**Step 3: Commit.**

```bash
git add cloud/lambda/share/shared/envelope.ts cloud/lambda/share/shared/envelope.test.ts
git commit -m "feat(cloud): share envelope zod schema"
```

---

## Task 5: DDB session helpers

**Files:**
- Create: `cloud/lambda/share/shared/ddb.ts`
- Create: `cloud/lambda/share/shared/sessions.ts`
- Create: `cloud/lambda/share/shared/sessions.test.ts`

These wrap the DocumentClient with the operations we need: `createSession`, `getBySessionId`, `getByToken`, `setHostConnId`, `addPeer`, `removePeer`, `touch`, `rotateToken`.

**Step 1: Add a minimal DDB client wrapper.**

`cloud/lambda/share/shared/ddb.ts`:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const raw = new DynamoDBClient({});
export const doc = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});
export const TABLE = process.env.SHARE_TABLE ?? 'seeflow-share-sessions';
```

**Step 2: Failing test for `sessions.ts`.**

`cloud/lambda/share/shared/sessions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as ddbMod from './ddb';
import { addPeer, createSession, getByToken, removePeer, setHostConnId } from './sessions';

// In-memory fake of the DocumentClient covering the commands we use.
type Row = Record<string, unknown>;
const store = new Map<string, Row>();
const byToken = new Map<string, Row>();

const fakeSend = mock(async (cmd: any) => {
  const input = cmd.input ?? cmd;
  const name = cmd.constructor.name;
  switch (name) {
    case 'PutCommand': {
      store.set(input.Item.sessionId, input.Item);
      if (input.Item.token) byToken.set(input.Item.token, input.Item);
      return {};
    }
    case 'GetCommand': {
      return { Item: store.get(input.Key.sessionId) };
    }
    case 'QueryCommand': {
      const tok = input.ExpressionAttributeValues[':t'];
      const item = byToken.get(tok);
      return { Items: item ? [item] : [] };
    }
    case 'UpdateCommand': {
      const item = store.get(input.Key.sessionId);
      if (!item) throw new Error('no item');
      const expr: string = input.UpdateExpression;
      const vals = input.ExpressionAttributeValues ?? {};
      if (expr.includes('hostConnId = :c')) item.hostConnId = vals[':c'];
      if (expr.includes('peers.#p = :p')) (item.peers as Row)[input.ExpressionAttributeNames['#p']] = vals[':p'];
      if (expr.includes('REMOVE peers.#p')) delete (item.peers as Row)[input.ExpressionAttributeNames['#p']];
      if (vals[':l']) item.lastActivity = vals[':l'];
      if (vals[':ttl']) item.ttl = vals[':ttl'];
      return { Attributes: item };
    }
    default:
      throw new Error(`unmocked ${name}`);
  }
});

beforeEach(() => {
  store.clear();
  byToken.clear();
  (ddbMod.doc as any).send = fakeSend;
});
afterEach(() => fakeSend.mockClear());

describe('sessions', () => {
  test('createSession persists a row', async () => {
    const s = await createSession({ sessionId: 's1', token: 't1', hostKey: 'h1' });
    expect(s.sessionId).toBe('s1');
    expect(store.get('s1')?.token).toBe('t1');
  });

  test('getByToken finds the row via GSI', async () => {
    await createSession({ sessionId: 's2', token: 't2', hostKey: 'h2' });
    const got = await getByToken('t2');
    expect(got?.sessionId).toBe('s2');
  });

  test('setHostConnId updates the connection id', async () => {
    await createSession({ sessionId: 's3', token: 't3', hostKey: 'h3' });
    await setHostConnId('s3', 'conn-abc');
    expect(store.get('s3')?.hostConnId).toBe('conn-abc');
  });

  test('addPeer/removePeer mutates peers map', async () => {
    await createSession({ sessionId: 's4', token: 't4', hostKey: 'h4' });
    await addPeer('s4', 'conn-1', { peerId: 'p1', displayName: 'Alice', role: 'editor' });
    expect((store.get('s4')?.peers as Row)['conn-1']).toBeDefined();
    await removePeer('s4', 'conn-1');
    expect((store.get('s4')?.peers as Row)['conn-1']).toBeUndefined();
  });
});
```

Run → fails.

**Step 3: Implement `sessions.ts`.**

`cloud/lambda/share/shared/sessions.ts`:

```ts
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { TABLE, doc } from './ddb';

const IDLE_TTL_SECONDS = 30 * 60;

export interface PeerInfo {
  peerId: string;
  displayName: string;
  role: 'editor';
  joinedAt?: number;
}

export interface SessionRow {
  sessionId: string;
  token: string;
  hostKey: string;
  hostConnId: string | null;
  peers: Record<string, PeerInfo>;
  createdAt: number;
  lastActivity: number;
  ttl: number;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export async function createSession(args: {
  sessionId: string;
  token: string;
  hostKey: string;
}): Promise<SessionRow> {
  const now = nowSec();
  const row: SessionRow = {
    sessionId: args.sessionId,
    token: args.token,
    hostKey: args.hostKey,
    hostConnId: null,
    peers: {},
    createdAt: now,
    lastActivity: now,
    ttl: now + IDLE_TTL_SECONDS,
  };
  await doc.send(new PutCommand({ TableName: TABLE, Item: row }));
  return row;
}

export async function getBySessionId(sessionId: string): Promise<SessionRow | undefined> {
  const r = await doc.send(new GetCommand({ TableName: TABLE, Key: { sessionId } }));
  return r.Item as SessionRow | undefined;
}

export async function getByToken(token: string): Promise<SessionRow | undefined> {
  const r = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'token-index',
      KeyConditionExpression: '#tk = :t',
      ExpressionAttributeNames: { '#tk': 'token' },
      ExpressionAttributeValues: { ':t': token },
      Limit: 1,
    }),
  );
  return r.Items?.[0] as SessionRow | undefined;
}

export async function setHostConnId(sessionId: string, connId: string | null): Promise<void> {
  const now = nowSec();
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET hostConnId = :c, lastActivity = :l, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':c': connId,
        ':l': now,
        ':ttl': now + IDLE_TTL_SECONDS,
      },
    }),
  );
}

export async function addPeer(
  sessionId: string,
  connId: string,
  peer: PeerInfo,
): Promise<void> {
  const now = nowSec();
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { sessionId },
      UpdateExpression:
        'SET peers.#p = :p, lastActivity = :l, #ttl = :ttl',
      ExpressionAttributeNames: { '#p': connId, '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':p': { ...peer, joinedAt: now },
        ':l': now,
        ':ttl': now + IDLE_TTL_SECONDS,
      },
    }),
  );
}

export async function removePeer(sessionId: string, connId: string): Promise<void> {
  const now = nowSec();
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { sessionId },
      UpdateExpression: 'REMOVE peers.#p SET lastActivity = :l, #ttl = :ttl',
      ExpressionAttributeNames: { '#p': connId, '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':l': now,
        ':ttl': now + IDLE_TTL_SECONDS,
      },
    }),
  );
}

export async function touch(sessionId: string): Promise<void> {
  const now = nowSec();
  await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET lastActivity = :l, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':l': now, ':ttl': now + IDLE_TTL_SECONDS },
    }),
  );
}
```

Run tests → pass.

**Step 4: Commit.**

```bash
git add cloud/lambda/share/shared/ddb.ts cloud/lambda/share/shared/sessions.ts cloud/lambda/share/shared/sessions.test.ts
git commit -m "feat(cloud): DDB session helpers (create/get/peer ops/touch)"
```

---

## Task 6: `session-create` HTTP handler

**Files:**
- Create: `cloud/lambda/share/session-create.ts`
- Create: `cloud/lambda/share/session-create.test.ts`

**Step 1: Failing test.**

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as sessions from './shared/sessions';
import { handler } from './session-create';

const created: any[] = [];
beforeEach(() => {
  created.length = 0;
  (sessions as any).createSession = mock(async (args: any) => {
    created.push(args);
    return { ...args, peers: {}, createdAt: 0, lastActivity: 0, ttl: 0, hostConnId: null };
  });
  process.env.SHARE_WS_URL = 'wss://test.example/prod';
});
afterEach(() => delete process.env.SHARE_WS_URL);

describe('session-create', () => {
  test('returns sessionId, token, hostKey, wsUrl', async () => {
    const res: any = await handler({} as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBeDefined();
    expect(body.token).toHaveLength(43);
    expect(body.hostKey).toHaveLength(43);
    expect(body.wsUrl).toBe('wss://test.example/prod');
    expect(created.length).toBe(1);
  });

  test('returns 500 when SHARE_WS_URL is missing', async () => {
    delete process.env.SHARE_WS_URL;
    const res: any = await handler({} as any);
    expect(res.statusCode).toBe(500);
  });
});
```

Run → fails.

**Step 2: Implement.**

`cloud/lambda/share/session-create.ts`:

```ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { newSessionId, newToken } from './shared/ids';
import { createSession } from './shared/sessions';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const wsUrl = process.env.SHARE_WS_URL;
  if (!wsUrl) return json(500, { error: 'misconfigured' });

  const sessionId = newSessionId();
  const token = newToken();
  const hostKey = newToken();
  await createSession({ sessionId, token, hostKey });

  return json(200, { sessionId, token, hostKey, wsUrl });
};
```

Run tests → pass.

**Step 3: Commit.**

```bash
git add cloud/lambda/share/session-create.ts cloud/lambda/share/session-create.test.ts
git commit -m "feat(cloud): POST /api/share/sessions creates a session row"
```

---

## Task 7: `session-join` HTTP handler

**Files:**
- Create: `cloud/lambda/share/session-join.ts`
- Create: `cloud/lambda/share/session-join.test.ts`

**Step 1: Failing test.**

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as sessions from './shared/sessions';
import { handler } from './session-join';

beforeEach(() => {
  process.env.SHARE_WS_URL = 'wss://test.example/prod';
  process.env.SHARE_JWT_SECRET = 'a'.repeat(32);
  (sessions as any).getByToken = mock(async (t: string) => {
    if (t !== 'good-token') return undefined;
    return {
      sessionId: 's1',
      token: 'good-token',
      hostKey: 'hk',
      hostConnId: 'host-conn',
      peers: {},
      createdAt: 0,
      lastActivity: 0,
      ttl: 0,
    };
  });
});
afterEach(() => {
  delete process.env.SHARE_WS_URL;
  delete process.env.SHARE_JWT_SECRET;
});

function evt(body: unknown) {
  return { body: JSON.stringify(body) } as any;
}

describe('session-join', () => {
  test('returns wsUrl + peerJwt + hostOnline:true for known token', async () => {
    const res: any = await handler(evt({ token: 'good-token', displayName: 'Alice' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBe('s1');
    expect(body.wsUrl).toBe('wss://test.example/prod');
    expect(body.peerJwt).toContain('.');
    expect(body.hostOnline).toBe(true);
  });

  test('returns 404 for unknown token', async () => {
    const res: any = await handler(evt({ token: 'bad', displayName: 'Bob' }));
    expect(res.statusCode).toBe(404);
  });

  test('returns 400 for missing displayName', async () => {
    const res: any = await handler(evt({ token: 'good-token' }));
    expect(res.statusCode).toBe(400);
  });
});
```

Run → fails.

**Step 2: Implement.**

`cloud/lambda/share/session-join.ts`:

```ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { newPeerId } from './shared/ids';
import { mintPeerToken } from './shared/jwt';
import { getByToken } from './shared/sessions';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const PEER_TTL = 5 * 60; // 5 minutes

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const wsUrl = process.env.SHARE_WS_URL;
  const secret = process.env.SHARE_JWT_SECRET;
  if (!wsUrl || !secret) return json(500, { error: 'misconfigured' });

  let parsed: { token?: unknown; displayName?: unknown };
  try {
    parsed = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'invalid-json' });
  }
  const token = typeof parsed.token === 'string' ? parsed.token : null;
  const displayName =
    typeof parsed.displayName === 'string' && parsed.displayName.trim().length > 0
      ? parsed.displayName.trim().slice(0, 40)
      : null;
  if (!token) return json(400, { error: 'missing-token' });
  if (!displayName) return json(400, { error: 'missing-displayName' });

  const session = await getByToken(token);
  if (!session) return json(404, { error: 'unknown-token' });

  const peerId = newPeerId();
  const peerJwt = mintPeerToken(
    { sessionId: session.sessionId, peerId, role: 'editor' },
    secret,
    PEER_TTL,
  );

  return json(200, {
    sessionId: session.sessionId,
    peerId,
    displayName,
    wsUrl,
    peerJwt,
    hostOnline: Boolean(session.hostConnId),
    flowList: [], // populated in Phase 2 when host registers flows
  });
};
```

Run tests → pass.

**Step 3: Commit.**

```bash
git add cloud/lambda/share/session-join.ts cloud/lambda/share/session-join.test.ts
git commit -m "feat(cloud): POST /api/share/join mints peer JWT for known token"
```

---

## Task 8: WebSocket lambdas — `$connect`, `$disconnect`, `$default`

**Files:**
- Create: `cloud/lambda/share/ws-connect.ts` + `.test.ts`
- Create: `cloud/lambda/share/ws-disconnect.ts` + `.test.ts`
- Create: `cloud/lambda/share/ws-default.ts` + `.test.ts`
- Delete: `cloud/lambda/share/_placeholder.ts`

### 8a — `ws-connect.ts`

`$connect` only accepts the connection. Real auth happens in the first frame on `$default` (so secrets don't appear in URL/headers).

```ts
import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';

export const handler = async (
  _event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // Allow all connects; auth in first frame.
  return { statusCode: 200, body: 'ok' };
};
```

Test:

```ts
import { describe, expect, test } from 'bun:test';
import { handler } from './ws-connect';

describe('ws-connect', () => {
  test('returns 200', async () => {
    const r: any = await handler({} as any);
    expect(r.statusCode).toBe(200);
  });
});
```

### 8b — `ws-disconnect.ts`

On disconnect: if it's the host connection, clear `hostConnId`. If it's a peer connection, remove from peers map. We can't tell from the event alone — we look it up by scanning the sessions table (small, OK for now).

```ts
import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE, doc } from './shared/ddb';
import { removePeer, setHostConnId } from './shared/sessions';
import type { SessionRow } from './shared/sessions';

async function findByConnId(
  connId: string,
): Promise<{ session: SessionRow; role: 'host' | 'peer' } | undefined> {
  // Scan is fine — session table is small (~thousands max) and rows expire in 30 min.
  const r = await doc.send(new ScanCommand({ TableName: TABLE }));
  for (const item of (r.Items ?? []) as SessionRow[]) {
    if (item.hostConnId === connId) return { session: item, role: 'host' };
    if (item.peers && connId in item.peers) return { session: item, role: 'peer' };
  }
  return undefined;
}

export const handler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connId = event.requestContext.connectionId;
  const found = await findByConnId(connId);
  if (!found) return { statusCode: 200, body: 'ok' };
  if (found.role === 'host') {
    await setHostConnId(found.session.sessionId, null);
  } else {
    await removePeer(found.session.sessionId, connId);
  }
  return { statusCode: 200, body: 'ok' };
};
```

Test stubs the lookup + verifies the right helper is called for each role.

### 8c — `ws-default.ts`

Receives every non-system frame. Three responsibilities:

1. **First frame must be auth.** Store `connId → { sessionId, role }` mapping in DDB (use `setHostConnId` or `addPeer`).
2. **Subsequent frames** validate envelope, look up session via the connection's prior auth, then route by `to`:
   - `to: 'host'` → `PostToConnection` against `hostConnId`.
   - `to: 'all'` → fan-out to every entry in `peers` (and host, if `from !== host`).
   - `to: <connId>` → single PostToConnection.

For the v1 cut, we keep the conn-role association in DDB by storing it on the session row inline (we already do that for host via `hostConnId` and for peers via `peers` map). On every `$default` we re-`Scan` to identify the connection's role — same pattern as disconnect. Optimisation: cache in the row's `peers[connId]._verified = true` after auth.

Full implementation:

```ts
import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { TABLE, doc } from './shared/ddb';
import { parseEnvelope } from './shared/envelope';
import type { Envelope } from './shared/envelope';
import { verifyPeerToken } from './shared/jwt';
import {
  addPeer,
  getBySessionId,
  removePeer,
  setHostConnId,
  touch,
} from './shared/sessions';
import type { SessionRow } from './shared/sessions';

function apiClient(event: APIGatewayProxyWebsocketEventV2) {
  const { domainName, stage } = event.requestContext;
  return new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });
}

async function post(
  client: ApiGatewayManagementApiClient,
  connId: string,
  msg: unknown,
): Promise<'ok' | 'gone'> {
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connId,
        Data: Buffer.from(JSON.stringify(msg)),
      }),
    );
    return 'ok';
  } catch (e) {
    if (e instanceof GoneException) return 'gone';
    throw e;
  }
}

async function findConnRole(
  connId: string,
): Promise<{ session: SessionRow; role: 'host' | 'peer'; peerId?: string } | undefined> {
  const r = await doc.send(new ScanCommand({ TableName: TABLE }));
  for (const item of (r.Items ?? []) as SessionRow[]) {
    if (item.hostConnId === connId) return { session: item, role: 'host' };
    if (item.peers && connId in item.peers) {
      return { session: item, role: 'peer', peerId: item.peers[connId].peerId };
    }
  }
  return undefined;
}

async function handleAuthHost(
  event: APIGatewayProxyWebsocketEventV2,
  env: Envelope,
): Promise<APIGatewayProxyResultV2> {
  const payload = env.payload as { hostKey?: string; sessionId?: string };
  if (!payload?.hostKey || !payload?.sessionId) {
    return { statusCode: 400, body: 'missing-fields' };
  }
  const session = await getBySessionId(payload.sessionId);
  if (!session || session.hostKey !== payload.hostKey) {
    return { statusCode: 401, body: 'unauthorized' };
  }
  await setHostConnId(session.sessionId, event.requestContext.connectionId);
  return { statusCode: 200, body: 'ok' };
}

async function handleAuthPeer(
  event: APIGatewayProxyWebsocketEventV2,
  env: Envelope,
): Promise<APIGatewayProxyResultV2> {
  const secret = process.env.SHARE_JWT_SECRET;
  if (!secret) return { statusCode: 500, body: 'misconfigured' };
  const payload = env.payload as { peerJwt?: string; displayName?: string };
  if (!payload?.peerJwt || !payload?.displayName) {
    return { statusCode: 400, body: 'missing-fields' };
  }
  const verify = verifyPeerToken(payload.peerJwt, secret);
  if (!verify.ok) return { statusCode: 401, body: verify.reason };
  await addPeer(verify.payload.sessionId, event.requestContext.connectionId, {
    peerId: verify.payload.peerId,
    displayName: payload.displayName.slice(0, 40),
    role: verify.payload.role,
  });
  return { statusCode: 200, body: 'ok' };
}

async function routeFrame(
  event: APIGatewayProxyWebsocketEventV2,
  env: Envelope,
): Promise<APIGatewayProxyResultV2> {
  const connId = event.requestContext.connectionId;
  const found = await findConnRole(connId);
  if (!found) return { statusCode: 401, body: 'not-authed' };
  await touch(found.session.sessionId);

  const client = apiClient(event);
  const targets: string[] = [];
  if (env.to === 'all' || env.to === undefined) {
    if (found.session.hostConnId && found.session.hostConnId !== connId) {
      targets.push(found.session.hostConnId);
    }
    for (const peerConn of Object.keys(found.session.peers)) {
      if (peerConn !== connId) targets.push(peerConn);
    }
  } else if (env.to === 'host') {
    if (found.session.hostConnId) targets.push(found.session.hostConnId);
  } else {
    targets.push(env.to);
  }

  console.log({
    type: env.type,
    from: connId,
    to: env.to,
    sizeBytes: (event.body ?? '').length,
  }); // never log payload

  await Promise.all(
    targets.map(async (t) => {
      const status = await post(client, t, env);
      if (status === 'gone') {
        if (found.session.hostConnId === t) {
          await setHostConnId(found.session.sessionId, null);
        } else {
          await removePeer(found.session.sessionId, t);
        }
      }
    }),
  );
  return { statusCode: 200, body: 'ok' };
}

export const handler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  let raw: unknown;
  try {
    raw = JSON.parse(event.body ?? '');
  } catch {
    return { statusCode: 400, body: 'invalid-json' };
  }
  const parsed = parseEnvelope(raw);
  if (!parsed.ok) return { statusCode: 400, body: 'invalid-envelope' };
  const env = parsed.envelope;
  if (env.type === 'auth-host') return handleAuthHost(event, env);
  if (env.type === 'auth-peer') return handleAuthPeer(event, env);
  return routeFrame(event, env);
};
```

Tests cover:
- `auth-host` with wrong key → 401, session unchanged
- `auth-host` with right key → 200, `hostConnId` set
- `auth-peer` with valid JWT → 200, peer added
- `auth-peer` with expired JWT → 401
- routing frame from un-authed connId → 401
- routing `to: 'host'` → exactly one `PostToConnection` call to `hostConnId`
- routing `to: 'all'` from a peer → fan-out includes host + other peers, not sender
- `GoneException` → connection cleaned up

For brevity the test file structure mirrors `sessions.test.ts`, mocking `doc.send` and the API GW Management client.

**Delete the placeholder** after the three handlers exist:

```bash
git rm cloud/lambda/share/_placeholder.ts
```

**Commit (after all three lambdas + tests are green):**

```bash
git add cloud/lambda/share/ws-*.ts cloud/lambda/share/ws-*.test.ts
git commit -m "feat(cloud): WebSocket lambdas (connect/disconnect/default with auth + routing)"
```

---

## Task 9: Wire lambdas + HTTP routes + IAM into CDK

**Files:**
- Modify: `cloud/lib/seeflow-stack.ts`
- Modify: `cloud/lib/seeflow-stack.share.test.ts`

**Step 1: Extend the CDK assertion test.**

Append cases:

```ts
test('exposes POST /api/share/sessions and /api/share/join HTTP routes', () => {
  const t = synth();
  t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'POST /api/share/sessions',
  });
  t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'POST /api/share/join',
  });
});

test('grants ShareSessionsTable read/write to share lambdas', () => {
  const t = synth();
  const policies = t.findResources('AWS::IAM::Policy');
  const matched = Object.values(policies).filter((p: any) =>
    JSON.stringify(p.Properties.PolicyDocument).includes('seeflow-share-sessions'),
  );
  // session-create, session-join, ws-connect, ws-disconnect, ws-default = 5 grants
  expect(matched.length).toBeGreaterThanOrEqual(5);
});

test('grants ManageConnections on the WebSocket API to ws-default', () => {
  const t = synth();
  const policies = t.findResources('AWS::IAM::Policy');
  const has = Object.values(policies).some((p: any) =>
    JSON.stringify(p.Properties.PolicyDocument).includes('execute-api:ManageConnections'),
  );
  expect(has).toBe(true);
});
```

Run → fails.

**Step 2: Add the lambdas + integrations to `seeflow-stack.ts`.**

Replace the placeholder block from Task 1 with:

```ts
const jwtSecret = new cdk.CfnParameter(this, 'ShareJwtSecret', {
  type: 'String',
  noEcho: true,
  description: 'HMAC secret for peer JWTs (32+ bytes).',
});

const sharedEnv = {
  SHARE_TABLE: shareSessions.tableName,
  SHARE_WS_URL: shareWsStage.url,
  SHARE_JWT_SECRET: jwtSecret.valueAsString,
};

function makeShareLambda(id: string, file: string) {
  return new lambdaNodejs.NodejsFunction(this, id, {
    runtime: lambda.Runtime.NODEJS_22_X,
    entry: path.join(__dirname, `../lambda/share/${file}`),
    handler: 'handler',
    memorySize: 256,
    timeout: cdk.Duration.seconds(10),
    environment: sharedEnv,
  });
}
// arrow form to keep `this` binding:
const mk = (id: string, file: string) => makeShareLambda.call(this, id, file);

const sessionCreateFn = mk('ShareSessionCreateFn', 'session-create.ts');
const sessionJoinFn = mk('ShareSessionJoinFn', 'session-join.ts');
const wsConnectFn = mk('ShareWsConnectFn', 'ws-connect.ts');
const wsDisconnectFn = mk('ShareWsDisconnectFn', 'ws-disconnect.ts');
const wsDefaultFn = mk('ShareWsDefaultFn', 'ws-default.ts');

// IAM grants
for (const fn of [
  sessionCreateFn,
  sessionJoinFn,
  wsConnectFn,
  wsDisconnectFn,
  wsDefaultFn,
]) {
  shareSessions.grantReadWriteData(fn);
}
shareWsApi.grantManageConnections(wsDefaultFn);

// Replace placeholder routes with real ones (delete the placeholder block from Task 1).
shareWsApi.addRoute('$connect', {
  integration: new apigwv2Integrations.WebSocketLambdaIntegration(
    'ShareWsConnectIntegration',
    wsConnectFn,
  ),
});
shareWsApi.addRoute('$disconnect', {
  integration: new apigwv2Integrations.WebSocketLambdaIntegration(
    'ShareWsDisconnectIntegration',
    wsDisconnectFn,
  ),
});
shareWsApi.addRoute('$default', {
  integration: new apigwv2Integrations.WebSocketLambdaIntegration(
    'ShareWsDefaultIntegration',
    wsDefaultFn,
  ),
});

// HTTP routes — add to the existing httpApi already defined in the stack.
httpApi.addRoutes({
  path: '/api/share/sessions',
  methods: [apigwv2.HttpMethod.POST],
  integration: new HttpLambdaIntegration('ShareSessionCreateInt', sessionCreateFn),
});
httpApi.addRoutes({
  path: '/api/share/join',
  methods: [apigwv2.HttpMethod.POST],
  integration: new HttpLambdaIntegration('ShareSessionJoinInt', sessionJoinFn),
});
```

> **Note:** if the existing stack already has an `httpApi` reference variable, reuse it. If not, find where `HttpLambdaIntegration` is first used to confirm the existing HTTP API construct's variable name and use that.

**Step 3: Synth + tests.**

```bash
bun run typecheck
bun test lib/seeflow-stack.share.test.ts
npx cdk synth --context @aws-cdk/share-jwt-secret=$(openssl rand -base64 32) > /dev/null
```

Expected: typecheck clean, tests green, synth succeeds.

**Step 4: Commit.**

```bash
git add cloud/lib/seeflow-stack.ts cloud/lib/seeflow-stack.share.test.ts
git commit -m "feat(cloud): wire Live Share lambdas + routes + IAM"
```

---

## Task 10: End-to-end smoke client

**Files:**
- Create: `cloud/bin/share-smoke.ts`

A Bun script that drives the relay like a host + a peer would. Run after deploy. Not on the path; not run in CI.

```ts
#!/usr/bin/env bun
// Usage:
//   bun bin/share-smoke.ts host        # creates session, prints URL, idles
//   bun bin/share-smoke.ts join <token>  # joins as a peer, exchanges pings

import { argv, exit } from 'node:process';

const ENDPOINT = process.env.SHARE_HTTP_URL ?? 'https://seeflow.dev';

async function host() {
  const r = await fetch(`${ENDPOINT}/api/share/sessions`, { method: 'POST' });
  if (!r.ok) throw new Error(`create: ${r.status}`);
  const { sessionId, token, hostKey, wsUrl } = await r.json();
  console.log(`Share URL:  https://share.seeflow.dev/${token}`);
  console.log(`sessionId:  ${sessionId}`);
  const ws = new WebSocket(wsUrl);
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'auth-host',
        from: 'host',
        payload: { hostKey, sessionId },
      }),
    );
  ws.onmessage = (m) => console.log('host <-', m.data);
  ws.onclose = (e) => {
    console.log('closed', e.code, e.reason);
    exit(0);
  };
  setInterval(() => {
    ws.send(
      JSON.stringify({ v: 1, type: 'sse', from: 'host', to: 'all', payload: { tick: Date.now() } }),
    );
  }, 5000);
}

async function join(token: string) {
  const r = await fetch(`${ENDPOINT}/api/share/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, displayName: 'SmokeBot' }),
  });
  if (!r.ok) throw new Error(`join: ${r.status} ${await r.text()}`);
  const { wsUrl, peerJwt } = await r.json();
  const ws = new WebSocket(wsUrl);
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        v: 1,
        type: 'auth-peer',
        from: 'peer',
        payload: { peerJwt, displayName: 'SmokeBot' },
      }),
    );
  ws.onmessage = (m) => console.log('peer <-', m.data);
}

const [, , mode, arg] = argv;
if (mode === 'host') host();
else if (mode === 'join' && arg) join(arg);
else {
  console.error('usage: share-smoke (host|join <token>)');
  exit(2);
}
```

**Commit:**

```bash
git add cloud/bin/share-smoke.ts
git commit -m "chore(cloud): add Live Share smoke-test CLI"
```

---

## Task 11: Deploy to dev and verify

> Manual — no test code. Document the result in the PR description.

**Step 1: Synth + deploy.**

```bash
cd cloud
# Generate and store a strong secret in your env
export SHARE_JWT_SECRET=$(openssl rand -base64 32)
npx cdk deploy --parameters ShareJwtSecret=$SHARE_JWT_SECRET
```

Capture from output:
- `ShareWebSocketUrl` (will be the env value `SHARE_WS_URL` once it's resolved)
- HTTP API endpoint (existing; unchanged)

**Step 2: Run smoke client in two terminals.**

Terminal A:
```bash
SHARE_HTTP_URL=https://seeflow.dev bun bin/share-smoke.ts host
# copy the printed token
```

Terminal B:
```bash
SHARE_HTTP_URL=https://seeflow.dev bun bin/share-smoke.ts join <token>
```

Expected:
- Terminal B shows `peer <- {"v":1,"type":"sse",...}` ticks every 5 s.
- Terminal A shows no peer-originated traffic yet (peer only auths in this smoke).

**Step 3: Negative checks.**

- Run `join` with a bad token → HTTP 404.
- Run `host` smoke and then manually `aws apigatewaymanagementapi delete-connection` on the host connection → next tick send fails with `GoneException`, host smoke prints `closed`.
- Inspect CloudWatch logs for `ws-default`: confirm only `{ type, from, to, sizeBytes }` is logged, no payload bodies.

**Step 4: Open PR.**

```bash
git push -u origin feat/live-share-phase-1
gh pr create --title "feat(cloud): Live Share phase 1 (relay + DDB + auth)" --body "$(cat <<'EOF'
## Summary
- New DDB `seeflow-share-sessions` table with token-GSI + 30-min TTL
- New WebSocket API (`$connect`/`$disconnect`/`$default`) and two HTTP routes (`POST /api/share/sessions`, `POST /api/share/join`)
- 5 lambdas under `cloud/lambda/share/` + shared envelope/JWT/sessions/ID modules
- Smoke-test CLI at `cloud/bin/share-smoke.ts`

## Test plan
- [ ] `bun test` green in `cloud/`
- [ ] `bun run typecheck` green
- [ ] `npx cdk synth` succeeds with `ShareJwtSecret` parameter
- [ ] Deployed to dev; smoke client `host` + `join` exchange `sse` ticks
- [ ] Bad token → 404; expired JWT → 401; gone connection cleaned up
- [ ] CloudWatch logs for `ws-default` contain no payload bytes

## Out of scope (future phases)
- Studio integration (Phase 2)
- Peer SPA route (Phase 3)
- RPC dispatch into `operations.ts` (Phase 4)
- Presence, files, SSE bridge, kick/rotate (Phases 5–8)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done definition

- All `bun test` files in `cloud/lambda/share/` pass.
- `bun test lib/seeflow-stack.share.test.ts` passes.
- `bun run typecheck` clean in `cloud/`.
- `npx cdk synth` succeeds with `ShareJwtSecret` parameter.
- Deployed to dev; smoke client demonstrates the full host + peer round trip.
- PR open with the test-plan checklist above.

## Risks + things to watch

- **Scan in `ws-default`/`ws-disconnect`** — fine while sessions ≤ ~1000 active rows. If we ever cross that, add a secondary index on `hostConnId` and store per-conn metadata in a separate `ShareConnections` table.
- **JWT secret rotation** — single secret in CDK parameter. Adding a second active secret for zero-downtime rotation is a Phase 9 hardening task.
- **API Gateway WebSocket cost** — flat per-connection-minute + per-message. Free tier covers light dev usage; surface in landing-report after first month.
- **Cold starts on `ws-default`** — every routed message hits Lambda. ~150 ms cold, ~5 ms warm. Acceptable for v1; provisioned concurrency a later option.

## After this phase

Phase 2 (studio `share.ts` outbound client + local API endpoints) consumes the contracts in `envelope.ts` and the URLs from `session-create.ts`. No further relay changes expected until Phase 4 (operations dispatch — relay stays a dumb router, but we may add an audit-tap there).

#!/usr/bin/env bun
import { resolveStudioUrl } from './studio-config';

const DEFAULT_HARD_CEILING_MS = 120_000;
const DEFAULT_STATUS_WAIT_MS = 10_000;
const SSE_PLAY_CONFIRM_MS = 5_000; // extra window after HTTP response to receive node:done/error via SSE

export interface PlayOutcome {
  nodeId: string;
  outcome: 'ok' | 'failed';
  runId?: string;
  body?: unknown;
  error?: string;
}

export interface StatusFirstReport {
  state: string;
  summary?: string;
  detail?: string;
  ts?: number;
}

export interface StatusOutcome {
  nodeId: string;
  outcome: 'ok' | 'failed';
  firstReport?: StatusFirstReport;
  error?: string;
}

export interface SkippedItem {
  nodeId: string;
  reason: string;
}

export interface ValidationReport {
  ok: boolean;
  plays: PlayOutcome[];
  statuses: StatusOutcome[];
  skipped: SkippedItem[];
}

export interface ValidateOptions {
  flowId: string;
  url?: string;
  hardCeilingMs?: number;
  statusWaitMs?: number;
  /** Node IDs to skip during validation (validationSafe: false — passed in by orchestrator). */
  skipNodes?: string[];
}

interface MaybeAction {
  [k: string]: unknown;
}

interface NodeShape {
  id: string;
  type: string;
  data?: {
    playAction?: MaybeAction;
    statusAction?: unknown;
  };
}

interface DemoShape {
  nodes?: NodeShape[];
}

interface FlowGetResponse {
  id?: string;
  valid?: boolean;
  error?: string | null;
  demo?: DemoShape | null;
}

interface SseEvent {
  event: string;
  data: string;
}

interface SseChannel {
  next(timeoutMs: number): Promise<SseEvent | null>;
  close(): void;
}

function openSseChannel(body: ReadableStream<Uint8Array>): SseChannel {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const queue: SseEvent[] = [];
  const waiters: Array<() => void> = [];
  let buffer = '';
  let ended = false;
  let cancelled = false;

  const wake = () => {
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w) w();
    }
  };

  const flushBlock = (block: string) => {
    let eventType = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const piece = line.slice(5).replace(/^ /, '');
        data = data.length === 0 ? piece : `${data}\n${piece}`;
      }
    }
    queue.push({ event: eventType, data });
  };

  void (async () => {
    try {
      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          flushBlock(block);
          idx = buffer.indexOf('\n\n');
        }
        if (queue.length > 0) wake();
      }
    } catch {
      // swallow — surface as `ended` to consumers
    } finally {
      ended = true;
      wake();
    }
  })();

  return {
    async next(timeoutMs) {
      const deadline = Date.now() + Math.max(0, timeoutMs);
      while (queue.length === 0 && !ended) {
        const left = deadline - Date.now();
        if (left <= 0) return null;
        const woke = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), left);
          waiters.push(() => {
            clearTimeout(t);
            resolve(true);
          });
        });
        if (!woke) return null;
      }
      return queue.shift() ?? null;
    },
    close() {
      cancelled = true;
      reader.cancel().catch(() => {});
      wake();
    },
  };
}

function hasPlayAction(node: NodeShape): boolean {
  return (
    (node.type === 'playNode' || node.type === 'stateNode') && node.data?.playAction !== undefined
  );
}

function hasStatusAction(node: NodeShape): boolean {
  return (
    (node.type === 'playNode' || node.type === 'stateNode') && node.data?.statusAction !== undefined
  );
}

export async function validateEndToEnd(options: ValidateOptions): Promise<ValidationReport> {
  const url = options.url ?? resolveStudioUrl();
  const hardCeilingMs = options.hardCeilingMs ?? DEFAULT_HARD_CEILING_MS;
  const statusWaitMs = options.statusWaitMs ?? DEFAULT_STATUS_WAIT_MS;
  const startedAt = Date.now();
  const overallDeadline = startedAt + hardCeilingMs;

  const plays: PlayOutcome[] = [];
  const statuses: StatusOutcome[] = [];
  const skipped: SkippedItem[] = [];

  // Fetch and validate demo registration
  const demoRes = await globalThis.fetch(`${url}/api/flows/${options.flowId}`);
  if (!demoRes.ok) {
    return {
      ok: false,
      plays,
      statuses,
      skipped: [
        {
          nodeId: '<demo>',
          reason: `GET /api/flows/${options.flowId} returned HTTP ${demoRes.status}`,
        },
      ],
    };
  }
  const demoData = (await demoRes.json()) as FlowGetResponse;
  if (!demoData.valid || !demoData.demo) {
    return {
      ok: false,
      plays,
      statuses,
      skipped: [
        {
          nodeId: '<demo>',
          reason: `demo not valid: ${demoData.error ?? '<no error>'}`,
        },
      ],
    };
  }

  const nodes = demoData.demo.nodes ?? [];

  const skipSet = new Set(options.skipNodes ?? []);
  const playTargets: string[] = [];
  for (const node of nodes) {
    if (!hasPlayAction(node)) continue;
    if (node.data?.playAction?.validationSafe === false) {
      skipped.push({ nodeId: node.id, reason: 'playAction.validationSafe is false' });
      continue;
    }
    if (skipSet.has(node.id)) {
      skipped.push({ nodeId: node.id, reason: 'playAction.validationSafe is false' });
      continue;
    }
    playTargets.push(node.id);
  }
  const statusTargets = nodes.filter(hasStatusAction).map((n) => n.id);

  // Open SSE channel BEFORE triggering any plays so node:done/node:error events
  // emitted during play execution are buffered and not lost.
  let channel: SseChannel | undefined;
  try {
    const sseRes = await globalThis.fetch(`${url}/api/events?flowId=${options.flowId}`, {
      headers: { accept: 'text/event-stream' },
    });
    if (sseRes.ok && sseRes.body) {
      channel = openSseChannel(sseRes.body);
    } else if (statusTargets.length > 0) {
      for (const nid of statusTargets) {
        statuses.push({
          nodeId: nid,
          outcome: 'failed',
          error: `failed to open SSE stream: HTTP ${sseRes.status}`,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (statusTargets.length > 0) {
      for (const nid of statusTargets) {
        statuses.push({
          nodeId: nid,
          outcome: 'failed',
          error: `failed to open SSE stream: ${message}`,
        });
      }
    }
  }

  // Trigger all plays sequentially and collect HTTP-level results.
  // The play endpoint is synchronous: it awaits the script and returns the
  // final outcome in the HTTP body. SSE events are emitted before the HTTP
  // response, so they should already be in the channel buffer by the time
  // each fetch() resolves.
  const httpResults = new Map<string, { runId?: string; httpError?: string; body?: unknown }>();

  for (const nodeId of playTargets) {
    if (Date.now() > overallDeadline) {
      plays.push({ nodeId, outcome: 'failed', error: 'hard ceiling exceeded before play' });
      continue;
    }
    let res: Response;
    try {
      res = await globalThis.fetch(`${url}/api/flows/${options.flowId}/play/${nodeId}`, {
        method: 'POST',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      httpResults.set(nodeId, { httpError: message });
      continue;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      httpResults.set(nodeId, { httpError: `HTTP ${res.status}`, body });
    } else {
      const parsed = (body ?? {}) as { runId?: string; error?: string };
      httpResults.set(nodeId, {
        runId: parsed.runId,
        httpError:
          typeof parsed.error === 'string' && parsed.error.length > 0 ? parsed.error : undefined,
        body,
      });
    }
  }

  // Drain SSE events: collect node:done / node:error for play nodes AND
  // node:status for status nodes. Stop early once all pending targets are
  // accounted for, or when the drain deadline is reached.
  const ssePlayResults = new Map<string, { type: 'done' | 'error'; message?: string }>();
  const sseStatusReports = new Map<string, StatusFirstReport>();

  if (channel) {
    // Plays we still need SSE confirmation for (those that had a clean HTTP response)
    const pendingPlays = new Set(
      playTargets.filter((id) => httpResults.has(id) && !httpResults.get(id)?.httpError),
    );
    const pendingStatuses = new Set(
      statusTargets.filter((id) => !statuses.find((s) => s.nodeId === id)),
    );

    const drainDeadline = Math.min(
      Date.now() + Math.max(SSE_PLAY_CONFIRM_MS, statusWaitMs),
      overallDeadline,
    );

    while (pendingPlays.size + pendingStatuses.size > 0) {
      const left = drainDeadline - Date.now();
      if (left <= 0) break;
      const evt = await channel.next(left);
      if (!evt) break;

      if (evt.event === 'node:done' || evt.event === 'node:error') {
        let payload: { nodeId?: unknown; message?: unknown };
        try {
          payload = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const nid = payload?.nodeId;
        if (typeof nid !== 'string' || !pendingPlays.has(nid)) continue;
        ssePlayResults.set(nid, {
          type: evt.event === 'node:done' ? 'done' : 'error',
          message: typeof payload.message === 'string' ? payload.message : undefined,
        });
        pendingPlays.delete(nid);
      } else if (evt.event === 'node:status') {
        let payload: {
          nodeId?: unknown;
          state?: unknown;
          summary?: unknown;
          detail?: unknown;
          ts?: unknown;
        };
        try {
          payload = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const nid = payload?.nodeId;
        const state = payload?.state;
        if (typeof nid !== 'string' || typeof state !== 'string') continue;
        if (!pendingStatuses.has(nid)) continue;
        if (state === 'error') continue;
        sseStatusReports.set(nid, {
          state,
          summary: typeof payload.summary === 'string' ? payload.summary : undefined,
          detail: typeof payload.detail === 'string' ? payload.detail : undefined,
          ts: typeof payload.ts === 'number' ? payload.ts : undefined,
        });
        pendingStatuses.delete(nid);
      }
    }

    channel.close();
  }

  // Resolve final play outcomes: SSE confirmation takes precedence over HTTP,
  // because SSE reflects the actual script execution result. If SSE is missing
  // (channel failed to open), fall back to HTTP result.
  for (const nodeId of playTargets) {
    if (plays.find((p) => p.nodeId === nodeId)) continue; // already recorded (ceiling exceeded)

    const http = httpResults.get(nodeId);
    if (!http) continue; // should not happen

    const sse = ssePlayResults.get(nodeId);

    if (http.httpError) {
      // HTTP-level failure — no need to check SSE
      plays.push({
        nodeId,
        outcome: 'failed',
        runId: http.runId,
        body: http.body,
        error: http.httpError,
      });
    } else if (sse?.type === 'error') {
      // HTTP returned ok but SSE confirmed the script errored
      plays.push({
        nodeId,
        outcome: 'failed',
        runId: http.runId,
        body: http.body,
        error: sse.message ?? 'script error confirmed via SSE node:error event',
      });
    } else if (sse?.type === 'done') {
      // Both HTTP and SSE agree: success
      plays.push({ nodeId, outcome: 'ok', runId: http.runId, body: http.body });
    } else {
      // No SSE event received (channel unavailable or timed out). HTTP says ok.
      plays.push({ nodeId, outcome: 'ok', runId: http.runId, body: http.body });
    }
  }

  // Resolve final status outcomes
  const overallExceeded = Date.now() > overallDeadline;
  for (const nodeId of statusTargets) {
    if (statuses.find((s) => s.nodeId === nodeId)) continue; // already recorded (SSE open failure)
    const report = sseStatusReports.get(nodeId);
    if (report) {
      statuses.push({ nodeId, outcome: 'ok', firstReport: report });
    } else {
      statuses.push({
        nodeId,
        outcome: 'failed',
        error: overallExceeded
          ? 'hard ceiling exceeded before status received'
          : 'no non-error status received within timeout',
      });
    }
  }

  const allPlaysOk = plays.every((p) => p.outcome === 'ok');
  const allStatusesOk = statuses.every((s) => s.outcome === 'ok');
  const ok = allPlaysOk && allStatusesOk && Date.now() <= overallDeadline;

  return { ok, plays, statuses, skipped };
}

export async function main(argv: string[]): Promise<number> {
  const [flowId, ...flags] = argv;
  if (!flowId) {
    process.stderr.write('Usage: validate-end-to-end.ts <flowId> [--skip-nodes nodeId1,nodeId2]\n');
    return 1;
  }
  const skipIdx = flags.indexOf('--skip-nodes');
  const skipNodes =
    skipIdx !== -1 && flags[skipIdx + 1] ? flags[skipIdx + 1].split(',').filter(Boolean) : [];
  const report = await validateEndToEnd({ flowId, skipNodes });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

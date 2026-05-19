#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerDemo } from './register';
import { resolveStudioUrl } from './studio-config';
import { unregisterDemo } from './unregister';

const HEALTH_TIMEOUT_MS = 1000;

export interface SmokeOptions {
  url?: string;
  keepTmp?: boolean;
}

export interface SmokeResult {
  ok: boolean;
  error?: string;
  tmpRepo?: string;
  firstId?: string;
  firstSlug?: string;
  secondId?: string;
  secondSlug?: string;
}

export async function pingStudio(url: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  try {
    const res = await globalThis.fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function firstDemoFixture(): unknown {
  return {
    version: 2,
    name: 'Smoke Flow',
    nodes: [
      {
        id: 'smoke-service',
        type: 'playNode',
        data: {
          name: 'POST /smoke',
          kind: 'service',
          stateSource: { kind: 'request' },
          playAction: {
            kind: 'script',
            interpreter: 'bun',
            args: ['run'],
            scriptPath: 'scripts/play.ts',
          },
          description: 'Smoke fixture: first demo.',
        },
      },
    ],
    connectors: [],
  };
}

function secondDemoFixture(): unknown {
  return {
    version: 2,
    name: 'Sample Flow',
    nodes: [
      {
        id: 'sample-service',
        type: 'playNode',
        data: {
          name: 'GET /sample',
          kind: 'service',
          stateSource: { kind: 'request' },
          playAction: {
            kind: 'script',
            interpreter: 'bun',
            args: ['run'],
            scriptPath: 'scripts/play.ts',
          },
          description: 'Smoke fixture: second demo coexisting with the first.',
        },
      },
    ],
    connectors: [],
  };
}

interface ValidateIssue {
  scope: string;
  path: unknown[];
  message: string;
  code: string;
}

async function validateViaApi(
  url: string,
  flowPath: string,
): Promise<{ ok: true } | { ok: false; issues: ValidateIssue[] }> {
  const flow = JSON.parse(readFileSync(flowPath, 'utf8'));
  const res = await globalThis.fetch(`${url}/api/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flow }),
  });
  if (!res.ok) throw new Error(`POST /api/validate → ${res.status}`);
  return (await res.json()) as { ok: true } | { ok: false; issues: ValidateIssue[] };
}

interface FlowSummary {
  id: string;
  slug: string;
  repoPath: string;
}

async function listDemos(url: string): Promise<FlowSummary[]> {
  const res = await globalThis.fetch(`${url}/api/flows`);
  if (!res.ok) {
    throw new Error(`GET /api/flows failed: ${res.status}`);
  }
  return (await res.json()) as FlowSummary[];
}

export async function runSmoke(options: SmokeOptions = {}): Promise<SmokeResult> {
  const url = options.url ?? resolveStudioUrl();
  const reachable = await pingStudio(url);
  if (!reachable) {
    return {
      ok: false,
      error: `Studio not reachable at ${url}. Start it with: seeflow start`,
    };
  }

  const tmpRepo = mkdtempSync(join(tmpdir(), 'seeflow-smoke-'));
  let firstId: string | undefined;
  let secondId: string | undefined;

  try {
    // Write the first demo fixture inline.
    const firstDir = join(tmpRepo, '.seeflow');
    mkdirSync(firstDir, { recursive: true });
    writeFileSync(join(firstDir, 'flow.json'), JSON.stringify(firstDemoFixture(), null, 2));

    // 1. Register the first demo at .seeflow/flow.json.
    const firstReg = await registerDemo({
      repoPath: tmpRepo,
      flowPath: '.seeflow/flow.json',
      url,
    });
    if (!firstReg.ok) {
      return {
        ok: false,
        tmpRepo,
        error: `register first demo failed (${firstReg.status}): ${JSON.stringify(firstReg.body)}`,
      };
    }
    const firstBody = firstReg.body as { id?: string; slug?: string };
    if (!firstBody.id || !firstBody.slug) {
      return {
        ok: false,
        tmpRepo,
        error: `register first demo returned malformed body: ${JSON.stringify(firstReg.body)}`,
      };
    }
    firstId = firstBody.id;

    // 2. Write a SECOND demo at .seeflow/sample/flow.json — validate via vendored schema.
    const secondDir = join(tmpRepo, '.seeflow', 'sample');
    mkdirSync(secondDir, { recursive: true });
    const secondPath = join(secondDir, 'flow.json');
    writeFileSync(secondPath, JSON.stringify(secondDemoFixture(), null, 2));

    const validation = await validateViaApi(url, secondPath);
    if (!validation.ok) {
      return {
        ok: false,
        tmpRepo,
        error: `second demo failed schema validation: ${JSON.stringify(validation.issues)}`,
      };
    }

    const secondReg = await registerDemo({
      repoPath: tmpRepo,
      flowPath: '.seeflow/sample/flow.json',
      url,
    });
    if (!secondReg.ok) {
      return {
        ok: false,
        tmpRepo,
        error: `register second demo failed (${secondReg.status}): ${JSON.stringify(secondReg.body)}`,
      };
    }
    const secondBody = secondReg.body as { id?: string; slug?: string };
    if (!secondBody.id || !secondBody.slug) {
      return {
        ok: false,
        tmpRepo,
        error: `register second demo returned malformed body: ${JSON.stringify(secondReg.body)}`,
      };
    }
    secondId = secondBody.id;

    if (firstBody.id === secondBody.id) {
      return {
        ok: false,
        tmpRepo,
        error: `first and second demo ids collided: ${firstBody.id}`,
      };
    }
    if (firstBody.slug === secondBody.slug) {
      return {
        ok: false,
        tmpRepo,
        error: `first and second demo slugs collided: ${firstBody.slug}`,
      };
    }

    // 3. Both demos must appear in GET /api/flows with the same repoPath.
    const list = await listDemos(url);
    const ours = list.filter((e) => e.repoPath === tmpRepo);
    if (ours.length !== 2) {
      return {
        ok: false,
        tmpRepo,
        error: `expected 2 demos with repoPath=${tmpRepo}, got ${ours.length}`,
      };
    }
    const listedIds = ours.map((e) => e.id).sort();
    const expectedIds = [firstBody.id, secondBody.id].sort();
    if (JSON.stringify(listedIds) !== JSON.stringify(expectedIds)) {
      return {
        ok: false,
        tmpRepo,
        error: `listed ids ${JSON.stringify(listedIds)} != expected ${JSON.stringify(expectedIds)}`,
      };
    }

    // 4. Re-register the SECOND demo: same repoPath + same flowPath. Its id and
    //    slug must be stable, and the FIRST demo's id must NOT change.
    const reReg = await registerDemo({
      repoPath: tmpRepo,
      flowPath: '.seeflow/sample/flow.json',
      url,
    });
    if (!reReg.ok) {
      return {
        ok: false,
        tmpRepo,
        error: `re-register second demo failed (${reReg.status}): ${JSON.stringify(reReg.body)}`,
      };
    }
    const reBody = reReg.body as { id?: string; slug?: string };
    if (reBody.id !== secondBody.id) {
      return {
        ok: false,
        tmpRepo,
        error: `second demo id mutated on re-register: ${secondBody.id} -> ${reBody.id}`,
      };
    }

    const list2 = await listDemos(url);
    const ours2 = list2.filter((e) => e.repoPath === tmpRepo);
    const firstAfter = ours2.find((e) => e.id === firstBody.id);
    if (!firstAfter) {
      return {
        ok: false,
        tmpRepo,
        error: `first demo id ${firstBody.id} disappeared after re-registering second demo`,
      };
    }

    return {
      ok: true,
      tmpRepo,
      firstId: firstBody.id,
      firstSlug: firstBody.slug,
      secondId: secondBody.id,
      secondSlug: secondBody.slug,
    };
  } finally {
    // Best-effort cleanup so repeated smoke runs against a long-lived studio
    // do not accumulate stale registry entries.
    if (firstId) {
      try {
        await unregisterDemo({ id: firstId, url });
      } catch {
        /* ignore — surface only the smoke result */
      }
    }
    if (secondId) {
      try {
        await unregisterDemo({ id: secondId, url });
      } catch {
        /* ignore */
      }
    }
    if (!options.keepTmp) {
      try {
        rmSync(tmpRepo, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export async function main(): Promise<number> {
  const result = await runSmoke();
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      firstId: result.firstId,
      firstSlug: result.firstSlug,
      secondId: result.secondId,
      secondSlug: result.secondSlug,
    })}\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

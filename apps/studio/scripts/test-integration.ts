#!/usr/bin/env bun
// Orchestrator for the studio integration test tier (US-014).
// Runs the bun-test integration suite + Playwright e2e suite, capturing per-run
// artifacts and exit codes, then exits with the worst code so CI fails loudly.
//
// Steps:
//   1. Ensure apps/studio/dist/web/index.html exists and is fresh against
//      apps/web/src (rebuild via `bun run --filter @seeflow/web build` otherwise).
//   2. Generate runId + export SEEFLOW_IT_ARTIFACT_DIR=<repo>/apps/studio/integration/.artifacts/<runId>.
//   3. Run `bun run test:it:bun` (the canonical glob — bun's directory discovery
//      does NOT pick up *.it.ts; see ralph/progress.txt codebase patterns).
//   4. Run `bunx --bun playwright test --config=apps/studio/e2e/playwright.config.ts`.
//      The `--bun` flag forces bun as the runtime so the harness's Bun.spawn
//      calls work inside Playwright workers.
//   5. Write run.json summary to the artifact dir.
//   6. Exit with max(exitCodes) so a single failure in either tier fails the run.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readdir, stat as statAsync } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const STUDIO_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = resolve(STUDIO_DIR, '../..');
const DIST_INDEX = join(STUDIO_DIR, 'dist/web/index.html');
// apps/web bundles @seeflow/canvas inline at build time, so a canvas source
// edit silently leaves the web bundle stale unless we invalidate against it.
const WEB_SRC_ROOTS = [join(REPO_ROOT, 'apps/web/src'), join(REPO_ROOT, 'packages/canvas/src')];
// US-011: mcp-app.e2e.ts loads apps/mcp-app/dist/index.html via the bundle
// fixture and fails its beforeAll guard if the bundle is missing. A fresh
// checkout has nothing in apps/mcp-app/dist/ (the dir is gitignored), so the
// orchestrator must build the bundle before handing off to playwright — same
// freshness contract as the web bundle.
const MCP_APP_DIST_INDEX = join(REPO_ROOT, 'apps/mcp-app/dist/index.html');
const MCP_APP_SRC_ROOTS = [
  join(REPO_ROOT, 'apps/mcp-app/src'),
  join(REPO_ROOT, 'packages/canvas/src'),
];
const ARTIFACT_ROOT = join(STUDIO_DIR, 'integration/.artifacts');
// run-e2e.ts dispatches between native playwright (Linux/CI) and the official
// Playwright Docker image (macOS/Windows dev) so visual baselines compare
// against the same pixels regardless of host.
const E2E_DISPATCHER = join(STUDIO_DIR, 'scripts/run-e2e.ts');

interface StepResult {
  name: string;
  code: number;
  durationMs: number;
}

async function newestMtimeMs(dir: string): Promise<number> {
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = await newestMtimeMs(full);
      if (inner > newest) newest = inner;
    } else {
      const s = await statAsync(full);
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    }
  }
  return newest;
}

interface BundleSpec {
  label: string;
  distIndex: string;
  srcRoots: string[];
  buildFilter: string;
}

async function ensureBundleFresh(spec: BundleSpec): Promise<void> {
  let needsBuild = false;
  let reason = '';
  if (!existsSync(spec.distIndex)) {
    needsBuild = true;
    reason = `${spec.distIndex} missing`;
  } else {
    const distMtime = statSync(spec.distIndex).mtimeMs;
    let newestSrc = 0;
    let newestRoot = '';
    for (const root of spec.srcRoots) {
      const m = await newestMtimeMs(root);
      if (m > newestSrc) {
        newestSrc = m;
        newestRoot = root;
      }
    }
    if (newestSrc > distMtime) {
      needsBuild = true;
      reason = `${newestRoot} newer than ${spec.label} (src=${new Date(newestSrc).toISOString()}, dist=${new Date(distMtime).toISOString()})`;
    }
  }
  if (!needsBuild) {
    console.log(`[orchestrator] ${spec.label} is fresh — skipping rebuild`);
    return;
  }
  console.log(`[orchestrator] Rebuilding ${spec.label} (${reason})`);
  const proc = Bun.spawn({
    cmd: ['bun', 'run', '--filter', spec.buildFilter, 'build'],
    cwd: REPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`[orchestrator] ${spec.label} build failed (exit ${code})`);
    process.exit(code);
  }
}

async function runStep(name: string, cmd: string[]): Promise<StepResult> {
  console.log(`\n[orchestrator] ▶ ${name}: ${cmd.join(' ')}`);
  const started = Date.now();
  const proc = Bun.spawn({
    cmd,
    cwd: REPO_ROOT,
    env: process.env as Record<string, string>,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  const durationMs = Date.now() - started;
  console.log(`[orchestrator] ◀ ${name}: exit=${code} (${(durationMs / 1000).toFixed(2)}s)`);
  return { name, code, durationMs };
}

async function main(): Promise<void> {
  await ensureBundleFresh({
    label: 'dist/web',
    distIndex: DIST_INDEX,
    srcRoots: WEB_SRC_ROOTS,
    buildFilter: '@seeflow/web',
  });
  await ensureBundleFresh({
    label: 'apps/mcp-app/dist',
    distIndex: MCP_APP_DIST_INDEX,
    srcRoots: MCP_APP_SRC_ROOTS,
    buildFilter: '@seeflow/mcp-app',
  });

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ARTIFACT_ROOT, runId);
  mkdirSync(artifactDir, { recursive: true });
  process.env.SEEFLOW_IT_ARTIFACT_DIR = artifactDir;
  console.log(`[orchestrator] runId=${runId}`);
  console.log(`[orchestrator] artifactDir=${artifactDir}`);

  const results: StepResult[] = [];
  results.push(await runStep('bun test (integration)', ['bun', 'run', 'test:it:bun']));
  results.push(await runStep('playwright (e2e)', ['bun', E2E_DISPATCHER]));

  const summary = {
    runId,
    startedAt: new Date(Date.now() - results.reduce((s, r) => s + r.durationMs, 0)).toISOString(),
    finishedAt: new Date().toISOString(),
    artifactDir,
    steps: results,
    exitCode: Math.max(...results.map((r) => r.code)),
  };
  writeFileSync(join(artifactDir, 'run.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n[orchestrator] Summary: ${JSON.stringify(summary, null, 2)}`);
  process.exit(summary.exitCode);
}

await main();

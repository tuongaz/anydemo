#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { resolveStudioUrl } from './studio-config';

export interface RegisterArgs {
  repoPath: string;
  flowPath: string;
  name?: string;
  url?: string;
}

export interface RegisterResult {
  ok: boolean;
  status: number;
  body: unknown;
  url: string;
}

export async function registerDemo(args: RegisterArgs): Promise<RegisterResult> {
  const url = args.url ?? resolveStudioUrl();
  const payload: Record<string, unknown> = {
    repoPath: args.repoPath,
    flowPath: args.flowPath,
  };
  if (typeof args.name === 'string' && args.name.length > 0) payload.name = args.name;

  const res = await globalThis.fetch(`${url}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    try {
      body = await res.text();
    } catch {
      body = null;
    }
  }
  return { ok: res.ok, status: res.status, body, url };
}

function flagValue(argv: string[], name: string): string | undefined {
  const flag = `--${name}`;
  const eqArg = argv.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(`${flag}=`.length);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

function readNameFromFlowFile(repoPath: string, flowPath: string): string | undefined {
  const fullPath = isAbsolute(flowPath) ? flowPath : join(repoPath, flowPath);
  if (!existsSync(fullPath)) return undefined;
  try {
    const raw = readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

export async function main(argv: string[]): Promise<number> {
  const repoPathArg = flagValue(argv, 'path');
  const demoPathArg = flagValue(argv, 'flow');
  if (!repoPathArg || !demoPathArg) {
    process.stderr.write('Usage: register.ts --path <repoPath> --flow <flowPath>\n');
    return 1;
  }
  const repoPath = resolve(repoPathArg);
  const flowPath = demoPathArg;
  const name = readNameFromFlowFile(repoPath, flowPath);

  const result = await registerDemo({ repoPath, flowPath, name });
  if (!result.ok) {
    const text =
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null);
    process.stderr.write(`${text}\n`);
    return 1;
  }
  const data = (result.body ?? {}) as { id?: string; slug?: string };
  process.stdout.write(`${JSON.stringify({ id: data.id, slug: data.slug })}\n`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

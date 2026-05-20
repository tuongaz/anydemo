#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { resolveStudioUrl } from './studio-config';

export interface ValidateArgs {
  flow: unknown;
  style?: unknown;
  url?: string;
}

export interface ValidateResult {
  ok: boolean;
  status: number;
  body: unknown;
  issues: unknown[];
  url: string;
}

export async function validateFlow(args: ValidateArgs): Promise<ValidateResult> {
  const url = args.url ?? resolveStudioUrl();
  const payload: Record<string, unknown> = { flow: args.flow };
  if (args.style !== undefined) payload.style = args.style;

  const res = await globalThis.fetch(`${url}/api/validate`, {
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
  const bodyObj = (body ?? {}) as { ok?: unknown; issues?: unknown };
  const ok = res.ok && bodyObj.ok === true;
  const issues = Array.isArray(bodyObj.issues) ? bodyObj.issues : [];
  return { ok, status: res.status, body, issues, url };
}

function flagValue(argv: string[], name: string): string | undefined {
  const flag = `--${name}`;
  const eqArg = argv.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(`${flag}=`.length);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

function readJsonFile(path: string): unknown {
  const abs = isAbsolute(path) ? path : resolve(path);
  if (!existsSync(abs)) {
    throw new Error(`file not found: ${abs}`);
  }
  return JSON.parse(readFileSync(abs, 'utf8'));
}

export async function main(argv: string[]): Promise<number> {
  const flowPath = flagValue(argv, 'flow');
  const stylePath = flagValue(argv, 'style');
  if (!flowPath) {
    process.stderr.write('Usage: validate.ts --flow <flow.json> [--style <style.json>]\n');
    return 1;
  }

  let flow: unknown;
  let style: unknown;
  try {
    flow = readJsonFile(flowPath);
    if (stylePath) style = readJsonFile(stylePath);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  const result = await validateFlow({ flow, style });
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify(result.issues, null, 2)}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

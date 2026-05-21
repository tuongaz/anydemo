import { readFileSync } from 'node:fs';

export interface BodySource {
  json: string | undefined;
  file: string | undefined;
  stdin: boolean;
}

export type StdinReader = () => Promise<string>;

export async function loadBody(src: BodySource, readStdin: StdinReader): Promise<unknown> {
  const sources = [src.json !== undefined, src.file !== undefined, src.stdin].filter(
    Boolean,
  ).length;
  if (sources !== 1) {
    throw new Error('Provide exactly one of --json, --file, --stdin');
  }

  let raw: string;
  let label: string;
  if (src.json !== undefined) {
    raw = src.json;
    label = '--json';
  } else if (src.file !== undefined) {
    raw = readFileSync(src.file, 'utf8');
    label = src.file;
  } else {
    raw = await readStdin();
    label = '<stdin>';
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON from ${label}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface CliOutcomeOptions {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  exit?: (code: number) => never;
}

export function printOk(payload: unknown, opts: CliOutcomeOptions = {}): never {
  const out = opts.stdout ?? ((s) => process.stdout.write(s));
  out(`${JSON.stringify({ ok: true, ...(payload as object) })}\n`);
  return (opts.exit ?? (process.exit as (code: number) => never))(0);
}

export function printError(message: string, opts: CliOutcomeOptions = {}): never {
  const err = opts.stderr ?? ((s) => process.stderr.write(s));
  err(`${message}\n`);
  return (opts.exit ?? (process.exit as (code: number) => never))(1);
}

export const drainStdin: StdinReader = async () => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

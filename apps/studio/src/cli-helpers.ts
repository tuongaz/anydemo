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

/**
 * Print an Operations Outcome and exit with the differentiated exit code:
 *  - kind === 'ok'                → printOk(data), exit 0
 *  - kind === 'badSchema'|'badJson'                   → exit 2
 *  - kind === 'notFound'|'flowNotFound'|'fileNotFound'|
 *             'unknownNode'|'unknownConnector'        → exit 3
 *  - kind === 'duplicateIdInBatch'|'idAlreadyExists'  → exit 4
 *  - kind === 'writeFailed'|'sdkWriteFailed'|'scaffoldFailed' → exit 5
 *  - anything else                                    → exit 1
 *
 * The error message mirrors the strings used by api.ts so the CLI's
 * stderr output stays stable across the HTTP-to-in-process migration.
 */
export function printOutcome<T extends { kind: string }>(
  outcome: T,
  opts: CliOutcomeOptions = {},
): never {
  if (outcome.kind === 'ok') {
    const data = (outcome as unknown as { data: unknown }).data;
    return printOk(
      data && typeof data === 'object' && !Array.isArray(data) ? data : { data },
      opts,
    );
  }
  const err = opts.stderr ?? ((s) => process.stderr.write(s));
  const message = describeOutcome(outcome);
  err(`${JSON.stringify({ error: message, code: outcome.kind })}\n`);
  return (opts.exit ?? (process.exit as (code: number) => never))(exitCodeForKind(outcome.kind));
}

function describeOutcome(outcome: { kind: string } & Record<string, unknown>): string {
  switch (outcome.kind) {
    case 'notFound':
    case 'flowNotFound':
      return 'not found';
    case 'fileNotFound':
      return `Flow file not found: ${String(outcome.path ?? '')}`;
    case 'unknownNode':
      return `Unknown nodeId: ${String(outcome.nodeId ?? '')}`;
    case 'unknownConnector':
      return `Unknown connectorId: ${String(outcome.connectorId ?? '')}`;
    case 'badJson':
      return `Flow file is not valid JSON: ${String(outcome.detail ?? outcome.message ?? '')}`;
    case 'badSchema':
      return `Flow failed schema validation: ${JSON.stringify(outcome.issues ?? [])}`;
    case 'duplicateIdInBatch': {
      // `collection` is present on the FlowBulk outcome ('nodes' | 'connectors')
      // and absent on legacy singular outcomes — keep both shapes working.
      const collection = outcome.collection;
      const prefix =
        collection === 'nodes' || collection === 'connectors'
          ? `Duplicate ${collection} id in batch`
          : 'Duplicate id in batch';
      return `${prefix}: ${String(outcome.id ?? '')}`;
    }
    case 'idAlreadyExists': {
      const collection = outcome.collection;
      const prefix =
        collection === 'nodes'
          ? 'Node id already exists'
          : collection === 'connectors'
            ? 'Connector id already exists'
            : 'Id already exists';
      return `${prefix}: ${String(outcome.id ?? '')}`;
    }
    case 'writeFailed':
      return `Failed to write demo file: ${String(outcome.message ?? '')}`;
    case 'sdkWriteFailed':
      return `Failed to write SDK helper: ${String(outcome.message ?? '')}`;
    case 'scaffoldFailed':
      return `Failed to scaffold project: ${String(outcome.message ?? '')}`;
    default:
      return String(outcome.message ?? outcome.kind);
  }
}

export const EXIT_CODE_BY_KIND: Record<string, number> = {
  badSchema: 2,
  badJson: 2,
  notFound: 3,
  flowNotFound: 3,
  fileNotFound: 3,
  unknownNode: 3,
  unknownConnector: 3,
  duplicateIdInBatch: 4,
  idAlreadyExists: 4,
  writeFailed: 5,
  sdkWriteFailed: 5,
  scaffoldFailed: 5,
};

export function exitCodeForKind(kind: string): number {
  return EXIT_CODE_BY_KIND[kind] ?? 1;
}

export const drainStdin: StdinReader = async () => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

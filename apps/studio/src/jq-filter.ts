// Minimal jq-style path filter for `seeflow schema --jq <filter>`. Path
// subset only: identity, field access (`.foo.bar`), bracket access
// (`.["foo"]`, `.[3]`), iteration (`.[]`), optional (`?`), and pipe (`|`).
// No comma, no `length`, no functions — keep the surface tight so behaviour
// matches the real jq tool for the subset we do support. Throws JqError on
// parse failures and on type errors that the trailing `?` did not suppress.

export class JqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JqError';
  }
}

type Step =
  | { kind: 'field'; name: string; optional: boolean }
  | { kind: 'index'; index: number; optional: boolean }
  | { kind: 'key'; key: string; optional: boolean }
  | { kind: 'iter'; optional: boolean };

type Term = Step[];
type Filter = Term[];

const isIdentStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
const isIdent = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);

function parseFilter(src: string): Filter {
  const input = src;
  let i = 0;
  const len = input.length;

  const skipSpace = (): void => {
    while (i < len && /\s/.test(input[i] as string)) i++;
  };

  const expect = (ch: string): void => {
    if (input[i] !== ch) {
      throw new JqError(
        `Expected '${ch}' at position ${i} in filter '${src}' (got '${input[i] ?? '<end>'}')`,
      );
    }
    i++;
  };

  const parseString = (): string => {
    const quote = input[i];
    if (quote !== '"' && quote !== "'") {
      throw new JqError(`Expected string at position ${i} in filter '${src}'`);
    }
    i++;
    let out = '';
    while (i < len && input[i] !== quote) {
      const ch = input[i] as string;
      if (ch === '\\') {
        const next = input[i + 1];
        if (next === undefined) throw new JqError(`Unterminated escape in filter '${src}'`);
        out += next;
        i += 2;
        continue;
      }
      out += ch;
      i++;
    }
    if (input[i] !== quote) throw new JqError(`Unterminated string in filter '${src}'`);
    i++;
    return out;
  };

  const parseNumber = (): number => {
    const start = i;
    if (input[i] === '-') i++;
    while (i < len && /[0-9]/.test(input[i] as string)) i++;
    const raw = input.slice(start, i);
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      throw new JqError(`Invalid number '${raw}' at position ${start} in filter '${src}'`);
    }
    return n;
  };

  const parseOptional = (): boolean => {
    if (input[i] === '?') {
      i++;
      return true;
    }
    return false;
  };

  const parseTerm = (): Term => {
    skipSpace();
    if (input[i] !== '.') {
      throw new JqError(
        `Filter term must start with '.' at position ${i} in filter '${src}' (got '${input[i] ?? '<end>'}')`,
      );
    }
    i++;
    const steps: Step[] = [];
    // `.` followed by ident, `[`, or end/operator → first step.
    while (i < len) {
      const ch = input[i] as string;
      if (ch === '.') {
        // Chained field: ".foo.bar" — consume the dot and read ident.
        i++;
        if (i >= len || !isIdentStart(input[i] as string)) {
          throw new JqError(`Expected identifier after '.' at position ${i} in filter '${src}'`);
        }
        const start = i;
        while (i < len && isIdent(input[i] as string)) i++;
        const name = input.slice(start, i);
        const optional = parseOptional();
        steps.push({ kind: 'field', name, optional });
      } else if (isIdentStart(ch)) {
        // First step right after leading '.', e.g. ".foo".
        if (steps.length > 0) {
          throw new JqError(`Unexpected identifier at position ${i} in filter '${src}'`);
        }
        const start = i;
        while (i < len && isIdent(input[i] as string)) i++;
        const name = input.slice(start, i);
        const optional = parseOptional();
        steps.push({ kind: 'field', name, optional });
      } else if (ch === '[') {
        i++;
        skipSpace();
        if (input[i] === ']') {
          i++;
          const optional = parseOptional();
          steps.push({ kind: 'iter', optional });
        } else if (input[i] === '"' || input[i] === "'") {
          const key = parseString();
          skipSpace();
          expect(']');
          const optional = parseOptional();
          steps.push({ kind: 'key', key, optional });
        } else if (input[i] === '-' || /[0-9]/.test(input[i] ?? '')) {
          const index = parseNumber();
          skipSpace();
          expect(']');
          const optional = parseOptional();
          steps.push({ kind: 'index', index, optional });
        } else {
          throw new JqError(`Expected index, string, or ']' at position ${i} in filter '${src}'`);
        }
      } else {
        break;
      }
    }
    return steps;
  };

  const terms: Term[] = [];
  skipSpace();
  terms.push(parseTerm());
  skipSpace();
  while (i < len) {
    if (input[i] !== '|') {
      throw new JqError(`Unexpected character '${input[i]}' at position ${i} in filter '${src}'`);
    }
    i++;
    skipSpace();
    terms.push(parseTerm());
    skipSpace();
  }
  if (terms.length === 0) {
    throw new JqError(`Empty filter '${src}'`);
  }
  return terms;
}

function evaluateStep(step: Step, value: unknown): unknown[] {
  if (step.kind === 'field') {
    if (value === null || value === undefined) {
      if (step.optional) return [];
      return [null];
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      if (step.optional) return [];
      throw new JqError(
        `Cannot index ${describeType(value)} with field '${step.name}' (use '?' to suppress)`,
      );
    }
    const obj = value as Record<string, unknown>;
    return [Object.hasOwn(obj, step.name) ? obj[step.name] : null];
  }
  if (step.kind === 'key') {
    if (value === null || value === undefined) {
      if (step.optional) return [];
      return [null];
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      if (step.optional) return [];
      throw new JqError(
        `Cannot index ${describeType(value)} with key "${step.key}" (use '?' to suppress)`,
      );
    }
    const obj = value as Record<string, unknown>;
    return [Object.hasOwn(obj, step.key) ? obj[step.key] : null];
  }
  if (step.kind === 'index') {
    if (value === null || value === undefined) {
      if (step.optional) return [];
      return [null];
    }
    if (!Array.isArray(value)) {
      if (step.optional) return [];
      throw new JqError(
        `Cannot index ${describeType(value)} with number ${step.index} (use '?' to suppress)`,
      );
    }
    const idx = step.index < 0 ? value.length + step.index : step.index;
    return [idx >= 0 && idx < value.length ? value[idx] : null];
  }
  // iter
  if (value === null || value === undefined) {
    if (step.optional) return [];
    throw new JqError(`Cannot iterate over ${describeType(value)} (use '?' to suppress)`);
  }
  if (Array.isArray(value)) return [...value];
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>);
  if (step.optional) return [];
  throw new JqError(`Cannot iterate over ${describeType(value)} (use '?' to suppress)`);
}

function evaluateTerm(term: Term, input: unknown): unknown[] {
  let stream: unknown[] = [input];
  for (const step of term) {
    const next: unknown[] = [];
    for (const v of stream) {
      for (const out of evaluateStep(step, v)) next.push(out);
    }
    stream = next;
  }
  return stream;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function applyJq(input: unknown, filterStr: string): unknown[] {
  const filter = parseFilter(filterStr);
  let stream: unknown[] = [input];
  for (const term of filter) {
    const next: unknown[] = [];
    for (const v of stream) {
      for (const out of evaluateTerm(term, v)) next.push(out);
    }
    stream = next;
  }
  return stream;
}

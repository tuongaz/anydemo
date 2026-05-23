// Component action script for the e2e "Counter" demo. Reads a JSON payload
// from stdin and writes a JSON stdout patch that bumps the counter by one.
// The studio's runComponentAction (apps/studio/src/component-action-runner.ts)
// pipes payload via stdin, captures stdout, and merges the parsed object into
// the canvas runtime's state (keys are JSON Pointers).
//
// The catalog Button impl currently invokes `onClick` with no payload, so the
// canvas dispatch sends `{}` over the wire. We treat a missing `from` as 0 so
// the script stays observable end-to-end regardless of caller payload shape.
//
// `export {}` makes this file a module so top-level await typechecks.

export {};

const text = (await Bun.stdin.text()).trim();
const payload: unknown = text ? JSON.parse(text) : {};
const from =
  payload && typeof payload === 'object' && typeof (payload as { from?: unknown }).from === 'number'
    ? (payload as { from: number }).from
    : 0;
process.stdout.write(JSON.stringify({ '/count': from + 1 }));

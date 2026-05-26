// Component action for the showcase "Random Stats" node. The studio's
// runComponentAction (apps/studio/src/component-action-runner.ts) spawns
// this file with `bun`, pipes the click payload to stdin, and merges the
// JSON object on stdout into the canvas runtime's state (keys are JSON
// Pointers — see ComponentRuntime in packages/canvas/src/nodes/).
//
// `export {}` makes the file a module so top-level await typechecks.

export {};

await Bun.stdin.text();

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const cpu = randInt(15, 95);
const memory = randInt(40, 90);

const notes = [
  `_Sampled at ${new Date().toLocaleTimeString()}_`,
  '',
  `- **CPU**: ${cpu}%`,
  `- **Memory**: ${memory}%`,
  '',
  'Click Refresh again to fetch a new sample.',
].join('\n');

process.stdout.write(
  JSON.stringify({
    '/cpu': cpu,
    '/memory': memory,
    '/notes': notes,
  }),
);

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// US-015 regression fence (refined by US-004): a single handle (any of
// 't' / 'l' / 'r' / 'b' on any node type) must accept unlimited inbound AND
// outbound connections, and onConnect must NOT reject a new connection
// because a handle is already used. React Flow exposes two opt-in mechanisms
// that would silently re-introduce a per-handle limit:
//   • <Handle connectionLimit={N}> — caps connections per handle
//   • <ReactFlow isValidConnection={fn}> — vetoes connections at gesture time
// `connectionLimit` is forbidden everywhere. `isValidConnection` is forbidden
// in the per-node renderers (where adding it would re-introduce per-node
// count gating); demo-canvas.tsx is allowed to use it ONLY for node-type-
// level rejection — US-004 wires it to reject text-shape endpoints (pure
// annotations are never connectable). The text-only invariant is verified
// positively by the US-004 runtime tests in demo-canvas.test.tsx.
const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
const noConnectionLimit = [
  'packages/canvas/src/nodes/shape-node.tsx',
  'packages/canvas/src/nodes/play-node.tsx',
  'packages/canvas/src/nodes/state-node.tsx',
  'packages/canvas/src/nodes/icon-node.tsx',
  'packages/canvas/src/nodes/image-node.tsx',
  'apps/web/src/components/demo-canvas.tsx',
];
const noIsValidConnection = [
  'packages/canvas/src/nodes/shape-node.tsx',
  'packages/canvas/src/nodes/play-node.tsx',
  'packages/canvas/src/nodes/state-node.tsx',
  'packages/canvas/src/nodes/icon-node.tsx',
  'packages/canvas/src/nodes/image-node.tsx',
];

describe('US-015: no per-handle connection limit', () => {
  for (const rel of noConnectionLimit) {
    it(`${rel} does not set connectionLimit`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf-8');
      expect(src).not.toMatch(/\bconnectionLimit\b/);
    });
  }
  for (const rel of noIsValidConnection) {
    it(`${rel} does not set isValidConnection`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf-8');
      expect(src).not.toMatch(/\bisValidConnection\b/);
    });
  }
});

// US-025: every custom node renderer must forward NodeProps.isConnectable to
// every <Handle> so the per-node `connectable: false` set in demo-canvas
// buildNode actually gates connection-start. xyflow's Handle defaults
// `isConnectable = true` — if a renderer omits the prop, the Handle stays
// hit-testable as a connection origin regardless of node.connectable, defeating
// the gate. Static-text fence on each renderer source is sufficient; any new
// custom node added to this list inherits the same check.
const nodeRenderers = [
  'packages/canvas/src/nodes/shape-node.tsx',
  'packages/canvas/src/nodes/play-node.tsx',
  'packages/canvas/src/nodes/state-node.tsx',
  'packages/canvas/src/nodes/icon-node.tsx',
  'packages/canvas/src/nodes/image-node.tsx',
];

describe('US-025: nodes forward isConnectable to every <Handle>', () => {
  for (const rel of nodeRenderers) {
    it(`${rel} destructures isConnectable from NodeProps and forwards to all Handles`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf-8');
      // Verify the renderer reads isConnectable off NodeProps.
      expect(src).toMatch(/\bisConnectable\b\s*[,}]/);
      // Verify every JSX <Handle ...> declaration includes isConnectable=.
      // Match only opening tags followed by whitespace (newline or space) —
      // avoids the `<Handle>` reference in prose comments. Count those and
      // ensure the prop-count matches.
      const handleOpens = src.match(/<Handle\s/g) ?? [];
      const isConnectableProps = src.match(/\bisConnectable=\{/g) ?? [];
      expect(isConnectableProps.length).toBe(handleOpens.length);
    });
  }
});

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitFlow } from '../src/merge.ts';
import { FlowSchema, ResolvedFlowSchema, StyleSchema } from '../src/schema.ts';

// PRD US-012 said FlowSchema.parse(...) but the fixture contains {x,y}
// positions (PRD acceptance criterion: "deterministic ids and {x,y} positions
// on a 2-column grid"). FlowSchema is strict() and rejects `position`, so the
// authoring schema for a single-file fixture is ResolvedFlowSchema. The
// playwright studio-fixture uses `splitFlow` to write FlowSchema-compliant
// flow.json + StyleSchema-compliant style.json — this test also asserts that
// split form parses cleanly so the fixture stays usable end-to-end.
const FIXTURE_PATH = resolve(import.meta.dir, 'fixtures/kitchen-sink.flow.json');
const NOOP_SCRIPT_PATH = resolve(import.meta.dir, 'fixtures/scripts/noop.ts');

describe('integration: fixtures — kitchen-sink', () => {
  it('parses as a ResolvedFlow with 6 nodes (one of each type) + 4 connectors covering every kind', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const parsed = ResolvedFlowSchema.parse(raw);

    expect(parsed.nodes).toHaveLength(6);
    const nodeTypes = parsed.nodes.map((n) => n.type).sort();
    expect(nodeTypes).toEqual([
      'htmlNode',
      'iconNode',
      'imageNode',
      'playNode',
      'shapeNode',
      'stateNode',
    ]);

    expect(parsed.connectors).toHaveLength(4);
  });

  it('splits into FlowSchema-compliant flow.json + StyleSchema-compliant style.json', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const resolved = ResolvedFlowSchema.parse(raw);
    const { flow, style } = splitFlow(resolved);

    expect(() => FlowSchema.parse(flow)).not.toThrow();
    expect(() => StyleSchema.parse(style)).not.toThrow();
  });

  it('playNode scriptPath resolves to the bundled noop.ts script', () => {
    expect(existsSync(NOOP_SCRIPT_PATH)).toBe(true);
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const parsed = ResolvedFlowSchema.parse(raw);
    const playNode = parsed.nodes.find((n) => n.type === 'playNode');
    expect(playNode).toBeDefined();
    if (playNode && playNode.type === 'playNode') {
      expect(playNode.data.playAction.scriptPath).toBe('scripts/noop.ts');
    }
  });
});

import { describe, expect, it } from 'bun:test';
import {
  FlowSchema,
  HtmlNodeDataSchema,
  ResolvedFlowSchema,
  StatusReportSchema,
  StyleSchema,
} from './schema.ts';

const fixturePath = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;

const readFixture = async (name: string): Promise<unknown> =>
  await Bun.file(fixturePath(name)).json();

describe('ResolvedFlowSchema', () => {
  it('parses a valid demo fixture', async () => {
    const data = await readFixture('valid-demo.json');
    const result = ResolvedFlowSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected valid fixture to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.data.version).toBe(2);
    expect(result.data.name).toBe('Checkout flow');
    expect(result.data.nodes).toHaveLength(2);
    expect(result.data.connectors).toHaveLength(1);
    const connector = result.data.connectors[0];
    expect(connector?.eventName).toBe('checkout.created');
    expect(connector?.label).toBe('publishes checkout.created');
  });

  it('rejects an invalid demo fixture with a usable Zod error', async () => {
    const data = await readFixture('invalid-demo.json');
    const result = ResolvedFlowSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.length).toBeGreaterThan(0);

    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    expect(message.length).toBeGreaterThan(0);

    const nameIssue = result.error.issues.find(
      (issue) => issue.path.length === 1 && issue.path[0] === 'name',
    );
    expect(nameIssue).toBeDefined();
  });

  it('rejects an invalid-demo-connector fixture (connector references missing nodeId)', async () => {
    const data = await readFixture('invalid-demo-connector.json');
    const result = ResolvedFlowSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;

    const targetIssue = result.error.issues.find(
      (i) =>
        i.path.length === 3 &&
        i.path[0] === 'connectors' &&
        i.path[1] === 0 &&
        i.path[2] === 'target',
    );
    expect(targetIssue).toBeDefined();
    expect(targetIssue?.message).toContain('ghost-node');
  });

  it('parses connectors with arbitrary metadata combinations (method/url/eventName/queueName)', () => {
    const demo = {
      version: 2 as const,
      name: 'connector-metadata',
      nodes: [
        {
          id: 'a',
          type: 'playNode' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'A',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            playAction: {
              kind: 'script' as const,
              interpreter: 'bun',
              scriptPath: 'scripts/play.ts',
            },
          },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'c',
          type: 'stateNode' as const,
          position: { x: 200, y: 0 },
          data: { name: 'C', kind: 'worker', stateSource: { kind: 'event' as const } },
        },
        {
          id: 'd',
          type: 'stateNode' as const,
          position: { x: 300, y: 0 },
          data: { name: 'D', kind: 'worker', stateSource: { kind: 'event' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          method: 'POST' as const,
          url: 'http://b/',
          label: 'calls B',
        },
        { id: 'c2', source: 'a', target: 'c', eventName: 'a.published' },
        { id: 'c3', source: 'a', target: 'd', queueName: 'work-queue' },
      ],
    };

    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
    expect(result.data.connectors[0]?.url).toBe('http://b/');
    expect(result.data.connectors[1]?.eventName).toBe('a.published');
    expect(result.data.connectors[2]?.queueName).toBe('work-queue');
  });

  it('round-trips a shapeNode with each shape variant', () => {
    // US-009 extended ShapeKind with `database` — the first illustrative
    // shape. The enum now drives both the schema validation here and the
    // per-shape renderer dispatch in apps/web's shape-node.tsx.
    const make = (
      shape:
        | 'rectangle'
        | 'ellipse'
        | 'sticky'
        | 'database'
        | 'server'
        | 'user'
        | 'queue'
        | 'cloud',
    ) => ({
      version: 2 as const,
      name: 'shape-demo',
      nodes: [
        {
          id: `shape-${shape}`,
          type: 'shapeNode' as const,
          position: { x: 10, y: 20 },
          data: { shape, name: `${shape} note` },
        },
      ],
      connectors: [],
    });

    for (const shape of [
      'rectangle',
      'ellipse',
      'sticky',
      'database',
      'server',
      'user',
      'queue',
      'cloud',
    ] as const) {
      const result = ResolvedFlowSchema.safeParse(make(shape));
      if (!result.success) {
        throw new Error(
          `expected ${shape} shapeNode to parse, got: ${JSON.stringify(result.error.issues)}`,
        );
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'shapeNode') throw new Error('expected shapeNode');
      expect(node.data.shape).toBe(shape);
      expect(node.data.name).toBe(`${shape} note`);
    }
  });

  it('accepts a shapeNode with shape=database and no label (US-009 illustrative)', () => {
    const demo = {
      version: 2 as const,
      name: 'db-shape',
      nodes: [
        {
          id: 'db-1',
          type: 'shapeNode' as const,
          position: { x: 0, y: 0 },
          data: { shape: 'database' as const },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(
        `expected database shapeNode to parse, got: ${JSON.stringify(result.error.issues)}`,
      );
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'shapeNode') throw new Error('expected shapeNode');
    expect(node.data.shape).toBe('database');
  });

  it('accepts a shapeNode without an optional label', () => {
    const demo = {
      version: 2 as const,
      name: 'no-label-shape',
      nodes: [
        {
          id: 'shape-1',
          type: 'shapeNode' as const,
          position: { x: 0, y: 0 },
          data: { shape: 'rectangle' as const },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    expect(result.success).toBe(true);
  });

  it('rejects a shapeNode with an unknown shape variant', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-shape',
      nodes: [
        {
          id: 'shape-1',
          type: 'shapeNode' as const,
          position: { x: 0, y: 0 },
          data: { shape: 'triangle' },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    expect(result.success).toBe(false);
  });

  it('accepts node visual fields (width/height/borderColor/backgroundColor) on every node type', () => {
    const demo = {
      version: 2 as const,
      name: 'visual-fields',
      nodes: [
        {
          id: 'p',
          type: 'playNode' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'P',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            playAction: {
              kind: 'script' as const,
              interpreter: 'bun',
              scriptPath: 'scripts/play.ts',
            },
            width: 200,
            height: 80,
            borderColor: 'blue' as const,
            backgroundColor: 'amber' as const,
          },
        },
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: {
            name: 'S',
            kind: 'worker',
            stateSource: { kind: 'event' as const },
            width: 160,
            height: 60,
          },
        },
        {
          id: 'shape-1',
          type: 'shapeNode' as const,
          position: { x: 200, y: 0 },
          data: {
            shape: 'sticky' as const,
            width: 240,
            height: 140,
            borderColor: 'amber' as const,
            backgroundColor: 'amber' as const,
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.nodes).toHaveLength(3);
  });

  it('accepts nodes that omit the new visual fields entirely (backwards compatible)', () => {
    const demo = {
      version: 2 as const,
      name: 'no-visual-fields',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'S', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
  });

  it('rejects width/height that are zero or negative', () => {
    const demo = (width: number, height: number) => ({
      version: 2 as const,
      name: 'bad-size',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'S',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            width,
            height,
          },
        },
      ],
      connectors: [],
    });
    expect(ResolvedFlowSchema.safeParse(demo(0, 80)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(demo(-1, 80)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(demo(120, 0)).success).toBe(false);
  });

  it('rejects an invalid color token (only enum values allowed)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-color',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'S',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            borderColor: 'fuchsia',
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path.includes('borderColor') && i.path.includes('data'),
    );
    expect(issue).toBeDefined();
  });

  it('round-trips a default connector with no semantic payload', () => {
    const demo = {
      version: 2 as const,
      name: 'default-conn',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', label: 'see also' }],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    expect(conn?.label).toBe('see also');
  });

  it('accepts connector visual fields (style/color/direction) on every kind', () => {
    const demo = {
      version: 2 as const,
      name: 'visual-connectors',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          method: 'POST' as const,
          url: 'http://b/',
          style: 'dashed' as const,
          color: 'blue' as const,
          direction: 'forward' as const,
        },
        {
          id: 'c2',
          source: 'a',
          target: 'b',
          eventName: 'a.b',
          style: 'solid' as const,
          direction: 'both' as const,
        },
        {
          id: 'c3',
          source: 'a',
          target: 'b',
          color: 'amber' as const,
          direction: 'backward' as const,
        },
      ],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
  });

  it('round-trips optional sourceHandle/targetHandle on connectors (US-013)', () => {
    const demo = {
      version: 2 as const,
      name: 'connector-handles',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          sourceHandle: 'b',
          targetHandle: 't',
        },
      ],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    expect(conn?.sourceHandle).toBe('b');
    expect(conn?.targetHandle).toBe('t');
  });

  it('parses connectors authored without handle ids (back-compat for US-013)', () => {
    const demo = {
      version: 2 as const,
      name: 'no-handles',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b' }],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    expect(conn?.sourceHandle).toBeUndefined();
    expect(conn?.targetHandle).toBeUndefined();
  });

  it('round-trips optional sourcePin/targetPin on connectors (US-006)', () => {
    const demo = {
      version: 2 as const,
      name: 'connector-pins',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          sourcePin: { side: 'right' as const, t: 0.25 },
          targetPin: { side: 'left' as const, t: 0.75 },
        },
      ],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    expect(conn?.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(conn?.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('parses connectors authored without sourcePin/targetPin (back-compat for US-006)', () => {
    const demo = {
      version: 2 as const,
      name: 'no-pins',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b' }],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    expect(conn?.sourcePin).toBeUndefined();
    expect(conn?.targetPin).toBeUndefined();
  });

  it('rejects a pin with an unknown side (US-006)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-pin-side',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          sourcePin: { side: 'diagonal', t: 0.5 },
        },
      ],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects a pin with t outside [0, 1] (US-006)', () => {
    const make = (t: unknown) => ({
      version: 2 as const,
      name: 'bad-pin-t',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          sourcePin: { side: 'top' as const, t },
        },
      ],
    });
    expect(ResolvedFlowSchema.safeParse(make(-0.1)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(1.1)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(0)).success).toBe(true);
    expect(ResolvedFlowSchema.safeParse(make(1)).success).toBe(true);
  });

  it('rejects an invalid connector style value', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-style',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', style: 'wavy' }],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an invalid connector direction value', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-dir',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', direction: 'sideways' }],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an invalid connector color token', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-color',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', color: 'fuchsia' }],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('accepts a positive borderSize on nodes and connectors, rejects 0/negative', () => {
    const make = (nodeBorderSize: unknown, connBorderSize: unknown) => ({
      version: 2 as const,
      name: 'border-size',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'A',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            borderSize: nodeBorderSize,
          },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'a',
          target: 'b',
          borderSize: connBorderSize,
        },
      ],
    });

    // node borderSize: 3, connector borderSize: 4 — both accepted.
    const ok = ResolvedFlowSchema.safeParse(make(3, 4));
    if (!ok.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(ok.error.issues)}`);
    }
    const node = ok.data.nodes[0];
    if (node?.type !== 'stateNode') throw new Error('expected stateNode');
    expect(node.data.borderSize).toBe(3);
    expect(ok.data.connectors[0]?.borderSize).toBe(4);

    // 0 and negative values rejected (positive constraint).
    expect(ResolvedFlowSchema.safeParse(make(0, 4)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(-2, 4)).success).toBe(false);
  });

  it('accepts cornerRadius=12 and cornerRadius=0 on a node, rejects negative values (US-001)', () => {
    const make = (cornerRadius: unknown) => ({
      version: 2 as const,
      name: 'corner-radius',
      nodes: [
        {
          id: 'p',
          type: 'playNode' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'P',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            playAction: {
              kind: 'script' as const,
              interpreter: 'bun',
              scriptPath: 'scripts/play.ts',
            },
            cornerRadius,
          },
        },
      ],
      connectors: [],
    });

    const ok12 = ResolvedFlowSchema.safeParse(make(12));
    if (!ok12.success) {
      throw new Error(
        `expected cornerRadius=12 to parse, got: ${JSON.stringify(ok12.error.issues)}`,
      );
    }
    const node12 = ok12.data.nodes[0];
    if (node12?.type !== 'playNode') throw new Error('expected playNode');
    expect(node12.data.cornerRadius).toBe(12);

    const ok0 = ResolvedFlowSchema.safeParse(make(0));
    if (!ok0.success) {
      throw new Error(`expected cornerRadius=0 to parse, got: ${JSON.stringify(ok0.error.issues)}`);
    }

    expect(ResolvedFlowSchema.safeParse(make(-5)).success).toBe(false);
  });

  // US-004: ImageNodeDataSchema hard-cut from a `data:image/...` URL to a
  // relative `path` under `<project>/.seeflow/`. The renderer resolves it via
  // the file-serving endpoint added in US-001. Path-safety:
  // no absolute paths, no `..` traversal, no leading slash.
  it('parses a demo containing one imageNode with data.path (US-004)', () => {
    const demo = {
      version: 2 as const,
      name: 'image-demo',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 10, y: 20 },
          data: {
            path: 'nodes/img-1/pixel.png',
            alt: 'pixel',
            width: 200,
            height: 150,
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'imageNode') throw new Error('expected imageNode');
    expect(node.data.path).toBe('nodes/img-1/pixel.png');
    expect(node.data.alt).toBe('pixel');
  });

  it('rejects an imageNode whose data carries the legacy `image` key (US-004 hard-cut)', () => {
    // The pre-US-004 schema accepted `data.image` as a base64 data URL. After
    // the hard-cut, `image` is an unknown key and `path` is required — the
    // result is that the schema rejects the legacy payload, with no compat
    // layer.
    const demo = {
      version: 2 as const,
      name: 'legacy-image',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { image: 'data:image/png;base64,iVBORw0KGgo=' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an imageNode whose path is absolute (US-004)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-image-abs',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { path: '/etc/passwd' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an imageNode whose path uses `..` traversal (US-004)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-image-traversal',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { path: '../../etc/passwd' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an imageNode whose path is outside its nodes/<id>/ folder', () => {
    const result = ResolvedFlowSchema.safeParse({
      version: 2 as const,
      name: 'wrong-folder',
      nodes: [
        {
          id: 'node-abc',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { path: 'assets/foo.png' },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts an imageNode whose path is under its own nodes/<id>/ folder', () => {
    const result = ResolvedFlowSchema.safeParse({
      version: 2 as const,
      name: 'good-folder',
      nodes: [
        {
          id: 'node-abc',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { path: 'nodes/node-abc/foo.png' },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(true);
  });

  // US-014: image nodes gain an optional `borderWidth` (1–8). `borderColor`
  // + `borderStyle` already come via NodeVisualBaseShape — these tests pin
  // the new field's accept/reject behavior alongside back-compat for unset fields.
  it('round-trips an image node with borderColor / borderWidth / borderStyle (US-014)', () => {
    const demo = {
      version: 2 as const,
      name: 'styled-image',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: {
            path: 'nodes/img-1/pixel.png',
            borderColor: 'blue' as const,
            borderWidth: 4,
            borderStyle: 'dashed' as const,
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'imageNode') throw new Error('expected imageNode');
    expect(node.data.borderColor).toBe('blue');
    expect(node.data.borderWidth).toBe(4);
    expect(node.data.borderStyle).toBe('dashed');
  });

  it('accepts an image node with no border fields (US-014 back-compat)', () => {
    const demo = {
      version: 2 as const,
      name: 'plain-image',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { path: 'nodes/img-1/pixel.png' },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'imageNode') throw new Error('expected imageNode');
    expect(node.data.borderColor).toBeUndefined();
    expect(node.data.borderWidth).toBeUndefined();
    expect(node.data.borderStyle).toBeUndefined();
  });

  it('rejects an image node with borderWidth outside the 1–8 range (US-014)', () => {
    const basePath = 'nodes/img-1/pixel.png';
    const tooSmall = {
      version: 2 as const,
      name: 'bad-w',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { path: basePath, borderWidth: 0 },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(tooSmall).success).toBe(false);

    const tooLarge = {
      ...tooSmall,
      nodes: [{ ...tooSmall.nodes[0], data: { path: basePath, borderWidth: 9 } }],
    };
    expect(ResolvedFlowSchema.safeParse(tooLarge).success).toBe(false);
  });

  it('accepts a connector pointing at an imageNode id (US-002)', () => {
    const demo = {
      version: 2 as const,
      name: 'image-conn',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'S', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 100, y: 0 },
          data: { path: 'nodes/img-1/pixel.png' },
        },
      ],
      connectors: [{ id: 'c1', source: 's', target: 'img-1' }],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(1);
  });

  // US-023: an iconNode is a valid connector endpoint in either role — the
  // connector→node superRefine cares only that the referenced id exists in
  // nodes[], not about the node's discriminator. Schema-level fence so a future
  // change can't add a hidden node-type whitelist.
  it('accepts a connector pointing at an iconNode id as source AND target (US-023)', () => {
    const demo = {
      version: 2 as const,
      name: 'icon-conn',
      nodes: [
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'S', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 100, y: 0 },
          data: { icon: 'shopping-cart' },
        },
        {
          id: 'icon-2',
          type: 'iconNode' as const,
          position: { x: 200, y: 0 },
          data: { icon: 'circle' },
        },
      ],
      connectors: [
        // stateNode → iconNode
        { id: 'c1', source: 's', target: 'icon-1' },
        // iconNode → stateNode
        { id: 'c2', source: 'icon-1', target: 's' },
        // iconNode → iconNode
        { id: 'c3', source: 'icon-1', target: 'icon-2' },
      ],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
  });

  it('parses a demo with a top-level resetAction (US-003 / US-008 script-shape)', () => {
    const demo = {
      version: 2 as const,
      name: 'reset-demo',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [],
      resetAction: {
        kind: 'script' as const,
        interpreter: 'bun',
        args: ['run'],
        scriptPath: 'scripts/reset.ts',
      },
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.resetAction?.kind).toBe('script');
    expect(result.data.resetAction?.interpreter).toBe('bun');
    expect(result.data.resetAction?.scriptPath).toBe('scripts/reset.ts');
  });

  it('parses a demo without resetAction (back-compat for US-003)', () => {
    const demo = {
      version: 2 as const,
      name: 'no-reset',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.resetAction).toBeUndefined();
  });

  it('parses an iconNode with only the required icon field (US-008)', () => {
    const demo = {
      version: 2 as const,
      name: 'icon-demo',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 10, y: 20 },
          data: { icon: 'shopping-cart' },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'iconNode') throw new Error('expected iconNode');
    expect(node.data.icon).toBe('shopping-cart');
    expect(node.data.color).toBeUndefined();
    expect(node.data.strokeWidth).toBeUndefined();
  });

  it('parses an iconNode with every optional field set (US-008)', () => {
    const demo = {
      version: 2 as const,
      name: 'icon-full',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: {
            icon: 'help-circle',
            color: 'blue' as const,
            strokeWidth: 1.5,
            width: 64,
            height: 64,
            alt: 'help indicator',
            name: 'Help',
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'iconNode') throw new Error('expected iconNode');
    expect(node.data.icon).toBe('help-circle');
    expect(node.data.color).toBe('blue');
    expect(node.data.strokeWidth).toBe(1.5);
    expect(node.data.width).toBe(64);
    expect(node.data.height).toBe(64);
    expect(node.data.alt).toBe('help indicator');
    expect(node.data.name).toBe('Help');
  });

  it('parses an iconNode with an empty label (US-002 backwards compat sentinel)', () => {
    // Empty string is the documented "no label" sentinel and must round-trip
    // through the schema (consumers can treat empty + absent the same way at
    // render time without needing a coercion step).
    const demo = {
      version: 2 as const,
      name: 'icon-empty-label',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: 'shopping-cart', name: '' },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'iconNode') throw new Error('expected iconNode');
    expect(node.data.name).toBe('');
  });

  it('rejects an iconNode with an empty icon string (US-008)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-icon',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: '' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an iconNode strokeWidth outside [0.5, 4] (US-008)', () => {
    const make = (strokeWidth: number) => ({
      version: 2 as const,
      name: 'bad-stroke',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: 'shopping-cart', strokeWidth },
        },
      ],
      connectors: [],
    });
    expect(ResolvedFlowSchema.safeParse(make(0.25)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(4.5)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(0.5)).success).toBe(true);
    expect(ResolvedFlowSchema.safeParse(make(4)).success).toBe(true);
  });

  it('rejects an iconNode with non-positive width or height (US-008)', () => {
    const make = (width: number, height: number) => ({
      version: 2 as const,
      name: 'bad-icon-size',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode' as const,
          position: { x: 0, y: 0 },
          data: { icon: 'shopping-cart', width, height },
        },
      ],
      connectors: [],
    });
    expect(ResolvedFlowSchema.safeParse(make(0, 48)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(-10, 48)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(48, 0)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(48, -10)).success).toBe(false);
  });

  it('round-trips optional connector fontSize (US-018)', () => {
    const demo = {
      version: 2 as const,
      name: 'connector-fontsize',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', fontSize: 16 }],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    expect(conn?.fontSize).toBe(16);
  });

  it('rejects non-positive connector fontSize (US-018)', () => {
    const make = (size: number) => ({
      version: 2 as const,
      name: 'connector-fontsize-bad',
      nodes: [
        {
          id: 'a',
          type: 'stateNode' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
        {
          id: 'b',
          type: 'stateNode' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B', kind: 'svc', stateSource: { kind: 'request' as const } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', fontSize: size }],
    });
    expect(ResolvedFlowSchema.safeParse(make(0)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(-1)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(12)).success).toBe(true);
  });

  it('demos without group nodes round-trip unchanged', () => {
    // Demos without group nodes produce a deep-equal result with no injected keys.
    const raw = {
      version: 2,
      name: 'Legacy Flow',
      nodes: [
        {
          id: 'svc',
          type: 'playNode',
          position: { x: 0, y: 0 },
          data: {
            name: 'POST /action',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: {
              kind: 'script',
              interpreter: 'bun',
              args: ['run'],
              scriptPath: 'scripts/play.ts',
            },
          },
        },
        {
          id: 'worker',
          type: 'stateNode',
          position: { x: 300, y: 0 },
          data: { name: 'my-worker', kind: 'worker', stateSource: { kind: 'event' } },
        },
      ],
      connectors: [{ id: 'c1', source: 'svc', target: 'worker' }],
    };
    const parsed = ResolvedFlowSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`expected legacy demo to parse: ${JSON.stringify(parsed.error.issues)}`);
    }
    const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
    expect(serialized).toEqual(raw);
  });

  it('treats data.handlerModule as optional and reserved (no runtime use yet)', () => {
    const baseData = {
      name: 'worker',
      kind: 'worker',
      stateSource: { kind: 'event' as const },
    };
    const baseDemo = (data: Record<string, unknown>) => ({
      version: 2 as const,
      name: 'minimal',
      nodes: [{ id: 'n1', type: 'stateNode' as const, position: { x: 0, y: 0 }, data }],
      connectors: [],
    });

    expect(ResolvedFlowSchema.safeParse(baseDemo(baseData)).success).toBe(true);
    expect(
      ResolvedFlowSchema.safeParse(
        baseDemo({ ...baseData, handlerModule: 'src/workers/fulfillment.ts' }),
      ).success,
    ).toBe(true);
  });

  // Three-field consolidation: every node variant exposes optional
  // `description` (short body text) and `detail` (long-form sidebar text)
  // alongside `name`. Both string-typed, both optional, both no length cap.
  describe('description / detail metadata', () => {
    const makeDemoWithNode = (node: Record<string, unknown>) => ({
      version: 2 as const,
      name: 'meta-demo',
      nodes: [node],
      connectors: [],
    });

    it('round-trips description + detail on every node variant', () => {
      const variants: Array<{ id: string; node: Record<string, unknown> }> = [
        {
          id: 'play',
          node: {
            id: 'n-play',
            type: 'playNode',
            position: { x: 0, y: 0 },
            data: {
              name: 'p',
              kind: 'svc',
              stateSource: { kind: 'request' },
              playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/p.ts' },
              description: 'short body',
              detail: 'long-form\nnotes',
            },
          },
        },
        {
          id: 'state',
          node: {
            id: 'n-state',
            type: 'stateNode',
            position: { x: 0, y: 0 },
            data: {
              name: 's',
              kind: 'svc',
              stateSource: { kind: 'event' },
              description: 'short body',
              detail: 'long-form notes',
            },
          },
        },
        {
          id: 'shape',
          node: {
            id: 'n-shape',
            type: 'shapeNode',
            position: { x: 0, y: 0 },
            data: {
              shape: 'rectangle',
              description: 'short body',
              detail: 'long-form\nnotes',
            },
          },
        },
        {
          id: 'image',
          node: {
            id: 'n-image',
            type: 'imageNode',
            position: { x: 0, y: 0 },
            data: {
              path: 'nodes/n-image/captioned.png',
              description: 'short body',
              detail: 'long-form notes',
            },
          },
        },
        {
          id: 'icon',
          node: {
            id: 'n-icon',
            type: 'iconNode',
            position: { x: 0, y: 0 },
            data: {
              icon: 'shopping-cart',
              description: 'short body',
              detail: 'long-form notes',
            },
          },
        },
      ];

      for (const { id, node } of variants) {
        const demo = makeDemoWithNode(node);
        const parsed = ResolvedFlowSchema.safeParse(demo);
        if (!parsed.success) {
          throw new Error(
            `${id} expected to parse, got: ${JSON.stringify(parsed.error.issues, null, 2)}`,
          );
        }
        // Round-trip preserves both fields byte-for-byte (no silent
        // injection or stripping of the optional fields).
        const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
        expect(serialized).toEqual(demo);
      }
    });

    it('accepts nodes with NO description / detail (back-compat)', () => {
      const demo = makeDemoWithNode({
        id: 'n1',
        type: 'shapeNode',
        position: { x: 0, y: 0 },
        data: { shape: 'rectangle' },
      });
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
    });

    it('accepts description with no length cap (large free-form text round-trips)', () => {
      const big = 'line\n'.repeat(2000); // 10kB of newlines
      const demo = makeDemoWithNode({
        id: 'n1',
        type: 'shapeNode',
        position: { x: 0, y: 0 },
        data: { shape: 'rectangle', description: big },
      });
      const parsed = ResolvedFlowSchema.safeParse(demo);
      if (!parsed.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(parsed.error.issues)}`);
      }
      const first = parsed.data.nodes[0];
      if (first?.type !== 'shapeNode') throw new Error('expected shape node');
      expect(first.data.description).toBe(big);
    });

    it('accepts empty string for both fields (transient state during clear)', () => {
      // The wire-format merge logic (operations.ts) strips '' on serialize,
      // but the schema itself must accept '' so the optimistic override
      // (which carries '' through React state) still validates if a stray
      // SSE echo replays it back.
      const demo = makeDemoWithNode({
        id: 'n1',
        type: 'shapeNode',
        position: { x: 0, y: 0 },
        data: { shape: 'rectangle', description: '', detail: '' },
      });
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
    });
  });

  // htmlNode carries author-written HTML inline via `data.html`. The studio
  // externalizes content to `<project>/.seeflow/nodes/<id>/view.html` and
  // stores a `file://` ref in flow.json; the file-ref resolver inlines on read.
  describe('htmlNode', () => {
    it('parses a minimal htmlNode with optional html (omitted)', () => {
      const demo = {
        version: 2 as const,
        name: 'html-demo',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 10, y: 20 },
            data: {},
          },
        ],
        connectors: [],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'htmlNode') throw new Error('expected htmlNode');
      expect(node.data.html).toBeUndefined();
      expect(node.data.name).toBeUndefined();
    });

    it('accepts html as free-form content', () => {
      const result = HtmlNodeDataSchema.safeParse({ html: '<div>hi</div>' });
      expect(result.success).toBe(true);
    });

    it('accepts html as a file:// ref (round-trip from disk)', () => {
      const result = HtmlNodeDataSchema.safeParse({
        html: 'file://view.html',
      });
      expect(result.success).toBe(true);
    });

    it('round-trips an htmlNode with label + every NodeVisualBaseShape field', () => {
      const demo = {
        version: 2 as const,
        name: 'html-styled',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: {
              html: '<p>card</p>',
              name: 'Promo card',
              width: 320,
              height: 200,
              borderColor: 'blue' as const,
              backgroundColor: 'slate' as const,
              borderSize: 2,
              borderStyle: 'dashed' as const,
              fontSize: 14,
              cornerRadius: 8,
            },
          },
        ],
        connectors: [],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'htmlNode') throw new Error('expected htmlNode');
      expect(node.data.html).toBe('<p>card</p>');
      expect(node.data.name).toBe('Promo card');
      expect(node.data.width).toBe(320);
      expect(node.data.height).toBe(200);
      expect(node.data.borderColor).toBe('blue');
      expect(node.data.backgroundColor).toBe('slate');
      expect(node.data.borderSize).toBe(2);
      expect(node.data.borderStyle).toBe('dashed');
      expect(node.data.fontSize).toBe(14);
      expect(node.data.cornerRadius).toBe(8);
    });

    it('round-trips description / detail on an htmlNode', () => {
      const demo = {
        version: 2 as const,
        name: 'html-meta',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: {
              html: '<p>x</p>',
              description: 'short body',
              detail: 'multi-line\nnotes',
            },
          },
        ],
        connectors: [],
      };
      const parsed = ResolvedFlowSchema.safeParse(demo);
      if (!parsed.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(parsed.error.issues)}`);
      }
      const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
      expect(serialized).toEqual(demo);
    });

    it('accepts an htmlNode as a connector endpoint (source AND target)', () => {
      const demo = {
        version: 2 as const,
        name: 'html-conn',
        nodes: [
          {
            id: 's',
            type: 'stateNode' as const,
            position: { x: 0, y: 0 },
            data: { name: 'S', kind: 'svc', stateSource: { kind: 'request' as const } },
          },
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 100, y: 0 },
            data: { html: '<p>note</p>' },
          },
        ],
        connectors: [
          { id: 'c1', source: 's', target: 'html-1' },
          { id: 'c2', source: 'html-1', target: 's' },
        ],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.data.connectors).toHaveLength(2);
    });
  });

  // US-001: script-based playAction + optional statusAction + StatusReport.
  // US-008: PlayAction AND resetAction are both script-shaped now; the
  // legacy HttpAction schema has been removed.
  describe('script-based playAction + statusAction (US-001)', () => {
    const makeDemoWithPlayAction = (playAction: unknown) => ({
      version: 2 as const,
      name: 'script-demo',
      nodes: [
        {
          id: 'p',
          type: 'playNode' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'P',
            kind: 'svc',
            stateSource: { kind: 'request' as const },
            playAction,
          },
        },
      ],
      connectors: [],
    });

    it('parses a valid script-shaped playAction with optional input and timeoutMs', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        args: ['run'],
        scriptPath: 'scripts/play.ts',
        input: { foo: 'bar' },
        timeoutMs: 5000,
      });
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'playNode') throw new Error('expected play node');
      const action = node.data.playAction;
      expect(action.kind).toBe('script');
      expect(action.interpreter).toBe('bun');
      expect(action.scriptPath).toBe('scripts/play.ts');
      expect(action.timeoutMs).toBe(5000);
    });

    it('rejects an absolute scriptPath', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: '/etc/passwd',
      });
      const result = ResolvedFlowSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });

    it("rejects a scriptPath with '..' traversal", () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: '../../etc/passwd',
      });
      const result = ResolvedFlowSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });

    it('rejects a playAction with missing interpreter', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        scriptPath: 'scripts/play.ts',
      });
      const result = ResolvedFlowSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });

    it('rejects a playAction with zero or negative timeoutMs', () => {
      const zero = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: 0,
      });
      expect(ResolvedFlowSchema.safeParse(zero).success).toBe(false);

      const negative = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: -1,
      });
      expect(ResolvedFlowSchema.safeParse(negative).success).toBe(false);
    });

    it('rejects a playAction with timeoutMs above 600_000', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: 600_001,
      });
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
    });

    it('accepts a playAction with timeoutMs at the upper bound (600_000)', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: 600_000,
      });
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
    });

    it('parses a valid statusAction on a playNode', () => {
      const demo = {
        version: 2 as const,
        name: 'status-demo',
        nodes: [
          {
            id: 'p',
            type: 'playNode' as const,
            position: { x: 0, y: 0 },
            data: {
              name: 'P',
              kind: 'svc',
              stateSource: { kind: 'request' as const },
              playAction: {
                kind: 'script' as const,
                interpreter: 'bun',
                scriptPath: 'scripts/play.ts',
              },
              statusAction: {
                kind: 'script' as const,
                interpreter: 'bun',
                args: ['run'],
                scriptPath: 'scripts/status.ts',
                maxLifetimeMs: 60_000,
              },
            },
          },
        ],
        connectors: [],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'playNode') throw new Error('expected play node');
      expect(node.data.statusAction?.kind).toBe('script');
      expect(node.data.statusAction?.scriptPath).toBe('scripts/status.ts');
      expect(node.data.statusAction?.maxLifetimeMs).toBe(60_000);
    });

    it('parses a valid statusAction on a stateNode (no playAction required)', () => {
      const demo = {
        version: 2 as const,
        name: 'state-status-demo',
        nodes: [
          {
            id: 's',
            type: 'stateNode' as const,
            position: { x: 0, y: 0 },
            data: {
              name: 'S',
              kind: 'worker',
              stateSource: { kind: 'event' as const },
              statusAction: {
                kind: 'script' as const,
                interpreter: 'bun',
                scriptPath: 'scripts/status.ts',
              },
            },
          },
        ],
        connectors: [],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'stateNode') throw new Error('expected state node');
      expect(node.data.statusAction?.scriptPath).toBe('scripts/status.ts');
    });

    it('rejects a statusAction with maxLifetimeMs above 3_600_000', () => {
      const demo = {
        version: 2 as const,
        name: 'bad-lifetime',
        nodes: [
          {
            id: 's',
            type: 'stateNode' as const,
            position: { x: 0, y: 0 },
            data: {
              name: 'S',
              kind: 'worker',
              stateSource: { kind: 'event' as const },
              statusAction: {
                kind: 'script' as const,
                interpreter: 'bun',
                scriptPath: 'scripts/status.ts',
                maxLifetimeMs: 3_600_001,
              },
            },
          },
        ],
        connectors: [],
      };
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
    });

    it('accepts a statusAction with maxLifetimeMs at the upper bound (3_600_000)', () => {
      const demo = {
        version: 2 as const,
        name: 'lifetime-boundary',
        nodes: [
          {
            id: 's',
            type: 'stateNode' as const,
            position: { x: 0, y: 0 },
            data: {
              name: 'S',
              kind: 'worker',
              stateSource: { kind: 'event' as const },
              statusAction: {
                kind: 'script' as const,
                interpreter: 'bun',
                scriptPath: 'scripts/status.ts',
                maxLifetimeMs: 3_600_000,
              },
            },
          },
        ],
        connectors: [],
      };
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
    });

    it('rejects a statusAction with zero or negative maxLifetimeMs', () => {
      const buildDemo = (maxLifetimeMs: number) => ({
        version: 2 as const,
        name: 'lifetime-bound',
        nodes: [
          {
            id: 's',
            type: 'stateNode' as const,
            position: { x: 0, y: 0 },
            data: {
              name: 'S',
              kind: 'worker',
              stateSource: { kind: 'event' as const },
              statusAction: {
                kind: 'script' as const,
                interpreter: 'bun',
                scriptPath: 'scripts/status.ts',
                maxLifetimeMs,
              },
            },
          },
        ],
        connectors: [],
      });
      expect(ResolvedFlowSchema.safeParse(buildDemo(0)).success).toBe(false);
      expect(ResolvedFlowSchema.safeParse(buildDemo(-1)).success).toBe(false);
    });

    it('parses a valid StatusReport with all fields', () => {
      const report = {
        state: 'ok',
        summary: 'all good',
        detail: 'longer text\nwith newlines',
        data: { count: 3, label: 'x' },
        ts: Date.now(),
      };
      const result = StatusReportSchema.safeParse(report);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.data.state).toBe('ok');
      expect(result.data.summary).toBe('all good');
    });

    it('parses a minimal StatusReport (only state)', () => {
      const result = StatusReportSchema.safeParse({ state: 'pending' });
      expect(result.success).toBe(true);
    });

    it('rejects a StatusReport with an invalid state value', () => {
      const result = StatusReportSchema.safeParse({ state: 'in-progress' });
      expect(result.success).toBe(false);
    });

    it('rejects a StatusReport whose summary exceeds 120 chars', () => {
      const long = 'a'.repeat(121);
      const result = StatusReportSchema.safeParse({ state: 'ok', summary: long });
      expect(result.success).toBe(false);
    });

    it('resetAction on the demo uses the script action shape (US-008)', () => {
      const demo = {
        version: 2 as const,
        name: 'reset-demo',
        nodes: [
          {
            id: 's',
            type: 'stateNode' as const,
            position: { x: 0, y: 0 },
            data: {
              name: 'S',
              kind: 'worker',
              stateSource: { kind: 'event' as const },
            },
          },
        ],
        connectors: [],
        resetAction: {
          kind: 'script' as const,
          interpreter: 'bun',
          scriptPath: 'scripts/reset.ts',
        },
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.data.resetAction?.kind).toBe('script');
      expect(result.data.resetAction?.interpreter).toBe('bun');
      expect(result.data.resetAction?.scriptPath).toBe('scripts/reset.ts');
    });

    it('rejects a legacy HTTP-shaped resetAction (US-008 cut)', () => {
      const demo = {
        version: 2 as const,
        name: 'reset-demo',
        nodes: [
          {
            id: 's',
            type: 'stateNode' as const,
            position: { x: 0, y: 0 },
            data: {
              name: 'S',
              kind: 'worker',
              stateSource: { kind: 'event' as const },
            },
          },
        ],
        connectors: [],
        resetAction: {
          method: 'POST' as const,
          url: 'http://localhost:3000/reset',
        },
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });
  });
});

describe('HtmlNodeDataSchema autoSize', () => {
  it('parses with autoSize: true and no width/height', () => {
    const r = HtmlNodeDataSchema.safeParse({ html: '<p>x</p>', autoSize: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.autoSize).toBe(true);
  });

  it('parses with autoSize: false plus width/height', () => {
    const r = HtmlNodeDataSchema.safeParse({
      html: '<p>x</p>',
      autoSize: false,
      width: 480,
      height: 320,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.autoSize).toBe(false);
      expect(r.data.width).toBe(480);
      expect(r.data.height).toBe(320);
    }
  });

  it('parses with autoSize absent (field is optional)', () => {
    const r = HtmlNodeDataSchema.safeParse({ html: '<p>x</p>' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.autoSize).toBeUndefined();
  });

  it('rejects non-boolean autoSize', () => {
    const r = HtmlNodeDataSchema.safeParse({ html: '<p>x</p>', autoSize: 'yes' });
    expect(r.success).toBe(false);
  });
});

describe('FlowSchema', () => {
  it('accepts a minimal flow with one play node', () => {
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'Test Flow',
      nodes: [
        {
          id: 'n1',
          type: 'playNode',
          data: {
            name: 'POST /x',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
          },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects visual fields on node.data', () => {
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'Test',
      nodes: [
        {
          id: 'n1',
          type: 'playNode',
          data: {
            name: 'X',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
            fontSize: 15,
          },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects node.position at the root', () => {
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'Test',
      nodes: [
        {
          id: 'n1',
          type: 'playNode',
          position: { x: 0, y: 0 },
          data: {
            name: 'X',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
          },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects visual fields on connectors', () => {
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'Test',
      nodes: [
        {
          id: 'a',
          type: 'playNode',
          data: {
            name: 'A',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
          },
        },
        {
          id: 'b',
          type: 'stateNode',
          data: { name: 'B', kind: 'worker', stateSource: { kind: 'event' } },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', color: 'blue' }],
    });
    expect(result.success).toBe(false);
  });

  it('enforces connector source/target referential integrity', () => {
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'T',
      nodes: [],
      connectors: [{ id: 'c', source: 'missing', target: 'also-missing' }],
    });
    expect(result.success).toBe(false);
  });

  it('keeps label, eventName on connectors', () => {
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'T',
      nodes: [
        {
          id: 'a',
          type: 'playNode',
          data: {
            name: 'A',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
          },
        },
        {
          id: 'b',
          type: 'stateNode',
          data: { name: 'B', kind: 'worker', stateSource: { kind: 'event' } },
        },
      ],
      connectors: [{ id: 'c', source: 'a', target: 'b', eventName: 'evt', label: 'hi' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('StyleSchema', () => {
  it('accepts an empty style object', () => {
    expect(StyleSchema.safeParse({}).success).toBe(true);
  });

  it('accepts position + visual fields on a node entry', () => {
    const r = StyleSchema.safeParse({
      nodes: {
        n1: {
          position: { x: 1, y: 2 },
          width: 100,
          height: 50,
          borderColor: 'blue',
          fontSize: 14,
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('accepts iconNode-specific color/strokeWidth and htmlNode autoSize', () => {
    const r = StyleSchema.safeParse({
      nodes: {
        i1: { color: 'red', strokeWidth: 2 },
        h1: { autoSize: true },
      },
    });
    expect(r.success).toBe(true);
  });

  it('accepts connector handles, pins, and visual fields', () => {
    const r = StyleSchema.safeParse({
      connectors: {
        c1: {
          sourceHandle: 'r',
          targetHandle: 'l',
          sourceHandleAutoPicked: true,
          sourcePin: { side: 'right', t: 0.5 },
          style: 'dashed',
          color: 'blue',
          direction: 'forward',
          borderSize: 1,
          path: 'curve',
          fontSize: 11,
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys on a node entry', () => {
    const r = StyleSchema.safeParse({ nodes: { n1: { fontSize: 14, bogus: 1 } } });
    expect(r.success).toBe(false);
  });

  it('rejects unknown keys on the root', () => {
    const r = StyleSchema.safeParse({ nodes: {}, extra: true });
    expect(r.success).toBe(false);
  });
});

describe('flow description field', () => {
  const baseFlow = {
    version: 2 as const,
    name: 'documented-flow',
    nodes: [],
    connectors: [],
  };

  it('round-trips a description on FlowSchema', () => {
    const result = FlowSchema.safeParse({ ...baseFlow, description: 'Stripe → ship' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBe('Stripe → ship');
  });

  it('round-trips a description on ResolvedFlowSchema', () => {
    const result = ResolvedFlowSchema.safeParse({ ...baseFlow, description: 'Stripe → ship' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBe('Stripe → ship');
  });

  it('omits description when absent (stays absent, not undefined) on FlowSchema', () => {
    const result = FlowSchema.safeParse(baseFlow);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect('description' in result.data).toBe(false);
  });

  it('omits description when absent on ResolvedFlowSchema', () => {
    const result = ResolvedFlowSchema.safeParse(baseFlow);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect('description' in result.data).toBe(false);
  });

  it('rejects a non-string description on FlowSchema', () => {
    const result = FlowSchema.safeParse({ ...baseFlow, description: 123 });
    expect(result.success).toBe(false);
  });
});

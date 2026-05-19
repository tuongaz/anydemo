import { describe, expect, it } from 'bun:test';
import { DemoSchema, HtmlNodeDataSchema, StatusReportSchema } from './schema.ts';

const fixturePath = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;

const readFixture = async (name: string): Promise<unknown> =>
  await Bun.file(fixturePath(name)).json();

describe('DemoSchema', () => {
  it('parses a valid demo fixture', async () => {
    const data = await readFixture('valid-demo.json');
    const result = DemoSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected valid fixture to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.data.version).toBe(1);
    expect(result.data.name).toBe('Checkout flow');
    expect(result.data.nodes).toHaveLength(2);
    expect(result.data.connectors).toHaveLength(1);
    const connector = result.data.connectors[0];
    if (connector?.kind !== 'event') throw new Error('expected event connector');
    expect(connector.eventName).toBe('checkout.created');
    expect(connector.label).toBe('publishes checkout.created');
  });

  it('rejects an invalid demo fixture with a usable Zod error', async () => {
    const data = await readFixture('invalid-demo.json');
    const result = DemoSchema.safeParse(data);
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
    const result = DemoSchema.safeParse(data);
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

  it('parses connectors of all three kinds: http, event, queue', () => {
    const demo = {
      version: 1 as const,
      name: 'all-kinds',
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
          kind: 'http' as const,
          method: 'POST' as const,
          url: 'http://b/',
          label: 'calls B',
        },
        {
          id: 'c2',
          source: 'a',
          target: 'c',
          kind: 'event' as const,
          eventName: 'a.published',
        },
        {
          id: 'c3',
          source: 'a',
          target: 'd',
          kind: 'queue' as const,
          queueName: 'work-queue',
        },
      ],
    };

    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
    expect(result.data.connectors[0]?.kind).toBe('http');
    expect(result.data.connectors[1]?.kind).toBe('event');
    expect(result.data.connectors[2]?.kind).toBe('queue');
  });

  it('rejects a connector with an unknown discriminator kind', () => {
    const demo = {
      version: 1 as const,
      name: 'bad-kind',
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
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'whisper' }],
    };
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(false);
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
      version: 1 as const,
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
      const result = DemoSchema.safeParse(make(shape));
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
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
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
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(true);
  });

  it('rejects a shapeNode with an unknown shape variant', () => {
    const demo = {
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(false);
  });

  it('accepts node visual fields (width/height/borderColor/backgroundColor) on every node type', () => {
    const demo = {
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.nodes).toHaveLength(3);
  });

  it('round-trips locked on every node kind (US-019)', () => {
    const demo = {
      version: 1 as const,
      name: 'lockable',
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
            locked: true,
          },
        },
        {
          id: 's',
          type: 'stateNode' as const,
          position: { x: 0, y: 100 },
          data: {
            name: 'S',
            kind: 'worker',
            stateSource: { kind: 'event' as const },
            locked: false,
          },
        },
        {
          id: 'shape',
          type: 'shapeNode' as const,
          position: { x: 0, y: 200 },
          data: { shape: 'rectangle' as const, locked: true },
        },
        {
          id: 'img',
          type: 'imageNode' as const,
          position: { x: 0, y: 300 },
          data: { path: 'assets/locked.png', locked: true },
        },
        {
          id: 'icon',
          type: 'iconNode' as const,
          position: { x: 0, y: 400 },
          data: { icon: 'lock', locked: true },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const byId = new Map(result.data.nodes.map((n) => [n.id, n]));
    expect((byId.get('p')?.data as { locked?: boolean }).locked).toBe(true);
    expect((byId.get('s')?.data as { locked?: boolean }).locked).toBe(false);
    expect((byId.get('shape')?.data as { locked?: boolean }).locked).toBe(true);
    expect((byId.get('img')?.data as { locked?: boolean }).locked).toBe(true);
    expect((byId.get('icon')?.data as { locked?: boolean }).locked).toBe(true);
  });

  it('accepts nodes that omit the new visual fields entirely (backwards compatible)', () => {
    const demo = {
      version: 1 as const,
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
    expect(DemoSchema.safeParse(demo).success).toBe(true);
  });

  it('rejects width/height that are zero or negative', () => {
    const demo = (width: number, height: number) => ({
      version: 1 as const,
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
    expect(DemoSchema.safeParse(demo(0, 80)).success).toBe(false);
    expect(DemoSchema.safeParse(demo(-1, 80)).success).toBe(false);
    expect(DemoSchema.safeParse(demo(120, 0)).success).toBe(false);
  });

  it('rejects an invalid color token (only enum values allowed)', () => {
    const demo = {
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path.includes('borderColor') && i.path.includes('data'),
    );
    expect(issue).toBeDefined();
  });

  it('round-trips a default connector with no semantic payload', () => {
    const demo = {
      version: 1 as const,
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
      connectors: [
        { id: 'c1', source: 'a', target: 'b', kind: 'default' as const, label: 'see also' },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.label).toBe('see also');
  });

  it('accepts connector visual fields (style/color/direction) on every kind', () => {
    const demo = {
      version: 1 as const,
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
          kind: 'http' as const,
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
          kind: 'event' as const,
          eventName: 'a.b',
          style: 'solid' as const,
          direction: 'both' as const,
        },
        {
          id: 'c3',
          source: 'a',
          target: 'b',
          kind: 'default' as const,
          color: 'amber' as const,
          direction: 'backward' as const,
        },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
  });

  it('round-trips optional sourceHandle/targetHandle on connectors (US-013)', () => {
    const demo = {
      version: 1 as const,
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
          kind: 'default' as const,
        },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourceHandle).toBe('b');
    expect(conn.targetHandle).toBe('t');
  });

  it('parses connectors authored without handle ids (back-compat for US-013)', () => {
    const demo = {
      version: 1 as const,
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
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default' as const }],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourceHandle).toBeUndefined();
    expect(conn.targetHandle).toBeUndefined();
  });

  it('round-trips optional sourcePin/targetPin on connectors (US-006)', () => {
    const demo = {
      version: 1 as const,
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
          kind: 'default' as const,
          sourcePin: { side: 'right' as const, t: 0.25 },
          targetPin: { side: 'left' as const, t: 0.75 },
        },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(conn.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('parses connectors authored without sourcePin/targetPin (back-compat for US-006)', () => {
    const demo = {
      version: 1 as const,
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
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default' as const }],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.sourcePin).toBeUndefined();
    expect(conn.targetPin).toBeUndefined();
  });

  it('rejects a pin with an unknown side (US-006)', () => {
    const demo = {
      version: 1 as const,
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
          kind: 'default' as const,
          sourcePin: { side: 'diagonal', t: 0.5 },
        },
      ],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects a pin with t outside [0, 1] (US-006)', () => {
    const make = (t: unknown) => ({
      version: 1 as const,
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
          kind: 'default' as const,
          sourcePin: { side: 'top' as const, t },
        },
      ],
    });
    expect(DemoSchema.safeParse(make(-0.1)).success).toBe(false);
    expect(DemoSchema.safeParse(make(1.1)).success).toBe(false);
    expect(DemoSchema.safeParse(make(0)).success).toBe(true);
    expect(DemoSchema.safeParse(make(1)).success).toBe(true);
  });

  it('rejects an invalid connector style value', () => {
    const demo = {
      version: 1 as const,
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
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default', style: 'wavy' }],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an invalid connector direction value', () => {
    const demo = {
      version: 1 as const,
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
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default', direction: 'sideways' }],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an invalid connector color token', () => {
    const demo = {
      version: 1 as const,
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
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default', color: 'fuchsia' }],
    };
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('accepts a positive borderSize on nodes and connectors, rejects 0/negative', () => {
    const make = (nodeBorderSize: unknown, connBorderSize: unknown) => ({
      version: 1 as const,
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
          kind: 'default' as const,
          borderSize: connBorderSize,
        },
      ],
    });

    // node borderSize: 3, connector borderSize: 4 — both accepted.
    const ok = DemoSchema.safeParse(make(3, 4));
    if (!ok.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(ok.error.issues)}`);
    }
    const node = ok.data.nodes[0];
    if (node?.type !== 'stateNode') throw new Error('expected stateNode');
    expect(node.data.borderSize).toBe(3);
    expect(ok.data.connectors[0]?.borderSize).toBe(4);

    // 0 and negative values rejected (positive constraint).
    expect(DemoSchema.safeParse(make(0, 4)).success).toBe(false);
    expect(DemoSchema.safeParse(make(-2, 4)).success).toBe(false);
  });

  it('accepts cornerRadius=12 and cornerRadius=0 on a node, rejects negative values (US-001)', () => {
    const make = (cornerRadius: unknown) => ({
      version: 1 as const,
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

    const ok12 = DemoSchema.safeParse(make(12));
    if (!ok12.success) {
      throw new Error(
        `expected cornerRadius=12 to parse, got: ${JSON.stringify(ok12.error.issues)}`,
      );
    }
    const node12 = ok12.data.nodes[0];
    if (node12?.type !== 'playNode') throw new Error('expected playNode');
    expect(node12.data.cornerRadius).toBe(12);

    const ok0 = DemoSchema.safeParse(make(0));
    if (!ok0.success) {
      throw new Error(`expected cornerRadius=0 to parse, got: ${JSON.stringify(ok0.error.issues)}`);
    }

    expect(DemoSchema.safeParse(make(-5)).success).toBe(false);
  });

  // US-004: ImageNodeDataSchema hard-cut from a `data:image/...` URL to a
  // relative `path` under `<project>/.seeflow/`. The renderer resolves it via
  // the file-serving endpoint added in US-001. Path-safety mirrors htmlPath:
  // no absolute paths, no `..` traversal, no leading slash.
  it('parses a demo containing one imageNode with data.path (US-004)', () => {
    const demo = {
      version: 1 as const,
      name: 'image-demo',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 10, y: 20 },
          data: {
            path: 'assets/pixel.png',
            alt: 'pixel',
            width: 200,
            height: 150,
          },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'imageNode') throw new Error('expected imageNode');
    expect(node.data.path).toBe('assets/pixel.png');
    expect(node.data.alt).toBe('pixel');
  });

  it('rejects an imageNode whose data carries the legacy `image` key (US-004 hard-cut)', () => {
    // The pre-US-004 schema accepted `data.image` as a base64 data URL. After
    // the hard-cut, `image` is an unknown key and `path` is required — the
    // result is that the schema rejects the legacy payload, with no compat
    // layer.
    const demo = {
      version: 1 as const,
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
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an imageNode whose path is absolute (US-004)', () => {
    const demo = {
      version: 1 as const,
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
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an imageNode whose path uses `..` traversal (US-004)', () => {
    const demo = {
      version: 1 as const,
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
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  // US-014: image nodes gain an optional `borderWidth` (1–8). `borderColor`
  // + `borderStyle` already come via NodeVisualBaseShape — these tests pin
  // the new field's accept/reject behavior alongside back-compat for unset fields.
  it('round-trips an image node with borderColor / borderWidth / borderStyle (US-014)', () => {
    const demo = {
      version: 1 as const,
      name: 'styled-image',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: {
            path: 'assets/pixel.png',
            borderColor: 'blue' as const,
            borderWidth: 4,
            borderStyle: 'dashed' as const,
          },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
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
      version: 1 as const,
      name: 'plain-image',
      nodes: [
        {
          id: 'img-1',
          type: 'imageNode' as const,
          position: { x: 0, y: 0 },
          data: { path: 'assets/pixel.png' },
        },
      ],
      connectors: [],
    };
    const result = DemoSchema.safeParse(demo);
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
    const basePath = 'assets/pixel.png';
    const tooSmall = {
      version: 1 as const,
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
    expect(DemoSchema.safeParse(tooSmall).success).toBe(false);

    const tooLarge = {
      ...tooSmall,
      nodes: [{ ...tooSmall.nodes[0], data: { path: basePath, borderWidth: 9 } }],
    };
    expect(DemoSchema.safeParse(tooLarge).success).toBe(false);
  });

  it('accepts a connector pointing at an imageNode id (US-002)', () => {
    const demo = {
      version: 1 as const,
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
          data: { path: 'assets/pixel.png' },
        },
      ],
      connectors: [{ id: 'c1', source: 's', target: 'img-1', kind: 'default' as const }],
    };
    const result = DemoSchema.safeParse(demo);
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
      version: 1 as const,
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
        { id: 'c1', source: 's', target: 'icon-1', kind: 'default' as const },
        // iconNode → stateNode
        { id: 'c2', source: 'icon-1', target: 's', kind: 'default' as const },
        // iconNode → iconNode
        { id: 'c3', source: 'icon-1', target: 'icon-2', kind: 'default' as const },
      ],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
  });

  it('parses a demo with a top-level resetAction (US-003 / US-008 script-shape)', () => {
    const demo = {
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.resetAction?.kind).toBe('script');
    expect(result.data.resetAction?.interpreter).toBe('bun');
    expect(result.data.resetAction?.scriptPath).toBe('scripts/reset.ts');
  });

  it('parses a demo without resetAction (back-compat for US-003)', () => {
    const demo = {
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.resetAction).toBeUndefined();
  });

  it('parses an iconNode with only the required icon field (US-008)', () => {
    const demo = {
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
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
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
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
      version: 1 as const,
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
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'iconNode') throw new Error('expected iconNode');
    expect(node.data.name).toBe('');
  });

  it('rejects an iconNode with an empty icon string (US-008)', () => {
    const demo = {
      version: 1 as const,
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
    expect(DemoSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an iconNode strokeWidth outside [0.5, 4] (US-008)', () => {
    const make = (strokeWidth: number) => ({
      version: 1 as const,
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
    expect(DemoSchema.safeParse(make(0.25)).success).toBe(false);
    expect(DemoSchema.safeParse(make(4.5)).success).toBe(false);
    expect(DemoSchema.safeParse(make(0.5)).success).toBe(true);
    expect(DemoSchema.safeParse(make(4)).success).toBe(true);
  });

  it('rejects an iconNode with non-positive width or height (US-008)', () => {
    const make = (width: number, height: number) => ({
      version: 1 as const,
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
    expect(DemoSchema.safeParse(make(0, 48)).success).toBe(false);
    expect(DemoSchema.safeParse(make(-10, 48)).success).toBe(false);
    expect(DemoSchema.safeParse(make(48, 0)).success).toBe(false);
    expect(DemoSchema.safeParse(make(48, -10)).success).toBe(false);
  });

  it('round-trips optional connector fontSize (US-018)', () => {
    const demo = {
      version: 1 as const,
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
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default' as const, fontSize: 16 }],
    };
    const result = DemoSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const conn = result.data.connectors[0];
    if (conn?.kind !== 'default') throw new Error('expected default connector');
    expect(conn.fontSize).toBe(16);
  });

  it('rejects non-positive connector fontSize (US-018)', () => {
    const make = (size: number) => ({
      version: 1 as const,
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
      connectors: [
        { id: 'c1', source: 'a', target: 'b', kind: 'default' as const, fontSize: size },
      ],
    });
    expect(DemoSchema.safeParse(make(0)).success).toBe(false);
    expect(DemoSchema.safeParse(make(-1)).success).toBe(false);
    expect(DemoSchema.safeParse(make(12)).success).toBe(true);
  });

  it('demos without group nodes round-trip unchanged', () => {
    // Demos without group nodes produce a deep-equal result with no injected keys.
    const raw = {
      version: 1,
      name: 'Legacy Demo',
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
      connectors: [{ id: 'c1', source: 'svc', target: 'worker', kind: 'default' }],
    };
    const parsed = DemoSchema.safeParse(raw);
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
      version: 1 as const,
      name: 'minimal',
      nodes: [{ id: 'n1', type: 'stateNode' as const, position: { x: 0, y: 0 }, data }],
      connectors: [],
    });

    expect(DemoSchema.safeParse(baseDemo(baseData)).success).toBe(true);
    expect(
      DemoSchema.safeParse(baseDemo({ ...baseData, handlerModule: 'src/workers/fulfillment.ts' }))
        .success,
    ).toBe(true);
  });

  // Three-field consolidation: every node variant exposes optional
  // `description` (short body text) and `detail` (long-form sidebar text)
  // alongside `name`. Both string-typed, both optional, both no length cap.
  describe('description / detail metadata', () => {
    const makeDemoWithNode = (node: Record<string, unknown>) => ({
      version: 1 as const,
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
              path: 'assets/captioned.png',
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
        const parsed = DemoSchema.safeParse(demo);
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
      expect(DemoSchema.safeParse(demo).success).toBe(true);
    });

    it('accepts description with no length cap (large free-form text round-trips)', () => {
      const big = 'line\n'.repeat(2000); // 10kB of newlines
      const demo = makeDemoWithNode({
        id: 'n1',
        type: 'shapeNode',
        position: { x: 0, y: 0 },
        data: { shape: 'rectangle', description: big },
      });
      const parsed = DemoSchema.safeParse(demo);
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
      expect(DemoSchema.safeParse(demo).success).toBe(true);
    });
  });

  // US-011 (illustrative-shapes-htmlnode): htmlNode is the new escape-hatch
  // node type — references author-written HTML at `<project>/.seeflow/<htmlPath>`.
  // `htmlPath` shares the path-safety refine used by imageNode.path; the schema
  // intentionally does NOT validate file existence (the US-014 renderer shows a
  // placeholder when the file is missing).
  describe('htmlNode (US-011 illustrative-shapes-htmlnode)', () => {
    it('parses a minimal htmlNode with only the required htmlPath', () => {
      const demo = {
        version: 1 as const,
        name: 'html-demo',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 10, y: 20 },
            data: { htmlPath: 'blocks/html-1.html' },
          },
        ],
        connectors: [],
      };
      const result = DemoSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'htmlNode') throw new Error('expected htmlNode');
      expect(node.data.htmlPath).toBe('blocks/html-1.html');
      expect(node.data.name).toBeUndefined();
    });

    it('round-trips an htmlNode with label + every NodeVisualBaseShape field', () => {
      const demo = {
        version: 1 as const,
        name: 'html-styled',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: {
              htmlPath: 'blocks/card.html',
              name: 'Promo card',
              width: 320,
              height: 200,
              borderColor: 'blue' as const,
              backgroundColor: 'slate' as const,
              borderSize: 2,
              borderStyle: 'dashed' as const,
              fontSize: 14,
              cornerRadius: 8,
              locked: true,
            },
          },
        ],
        connectors: [],
      };
      const result = DemoSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'htmlNode') throw new Error('expected htmlNode');
      expect(node.data.htmlPath).toBe('blocks/card.html');
      expect(node.data.name).toBe('Promo card');
      expect(node.data.width).toBe(320);
      expect(node.data.height).toBe(200);
      expect(node.data.borderColor).toBe('blue');
      expect(node.data.backgroundColor).toBe('slate');
      expect(node.data.borderSize).toBe(2);
      expect(node.data.borderStyle).toBe('dashed');
      expect(node.data.fontSize).toBe(14);
      expect(node.data.cornerRadius).toBe(8);
      expect(node.data.locked).toBe(true);
    });

    it('round-trips description / detail on an htmlNode', () => {
      const demo = {
        version: 1 as const,
        name: 'html-meta',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: {
              htmlPath: 'blocks/x.html',
              description: 'short body',
              detail: 'multi-line\nnotes',
            },
          },
        ],
        connectors: [],
      };
      const parsed = DemoSchema.safeParse(demo);
      if (!parsed.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(parsed.error.issues)}`);
      }
      const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
      expect(serialized).toEqual(demo);
    });

    it('rejects an htmlNode whose htmlPath is absolute', () => {
      const demo = {
        version: 1 as const,
        name: 'bad-abs',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: { htmlPath: '/etc/passwd' },
          },
        ],
        connectors: [],
      };
      const result = DemoSchema.safeParse(demo);
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find((i) => i.path.includes('htmlPath'));
      expect(issue).toBeDefined();
    });

    it('rejects an htmlNode whose htmlPath uses `..` traversal', () => {
      const demo = {
        version: 1 as const,
        name: 'bad-traversal',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: { htmlPath: '../../etc/passwd' },
          },
        ],
        connectors: [],
      };
      const result = DemoSchema.safeParse(demo);
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find((i) => i.path.includes('htmlPath'));
      expect(issue).toBeDefined();
    });

    it('rejects an htmlNode whose htmlPath uses a Windows drive-letter root', () => {
      const demo = {
        version: 1 as const,
        name: 'bad-drive',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: { htmlPath: 'C:\\Windows\\System32\\foo.html' },
          },
        ],
        connectors: [],
      };
      expect(DemoSchema.safeParse(demo).success).toBe(false);
    });

    it('rejects an htmlNode with an empty htmlPath', () => {
      const demo = {
        version: 1 as const,
        name: 'empty-path',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: { htmlPath: '' },
          },
        ],
        connectors: [],
      };
      expect(DemoSchema.safeParse(demo).success).toBe(false);
    });

    it('does NOT enforce file existence — missing htmlPath files parse cleanly (renderer shows placeholder)', () => {
      // Schema is pure: file existence is intentionally NOT validated here so
      // missing files render a placeholder (US-014) instead of breaking the
      // entire demo at parse time.
      const demo = {
        version: 1 as const,
        name: 'missing-on-disk',
        nodes: [
          {
            id: 'html-1',
            type: 'htmlNode' as const,
            position: { x: 0, y: 0 },
            data: { htmlPath: 'blocks/never-written.html' },
          },
        ],
        connectors: [],
      };
      expect(DemoSchema.safeParse(demo).success).toBe(true);
    });

    it('accepts an htmlNode as a connector endpoint (source AND target)', () => {
      const demo = {
        version: 1 as const,
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
            data: { htmlPath: 'blocks/note.html' },
          },
        ],
        connectors: [
          { id: 'c1', source: 's', target: 'html-1', kind: 'default' as const },
          { id: 'c2', source: 'html-1', target: 's', kind: 'default' as const },
        ],
      };
      const result = DemoSchema.safeParse(demo);
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
      version: 1 as const,
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
      const result = DemoSchema.safeParse(demo);
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
      const result = DemoSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });

    it("rejects a scriptPath with '..' traversal", () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: '../../etc/passwd',
      });
      const result = DemoSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });

    it('rejects a playAction with missing interpreter', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        scriptPath: 'scripts/play.ts',
      });
      const result = DemoSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });

    it('rejects a playAction with zero or negative timeoutMs', () => {
      const zero = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: 0,
      });
      expect(DemoSchema.safeParse(zero).success).toBe(false);

      const negative = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: -1,
      });
      expect(DemoSchema.safeParse(negative).success).toBe(false);
    });

    it('rejects a playAction with timeoutMs above 600_000', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: 600_001,
      });
      expect(DemoSchema.safeParse(demo).success).toBe(false);
    });

    it('accepts a playAction with timeoutMs at the upper bound (600_000)', () => {
      const demo = makeDemoWithPlayAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
        timeoutMs: 600_000,
      });
      expect(DemoSchema.safeParse(demo).success).toBe(true);
    });

    it('parses a valid statusAction on a playNode', () => {
      const demo = {
        version: 1 as const,
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
      const result = DemoSchema.safeParse(demo);
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
        version: 1 as const,
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
      const result = DemoSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'stateNode') throw new Error('expected state node');
      expect(node.data.statusAction?.scriptPath).toBe('scripts/status.ts');
    });

    it('rejects a statusAction with maxLifetimeMs above 3_600_000', () => {
      const demo = {
        version: 1 as const,
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
      expect(DemoSchema.safeParse(demo).success).toBe(false);
    });

    it('accepts a statusAction with maxLifetimeMs at the upper bound (3_600_000)', () => {
      const demo = {
        version: 1 as const,
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
      expect(DemoSchema.safeParse(demo).success).toBe(true);
    });

    it('rejects a statusAction with zero or negative maxLifetimeMs', () => {
      const buildDemo = (maxLifetimeMs: number) => ({
        version: 1 as const,
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
      expect(DemoSchema.safeParse(buildDemo(0)).success).toBe(false);
      expect(DemoSchema.safeParse(buildDemo(-1)).success).toBe(false);
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
        version: 1 as const,
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
      const result = DemoSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.data.resetAction?.kind).toBe('script');
      expect(result.data.resetAction?.interpreter).toBe('bun');
      expect(result.data.resetAction?.scriptPath).toBe('scripts/reset.ts');
    });

    it('rejects a legacy HTTP-shaped resetAction (US-008 cut)', () => {
      const demo = {
        version: 1 as const,
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
          kind: 'http' as const,
          method: 'POST' as const,
          url: 'http://localhost:3000/reset',
        },
      };
      const result = DemoSchema.safeParse(demo);
      expect(result.success).toBe(false);
    });
  });
});

describe('HtmlNodeDataSchema autoSize', () => {
  it('parses with autoSize: true and no width/height', () => {
    const r = HtmlNodeDataSchema.safeParse({ htmlPath: 'snip.html', autoSize: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.autoSize).toBe(true);
  });

  it('parses with autoSize: false plus width/height', () => {
    const r = HtmlNodeDataSchema.safeParse({
      htmlPath: 'snip.html',
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
    const r = HtmlNodeDataSchema.safeParse({ htmlPath: 'snip.html' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.autoSize).toBeUndefined();
  });

  it('rejects non-boolean autoSize', () => {
    const r = HtmlNodeDataSchema.safeParse({ htmlPath: 'snip.html', autoSize: 'yes' });
    expect(r.success).toBe(false);
  });
});

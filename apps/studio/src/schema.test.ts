import { describe, expect, it, test } from 'bun:test';
import { CANVAS_NODE_DATA_FIELDS } from '@seeflow/canvas/types';
import { mergeFlowAndStyle, splitFlow } from './merge.ts';
import {
  FlowFreehandNodeSchema,
  FlowGroupNodeSchema,
  FlowIdPattern,
  FlowRectangleNodeSchema,
  FlowSchema,
  NodeTypeSchema,
  ResolvedFlowSchema,
  SeeflowManifestSchema,
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'A',
          },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
        },
        {
          id: 'c',
          type: 'rectangle' as const,
          position: { x: 200, y: 0 },
          data: { name: 'C' },
        },
        {
          id: 'd',
          type: 'rectangle' as const,
          position: { x: 300, y: 0 },
          data: { name: 'D' },
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

  it('round-trips each geometric node variant', () => {
    // Flat-types refactor: visual kind is the `type` field. The 11 geometric
    // variants share the same data schema; the discriminated union routes
    // them to the right renderer via `type` alone.
    const make = (
      type:
        | 'rectangle'
        | 'ellipse'
        | 'sticky'
        | 'text'
        | 'database'
        | 'server'
        | 'user'
        | 'queue'
        | 'cloud'
        | 'diamond'
        | 'hexagon',
    ) => ({
      version: 2 as const,
      name: 'shape-demo',
      nodes: [
        {
          id: `shape-${type}`,
          type,
          position: { x: 10, y: 20 },
          data: { name: `${type} note` },
        },
      ],
      connectors: [],
    });

    for (const type of [
      'rectangle',
      'ellipse',
      'sticky',
      'text',
      'database',
      'server',
      'user',
      'queue',
      'cloud',
      'diamond',
      'hexagon',
    ] as const) {
      const result = ResolvedFlowSchema.safeParse(make(type));
      if (!result.success) {
        throw new Error(`expected ${type} to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== type) throw new Error(`expected ${type}`);
      expect(node.data.name).toBe(`${type} note`);
    }
  });

  it('accepts a database node with no label (illustrative geometric)', () => {
    const demo = {
      version: 2 as const,
      name: 'db-shape',
      nodes: [
        {
          id: 'db-1',
          type: 'database' as const,
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected database to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'database') throw new Error('expected database');
  });

  it('accepts a geometric node without an optional label', () => {
    const demo = {
      version: 2 as const,
      name: 'no-label-shape',
      nodes: [
        {
          id: 'shape-1',
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown node type', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-shape',
      nodes: [
        {
          id: 'shape-1',
          type: 'pyramid' as const,
          position: { x: 0, y: 0 },
          data: {},
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'P',
            width: 200,
            height: 80,
            borderColor: 'blue' as const,
            backgroundColor: 'amber' as const,
          },
        },
        {
          id: 's',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: {
            name: 'S',
            width: 160,
            height: 60,
          },
        },
        {
          id: 'shape-1',
          type: 'sticky' as const,
          position: { x: 200, y: 0 },
          data: {
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'S' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'S',
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'S',
            borderColor: 'magenta',
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
        },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', color: 'magenta' }],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('accepts a non-negative borderSize on nodes and connectors, rejects negatives', () => {
    const make = (nodeBorderSize: unknown, connBorderSize: unknown) => ({
      version: 2 as const,
      name: 'border-size',
      nodes: [
        {
          id: 'a',
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'A',
            borderSize: nodeBorderSize,
          },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
    if (node?.type !== 'rectangle') throw new Error('expected rectangle');
    expect(node.data.borderSize).toBe(3);
    expect(ok.data.connectors[0]?.borderSize).toBe(4);

    // 0 is now accepted (exposes "no border" on the width slider).
    expect(ResolvedFlowSchema.safeParse(make(0, 0)).success).toBe(true);
    // Negatives still rejected.
    expect(ResolvedFlowSchema.safeParse(make(-2, 4)).success).toBe(false);
    expect(ResolvedFlowSchema.safeParse(make(3, -1)).success).toBe(false);
  });

  it('accepts cornerRadius=12 and cornerRadius=0 on a node, rejects negative values (US-001)', () => {
    const make = (cornerRadius: unknown) => ({
      version: 2 as const,
      name: 'corner-radius',
      nodes: [
        {
          id: 'p',
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: {
            name: 'P',
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
    if (node12?.type !== 'rectangle') throw new Error('expected rectangle');
    expect(node12.data.cornerRadius).toBe(12);

    const ok0 = ResolvedFlowSchema.safeParse(make(0));
    if (!ok0.success) {
      throw new Error(`expected cornerRadius=0 to parse, got: ${JSON.stringify(ok0.error.issues)}`);
    }

    expect(ResolvedFlowSchema.safeParse(make(-5)).success).toBe(false);
  });

  // US-004: ImageNodeDataSchema hard-cut from a `data:image/...` URL to a
  // relative `path` under the project root. The renderer resolves it via
  // the file-serving endpoint added in US-001. Path-safety:
  // no absolute paths, no `..` traversal, no leading slash.
  it('parses a demo containing one type:image node with data.path (US-004)', () => {
    const demo = {
      version: 2 as const,
      name: 'image-demo',
      nodes: [
        {
          id: 'img-1',
          type: 'image' as const,
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
    if (node?.type !== 'image') throw new Error('expected image');
    expect(node.data.path).toBe('nodes/img-1/pixel.png');
    expect(node.data.alt).toBe('pixel');
  });

  it('rejects an image node whose data carries the legacy `image` key (US-004 hard-cut)', () => {
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
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { image: 'data:image/png;base64,iVBORw0KGgo=' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an image node whose path is absolute (US-004)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-image-abs',
      nodes: [
        {
          id: 'img-1',
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { path: '/etc/passwd' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an image node whose path uses `..` traversal (US-004)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-image-traversal',
      nodes: [
        {
          id: 'img-1',
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { path: '../../etc/passwd' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects an image node whose path is outside its nodes/<id>/ folder', () => {
    const result = ResolvedFlowSchema.safeParse({
      version: 2 as const,
      name: 'wrong-folder',
      nodes: [
        {
          id: 'node-abc',
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { path: 'assets/foo.png' },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts an image node whose path is under its own nodes/<id>/ folder', () => {
    const result = ResolvedFlowSchema.safeParse({
      version: 2 as const,
      name: 'good-folder',
      nodes: [
        {
          id: 'node-abc',
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { path: 'nodes/node-abc/foo.png' },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(true);
  });

  // Manifest-driven projects store the file under <flowDir>/nodes/<id>/ and
  // the upload endpoint returns the project-root-relative form (e.g.
  // 'flows/main/nodes/<id>/foo.png'). The check must accept both the bare and
  // flow-dir-prefixed forms — otherwise a drop followed by a move trips the
  // post-mutation ResolvedFlowSchema parse and the new image disappears.
  it('accepts an image node whose path is under <flowDir>/nodes/<id>/ (manifest project)', () => {
    const result = ResolvedFlowSchema.safeParse({
      version: 2 as const,
      name: 'manifest-folder',
      nodes: [
        {
          id: 'node-abc',
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { path: 'flows/main/nodes/node-abc/foo.png' },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an image node whose path uses a different node id under <flowDir>/nodes/', () => {
    const result = ResolvedFlowSchema.safeParse({
      version: 2 as const,
      name: 'wrong-id-in-manifest-path',
      nodes: [
        {
          id: 'node-abc',
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { path: 'flows/main/nodes/node-other/foo.png' },
        },
      ],
      connectors: [],
    });
    expect(result.success).toBe(false);
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
          type: 'image' as const,
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
    if (node?.type !== 'image') throw new Error('expected image');
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
          type: 'image' as const,
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
    if (node?.type !== 'image') throw new Error('expected image');
    expect(node.data.borderColor).toBeUndefined();
    expect(node.data.borderWidth).toBeUndefined();
    expect(node.data.borderStyle).toBeUndefined();
  });

  it('rejects an image node with borderWidth outside the 0–8 range (US-014)', () => {
    const basePath = 'nodes/img-1/pixel.png';
    // 0 is now accepted (the user-facing slider exposes it as "no border").
    const zero = {
      version: 2 as const,
      name: 'zero-w',
      nodes: [
        {
          id: 'img-1',
          type: 'image' as const,
          position: { x: 0, y: 0 },
          data: { path: basePath, borderWidth: 0 },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(zero).success).toBe(true);

    const tooSmall = {
      ...zero,
      nodes: [{ ...zero.nodes[0], data: { path: basePath, borderWidth: -1 } }],
    };
    expect(ResolvedFlowSchema.safeParse(tooSmall).success).toBe(false);

    const tooLarge = {
      ...zero,
      nodes: [{ ...zero.nodes[0], data: { path: basePath, borderWidth: 9 } }],
    };
    expect(ResolvedFlowSchema.safeParse(tooLarge).success).toBe(false);
  });

  it('accepts a connector pointing at a type:image node id (US-002)', () => {
    const demo = {
      version: 2 as const,
      name: 'image-conn',
      nodes: [
        {
          id: 's',
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'S' },
        },
        {
          id: 'img-1',
          type: 'image' as const,
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

  // US-023: a type:icon node is a valid connector endpoint in either role — the
  // connector→node superRefine cares only that the referenced id exists in
  // nodes[], not about the node's discriminator. Schema-level fence so a future
  // change can't add a hidden node-type whitelist.
  it('accepts a connector pointing at a type:icon node id as source AND target (US-023)', () => {
    const demo = {
      version: 2 as const,
      name: 'icon-conn',
      nodes: [
        {
          id: 's',
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'S' },
        },
        {
          id: 'icon-1',
          type: 'icon' as const,
          position: { x: 100, y: 0 },
          data: { icon: 'shopping-cart' },
        },
        {
          id: 'icon-2',
          type: 'icon' as const,
          position: { x: 200, y: 0 },
          data: { icon: 'circle' },
        },
      ],
      connectors: [
        // rectangle → icon
        { id: 'c1', source: 's', target: 'icon-1' },
        // icon → rectangle
        { id: 'c2', source: 'icon-1', target: 's' },
        // icon → icon
        { id: 'c3', source: 'icon-1', target: 'icon-2' },
      ],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.connectors).toHaveLength(3);
  });

  it('parses a type:icon node with only the required icon field (US-008)', () => {
    const demo = {
      version: 2 as const,
      name: 'icon-demo',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon' as const,
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
    if (node?.type !== 'icon') throw new Error('expected icon');
    expect(node.data.icon).toBe('shopping-cart');
    expect(node.data.color).toBeUndefined();
    expect(node.data.strokeWidth).toBeUndefined();
  });

  it('parses a type:icon node with every optional field set (US-008)', () => {
    const demo = {
      version: 2 as const,
      name: 'icon-full',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon' as const,
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
    if (node?.type !== 'icon') throw new Error('expected icon');
    expect(node.data.icon).toBe('help-circle');
    expect(node.data.color).toBe('blue');
    expect(node.data.strokeWidth).toBe(1.5);
    expect(node.data.width).toBe(64);
    expect(node.data.height).toBe(64);
    expect(node.data.alt).toBe('help indicator');
    expect(node.data.name).toBe('Help');
  });

  it('parses a type:icon node with an empty label (US-002 backwards compat sentinel)', () => {
    // Empty string is the documented "no label" sentinel and must round-trip
    // through the schema (consumers can treat empty + absent the same way at
    // render time without needing a coercion step).
    const demo = {
      version: 2 as const,
      name: 'icon-empty-label',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon' as const,
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
    if (node?.type !== 'icon') throw new Error('expected icon');
    expect(node.data.name).toBe('');
  });

  it('accepts a vendor-prefixed decorative icon on a geometric node (US-001 cloud icon packs)', () => {
    const demo = {
      version: 2 as const,
      name: 'vendor-decorative',
      nodes: [
        {
          id: 'r1',
          type: 'rectangle' as const,
          data: { icon: 'aws:lambda' },
        },
      ],
      connectors: [],
    };
    const result = FlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'rectangle') throw new Error('expected rectangle');
    expect(node.data.icon).toBe('aws:lambda');
  });

  it('accepts a vendor-prefixed icon on a type:icon node (US-001 cloud icon packs)', () => {
    const demo = {
      version: 2 as const,
      name: 'vendor-icon-node',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon' as const,
          data: { icon: 'azure:functions' },
        },
      ],
      connectors: [],
    };
    const result = FlowSchema.safeParse(demo);
    if (!result.success) {
      throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'icon') throw new Error('expected icon');
    expect(node.data.icon).toBe('azure:functions');
  });

  it('rejects a type:icon node with an empty icon string (US-008)', () => {
    const demo = {
      version: 2 as const,
      name: 'bad-icon',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon' as const,
          position: { x: 0, y: 0 },
          data: { icon: '' },
        },
      ],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects a type:icon node strokeWidth outside [0.5, 4] (US-008)', () => {
    const make = (strokeWidth: number) => ({
      version: 2 as const,
      name: 'bad-stroke',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon' as const,
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

  it('rejects a type:icon node with non-positive width or height (US-008)', () => {
    const make = (width: number, height: number) => ({
      version: 2 as const,
      name: 'bad-icon-size',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon' as const,
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle' as const,
          position: { x: 0, y: 0 },
          data: { name: 'A' },
        },
        {
          id: 'b',
          type: 'rectangle' as const,
          position: { x: 100, y: 0 },
          data: { name: 'B' },
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
          type: 'rectangle',
          position: { x: 0, y: 0 },
          data: {
            name: 'POST /action',
          },
        },
        {
          id: 'worker',
          type: 'rectangle',
          position: { x: 300, y: 0 },
          data: { name: 'my-worker' },
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
    };
    const baseDemo = (data: Record<string, unknown>) => ({
      version: 2 as const,
      name: 'minimal',
      nodes: [{ id: 'n1', type: 'rectangle' as const, position: { x: 0, y: 0 }, data }],
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
            type: 'rectangle',
            position: { x: 0, y: 0 },
            data: {
              name: 'p',
              description: 'short body',
              detail: 'long-form\nnotes',
            },
          },
        },
        {
          id: 'state',
          node: {
            id: 'n-state',
            type: 'rectangle',
            position: { x: 0, y: 0 },
            data: {
              name: 's',
              description: 'short body',
              detail: 'long-form notes',
            },
          },
        },
        {
          id: 'shape',
          node: {
            id: 'n-shape',
            type: 'rectangle',
            position: { x: 0, y: 0 },
            data: {
              description: 'short body',
              detail: 'long-form\nnotes',
            },
          },
        },
        {
          id: 'image',
          node: {
            id: 'n-image',
            type: 'image',
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
            type: 'icon',
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
        type: 'rectangle',
        position: { x: 0, y: 0 },
        data: {},
      });
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
    });

    it('accepts description with no length cap (large free-form text round-trips)', () => {
      const big = 'line\n'.repeat(2000); // 10kB of newlines
      const demo = makeDemoWithNode({
        id: 'n1',
        type: 'rectangle',
        position: { x: 0, y: 0 },
        data: { description: big },
      });
      const parsed = ResolvedFlowSchema.safeParse(demo);
      if (!parsed.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(parsed.error.issues)}`);
      }
      const first = parsed.data.nodes[0];
      if (first?.type !== 'rectangle') throw new Error('expected rectangle');
      expect(first.data.description).toBe(big);
    });

    it('accepts empty string for both fields (transient state during clear)', () => {
      // The wire-format merge logic (operations.ts) strips '' on serialize,
      // but the schema itself must accept '' so the optimistic override
      // (which carries '' through React state) still validates if a stray
      // SSE echo replays it back.
      const demo = makeDemoWithNode({
        id: 'n1',
        type: 'rectangle',
        position: { x: 0, y: 0 },
        data: { description: '', detail: '' },
      });
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
    });
  });

  // type:'html' carries author-written HTML inline via `data.html`. The studio
  // externalizes content to `<project>/nodes/<id>/view.html` and stores a
  // `file://` ref in flow.json; the file-ref resolver inlines on read.
  describe('type:html', () => {
    it('parses a minimal type:html node with optional html (omitted)', () => {
      const demo = {
        version: 2 as const,
        name: 'html-demo',
        nodes: [
          {
            id: 'html-1',
            type: 'html' as const,
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
      if (node?.type !== 'html') throw new Error('expected html');
      expect(node.data.html).toBeUndefined();
      expect(node.data.name).toBeUndefined();
    });

    it('accepts html as free-form content', () => {
      const result = ResolvedFlowSchema.safeParse({
        version: 2,
        name: 'html-free',
        nodes: [
          { id: 'n', type: 'html', position: { x: 0, y: 0 }, data: { html: '<div>hi</div>' } },
        ],
        connectors: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts html as a file:// ref (round-trip from disk)', () => {
      const result = ResolvedFlowSchema.safeParse({
        version: 2,
        name: 'html-file',
        nodes: [
          { id: 'n', type: 'html', position: { x: 0, y: 0 }, data: { html: 'file://view.html' } },
        ],
        connectors: [],
      });
      expect(result.success).toBe(true);
    });

    it('round-trips a type:html node with label + every NodeVisualBaseShape field', () => {
      const demo = {
        version: 2 as const,
        name: 'html-styled',
        nodes: [
          {
            id: 'html-1',
            type: 'html' as const,
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
      if (node?.type !== 'html') throw new Error('expected html');
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

    it('round-trips description / detail on a type:html node', () => {
      const demo = {
        version: 2 as const,
        name: 'html-meta',
        nodes: [
          {
            id: 'html-1',
            type: 'html' as const,
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

    it('accepts a type:html node as a connector endpoint (source AND target)', () => {
      const demo = {
        version: 2 as const,
        name: 'html-conn',
        nodes: [
          {
            id: 's',
            type: 'rectangle' as const,
            position: { x: 0, y: 0 },
            data: { name: 'S' },
          },
          {
            id: 'html-1',
            type: 'html' as const,
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

  // type:'linkflow' — clickable node that navigates to another flow. `target`
  // is an optional { project, flow } slug pair (both matching FlowIdPattern);
  // unlinked is the freshly-dropped state, with the picker dialog filling it
  // in later. Broken-link detection (does the target still resolve?) is a
  // render-time check, not a parse-time refine.
  describe('type:linkflow', () => {
    it('parses a type:linkflow node with a target slug pair', () => {
      const demo = {
        version: 2 as const,
        name: 'linkflow-demo',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            position: { x: 10, y: 20 },
            data: { target: { project: 'demo-app', flow: 'checkout' } },
          },
        ],
        connectors: [],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(result.error.issues)}`);
      }
      const node = result.data.nodes[0];
      if (node?.type !== 'linkflow') throw new Error('expected linkflow');
      expect(node.data.target).toEqual({ project: 'demo-app', flow: 'checkout' });
    });

    it('parses a type:linkflow node WITHOUT a target (unlinked state)', () => {
      const demo = {
        version: 2 as const,
        name: 'linkflow-unlinked',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            position: { x: 0, y: 0 },
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
      if (node?.type !== 'linkflow') throw new Error('expected linkflow');
      expect(node.data.target).toBeUndefined();
    });

    it('rejects a target whose project slug violates FlowIdPattern', () => {
      const demo = {
        version: 2 as const,
        name: 'bad-project-slug',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            position: { x: 0, y: 0 },
            data: { target: { project: 'Demo App', flow: 'checkout' } },
          },
        ],
        connectors: [],
      };
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
    });

    it('rejects a target whose flow slug violates FlowIdPattern', () => {
      const demo = {
        version: 2 as const,
        name: 'bad-flow-slug',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            position: { x: 0, y: 0 },
            data: { target: { project: 'demo-app', flow: '-leading-dash' } },
          },
        ],
        connectors: [],
      };
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
    });

    it('rejects a target missing either project or flow', () => {
      const missingFlow = {
        version: 2 as const,
        name: 'missing-flow',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            position: { x: 0, y: 0 },
            data: { target: { project: 'demo-app' } },
          },
        ],
        connectors: [],
      };
      expect(ResolvedFlowSchema.safeParse(missingFlow).success).toBe(false);
      const missingProject = {
        ...missingFlow,
        nodes: [
          {
            ...missingFlow.nodes[0],
            data: { target: { flow: 'checkout' } },
          },
        ],
      };
      expect(ResolvedFlowSchema.safeParse(missingProject).success).toBe(false);
    });

    it('parses unresolved targets (renames/deletes) without complaint — broken-link is a render concern', () => {
      // Target slug pair is well-formed but the referenced flow may not exist
      // in the registry. The schema must NOT reject this — the renderer
      // surfaces the broken-link state at runtime.
      const demo = {
        version: 2 as const,
        name: 'unresolved-target',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            position: { x: 0, y: 0 },
            data: { target: { project: 'no-such-project', flow: 'no-such-flow' } },
          },
        ],
        connectors: [],
      };
      expect(ResolvedFlowSchema.safeParse(demo).success).toBe(true);
    });

    it('round-trips a type:linkflow node byte-for-byte (FlowSchema, .strict())', () => {
      const flow = {
        version: 2 as const,
        name: 'linkflow-round-trip',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            data: {
              name: 'See checkout',
              target: { project: 'demo-app', flow: 'checkout' },
            },
          },
        ],
        connectors: [],
      };
      const parsed = FlowSchema.safeParse(flow);
      if (!parsed.success) {
        throw new Error(`expected to parse, got: ${JSON.stringify(parsed.error.issues)}`);
      }
      const serialized = JSON.parse(JSON.stringify(parsed.data)) as unknown;
      expect(serialized).toEqual(flow);
    });

    it('FlowSchema .strict() rejects unknown keys on a linkflow node', () => {
      const flow = {
        version: 2 as const,
        name: 'linkflow-strict',
        nodes: [
          {
            id: 'lf-1',
            type: 'linkflow' as const,
            data: {
              target: { project: 'demo-app', flow: 'checkout' },
              bogus: true,
            },
          },
        ],
        connectors: [],
      };
      expect(FlowSchema.safeParse(flow).success).toBe(false);
    });
  });
});

describe("type:'html' autoSize (via ResolvedFlowSchema)", () => {
  const makeHtmlData = (data: Record<string, unknown>) =>
    ResolvedFlowSchema.safeParse({
      version: 2,
      name: 'html-autosize',
      nodes: [{ id: 'n', type: 'html', position: { x: 0, y: 0 }, data }],
      connectors: [],
    });

  it('parses with autoSize: true and no width/height', () => {
    const r = makeHtmlData({ html: '<p>x</p>', autoSize: true });
    expect(r.success).toBe(true);
  });

  it('parses with autoSize: false plus width/height', () => {
    const r = makeHtmlData({
      html: '<p>x</p>',
      autoSize: false,
      width: 480,
      height: 320,
    });
    expect(r.success).toBe(true);
  });

  it('parses with autoSize absent (field is optional)', () => {
    const r = makeHtmlData({ html: '<p>x</p>' });
    expect(r.success).toBe(true);
  });

  it('rejects non-boolean autoSize', () => {
    const r = makeHtmlData({ html: '<p>x</p>', autoSize: 'yes' });
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
          type: 'rectangle',
          data: {
            name: 'POST /x',
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
          type: 'rectangle',
          data: {
            name: 'X',
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
          type: 'rectangle',
          position: { x: 0, y: 0 },
          data: {
            name: 'X',
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
          type: 'rectangle',
          data: {
            name: 'A',
          },
        },
        {
          id: 'b',
          type: 'rectangle',
          data: { name: 'B' },
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
          type: 'rectangle',
          data: {
            name: 'A',
          },
        },
        {
          id: 'b',
          type: 'rectangle',
          data: { name: 'B' },
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

  it('accepts type:icon-specific color/strokeWidth and type:html autoSize', () => {
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
          headShape: 'many',
          fontSize: 11,
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('accepts every connector headShape and rejects unknown ones', () => {
    for (const headShape of [
      'arrow',
      'one',
      'many',
      'optional-many',
      'diamond',
      'circle',
    ] as const) {
      const r = StyleSchema.safeParse({ connectors: { c1: { headShape } } });
      expect(r.success).toBe(true);
    }
    const bad = StyleSchema.safeParse({ connectors: { c1: { headShape: 'cylinder' } } });
    expect(bad.success).toBe(false);
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

// US-009: flat-node-types refactor — coverage that pins the 14-tag discriminator
// surface, the per-type required fields, and the capability-on-every-type
// invariant at the schema level. The flat schema's central claim is that
// `handlerModule` is independent of `type` — these tests fence that claim
// against drift.
describe('US-009: flat node types — 17-tag matrix + capability invariants', () => {
  const ALL_TYPES = [
    'rectangle',
    'ellipse',
    'sticky',
    'text',
    'database',
    'server',
    'user',
    'queue',
    'cloud',
    'diamond',
    'hexagon',
    'triangle',
    'parallelogram',
    'document',
    'image',
    'html',
    'icon',
  ] as const;

  // Minimal valid `data` per type, satisfying each variant's required fields
  // and nothing else. Geometric types accept `data: {}`; image needs path
  // (anchored under `nodes/<id>/`); icon needs a non-empty icon name; html
  // accepts an empty object (html field is optional).
  const minimalData = (type: (typeof ALL_TYPES)[number], id: string): Record<string, unknown> => {
    if (type === 'image') return { path: `nodes/${id}/pixel.png` };
    if (type === 'icon') return { icon: 'shopping-cart' };
    return {};
  };

  it('every one of the 17 type tags parses with a minimal valid payload', () => {
    for (const type of ALL_TYPES) {
      const id = `n-${type}`;
      const demo = {
        version: 2 as const,
        name: `minimal-${type}`,
        nodes: [{ id, type, position: { x: 0, y: 0 }, data: minimalData(type, id) }],
        connectors: [],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(
          `expected ${type} minimal payload to parse, got: ${JSON.stringify(result.error.issues)}`,
        );
      }
      expect(result.data.nodes[0]?.type).toBe(type);
    }
  });

  it('rejects an unknown type tag (only the 19 flat tags are valid)', () => {
    const demo = {
      version: 2 as const,
      name: 'unknown-type',
      nodes: [{ id: 'n', type: 'pyramid' as const, position: { x: 0, y: 0 }, data: {} }],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  it('rejects type:image without the required path field', () => {
    const demo = {
      version: 2 as const,
      name: 'image-missing-path',
      nodes: [{ id: 'img-1', type: 'image' as const, position: { x: 0, y: 0 }, data: {} }],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(demo);
    expect(result.success).toBe(false);
  });

  it('rejects type:icon without the required icon field', () => {
    const demo = {
      version: 2 as const,
      name: 'icon-missing-icon',
      nodes: [{ id: 'i', type: 'icon' as const, position: { x: 0, y: 0 }, data: {} }],
      connectors: [],
    };
    expect(ResolvedFlowSchema.safeParse(demo).success).toBe(false);
  });

  // The on-disk FlowSchema (FlowGeometricNodeData) is `.strict()`, so the
  // image-only fields `path` and `alt` are rejected on a geometric variant.
  // ResolvedFlowSchema is the merged-with-style shape and is intentionally
  // non-strict to allow forward-compat fields — the strict gate lives at
  // the persist boundary.
  it('FlowSchema rejects type:rectangle carrying the image-only `path` field', () => {
    const flow = {
      version: 2 as const,
      name: 'rect-with-image-fields',
      nodes: [
        {
          id: 'n',
          type: 'rectangle' as const,
          data: { name: 'X', path: 'nodes/n/cover.png' },
        },
      ],
      connectors: [],
    };
    expect(FlowSchema.safeParse(flow).success).toBe(false);
  });

  it('FlowSchema rejects type:rectangle carrying the image-only `alt` field', () => {
    const flow = {
      version: 2 as const,
      name: 'rect-with-alt',
      nodes: [
        {
          id: 'n',
          type: 'rectangle' as const,
          data: { name: 'X', alt: 'a label' },
        },
      ],
      connectors: [],
    };
    expect(FlowSchema.safeParse(flow).success).toBe(false);
  });

  it('FlowSchema rejects type:rectangle carrying the html-only `html` field', () => {
    const flow = {
      version: 2 as const,
      name: 'rect-with-html',
      nodes: [
        {
          id: 'n',
          type: 'rectangle' as const,
          data: { name: 'X', html: '<p>nope</p>' },
        },
      ],
      connectors: [],
    };
    expect(FlowSchema.safeParse(flow).success).toBe(false);
  });

  it('FlowSchema rejects type:image carrying the html-only `html` field', () => {
    const flow = {
      version: 2 as const,
      name: 'image-with-html',
      nodes: [
        {
          id: 'img-1',
          type: 'image' as const,
          data: { path: 'nodes/img-1/cover.png', html: '<p>nope</p>' },
        },
      ],
      connectors: [],
    };
    expect(FlowSchema.safeParse(flow).success).toBe(false);
  });

  it('FlowSchema rejects type:html carrying the image-only `path` field', () => {
    const flow = {
      version: 2 as const,
      name: 'html-with-path',
      nodes: [
        {
          id: 'h',
          type: 'html' as const,
          data: { html: '<p>x</p>', path: 'nodes/h/x.png' },
        },
      ],
      connectors: [],
    };
    expect(FlowSchema.safeParse(flow).success).toBe(false);
  });

  // Core schema-level claim of the flat-types refactor: the `handlerModule`
  // capability is independent of `type` and accepted on every variant.
  it('every one of the 14 type tags accepts handlerModule in data', () => {
    for (const type of ALL_TYPES) {
      const id = `n-${type}`;
      const demo = {
        version: 2 as const,
        name: `handler-${type}`,
        nodes: [
          {
            id,
            type,
            position: { x: 0, y: 0 },
            data: {
              ...minimalData(type, id),
              handlerModule: `${type}-handler`,
            },
          },
        ],
        connectors: [],
      };
      const result = ResolvedFlowSchema.safeParse(demo);
      if (!result.success) {
        throw new Error(
          `expected ${type} with handlerModule to parse, got: ${JSON.stringify(result.error.issues)}`,
        );
      }
      const node = result.data.nodes[0];
      if (node?.type !== type) throw new Error(`expected ${type}`);
      expect((node.data as { handlerModule?: unknown }).handlerModule).toBe(`${type}-handler`);
    }
  });

  // FlowSchema (disk-side) variant of the capability-on-every-type claim —
  // since the disk-side data schemas are `.strict()`, this is a stronger
  // assertion than the ResolvedFlowSchema variant above: the capability field
  // is explicitly enumerated in each variant's allowed-keys set.
  it('FlowSchema accepts handlerModule on every one of the 14 types', () => {
    const minimalFlowData = (type: (typeof ALL_TYPES)[number], id: string) => {
      const base = { handlerModule: `${type}-handler` };
      if (type === 'image') return { ...base, path: `nodes/${id}/pixel.png` };
      if (type === 'icon') return { ...base, icon: 'shopping-cart' };
      return base;
    };

    for (const type of ALL_TYPES) {
      const id = `n-${type}`;
      const flow = {
        version: 2 as const,
        name: `caps-${type}`,
        nodes: [{ id, type, data: minimalFlowData(type, id) }],
        connectors: [],
      };
      const result = FlowSchema.safeParse(flow);
      if (!result.success) {
        throw new Error(
          `expected ${type} with handlerModule to parse, got: ${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });
});

// US-003: 'component' node lands in NodeTypeSchema with the spec/action shapes
// needed to drive a json-render reactive tree. The round-trip below proves the
// Resolved schema accepts spec + state + set actions; the negative case
// fences SetAction.path against missing leading '/'.
describe("US-003: 'component' node type + ComponentSpec/Action schemas", () => {
  it('NodeTypeSchema accepts "component"', () => {
    expect(NodeTypeSchema.safeParse('component').success).toBe(true);
  });

  it('ResolvedFlowSchema round-trips a component node with set actions', () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [
        {
          id: 'n1',
          type: 'component' as const,
          position: { x: 0, y: 0 },
          data: {
            spec: {
              root: 'root',
              state: { '/tab': 'a' },
              actions: {
                switchTab: {
                  kind: 'set' as const,
                  path: '/tab',
                  value: { $param: 'to' },
                },
              },
              elements: {
                root: {
                  type: 'Button',
                  props: { label: 'Hi', onClick: { $action: 'switchTab' } },
                },
              },
            },
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(flow);
    if (!result.success) {
      throw new Error(
        `expected component round-trip to parse, got: ${JSON.stringify(result.error.issues)}`,
      );
    }
    const node = result.data.nodes[0];
    if (node?.type !== 'component') throw new Error('expected component node');
    expect(node.data.spec.root).toBe('root');
    expect(node.data.spec.actions?.switchTab?.kind).toBe('set');
  });

  it('ResolvedFlowSchema rejects a set action whose path lacks the leading "/"', () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [
        {
          id: 'n1',
          type: 'component' as const,
          position: { x: 0, y: 0 },
          data: {
            spec: {
              root: 'root',
              actions: { bad: { kind: 'set' as const, path: 'no-slash', value: 1 } },
              elements: { root: { type: 'Text', props: { text: 'x' } } },
            },
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(flow);
    expect(result.success).toBe(false);
    if (result.success) return;
    const pathIssue = result.error.issues.find(
      (i) => i.path.some((seg) => seg === 'bad') && i.path.includes('path'),
    );
    expect(pathIssue).toBeDefined();
  });
});

describe('US-004: catalog superRefine on ResolvedFlowSchema', () => {
  it('rejects an element whose type is not in the catalog', () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [
        {
          id: 'n1',
          type: 'component' as const,
          position: { x: 0, y: 0 },
          data: {
            spec: {
              root: 'root',
              elements: { root: { type: 'NotARealComponent', props: {} } },
            },
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(flow);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) =>
        i.path[0] === 'nodes' &&
        i.path[2] === 'data' &&
        i.path[3] === 'spec' &&
        i.path[4] === 'elements' &&
        i.path[5] === 'root' &&
        i.path[6] === 'type',
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('NotARealComponent');
  });

  it('rejects a Button element with empty props (label required)', () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [
        {
          id: 'n1',
          type: 'component' as const,
          position: { x: 0, y: 0 },
          data: {
            spec: {
              root: 'btn',
              elements: { btn: { type: 'Button', props: {} } },
            },
          },
        },
      ],
      connectors: [],
    };
    const result = ResolvedFlowSchema.safeParse(flow);
    expect(result.success).toBe(false);
    if (result.success) return;
    const propIssue = result.error.issues.find(
      (i) =>
        i.path[0] === 'nodes' &&
        i.path[3] === 'spec' &&
        i.path[4] === 'elements' &&
        i.path[5] === 'btn' &&
        i.path[6] === 'props' &&
        i.path[7] === 'label',
    );
    expect(propIssue).toBeDefined();
  });
});

// Visual fields the canvas accepts on GeometricNodeData but the on-disk Zod
// schema deliberately strips into style.json. Kept here (not in canvas) so the
// whitelist lives with the schema it's whitelisting against.
const STRIPPED_VISUAL_FIELDS = new Set([
  'width',
  'height',
  'borderColor',
  'backgroundColor',
  'borderSize',
  'borderStyle',
  'fontSize',
  'fontFamily',
  'textAlign',
  'cornerRadius',
  'shadow',
]);

describe('SeeflowManifestSchema', () => {
  it('parses a valid minimal manifest (single flow)', () => {
    const data = {
      version: 1,
      name: 'Order Pipeline',
      defaultFlow: 'main',
      flows: [{ id: 'main', name: 'Main' }],
    };
    const result = SeeflowManifestSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected valid manifest to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.data.version).toBe(1);
    expect(result.data.name).toBe('Order Pipeline');
    expect(result.data.defaultFlow).toBe('main');
    expect(result.data.flows).toHaveLength(1);
    expect(result.data.flows[0]?.id).toBe('main');
  });

  it('parses a valid multi-flow manifest with description and icons', () => {
    const data = {
      version: 1,
      name: 'Component Showcase',
      description: 'Demonstrates every node type and visual',
      defaultFlow: 'main',
      flows: [
        { id: 'main', name: 'Main', icon: 'workflow' },
        { id: 'retry', name: 'Retry path', icon: 'rotate-ccw' },
      ],
    };
    const result = SeeflowManifestSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `expected valid multi-flow manifest to parse, got: ${JSON.stringify(result.error.issues, null, 2)}`,
      );
    }
    expect(result.data.description).toBe('Demonstrates every node type and visual');
    expect(result.data.flows).toHaveLength(2);
    expect(result.data.flows[1]?.icon).toBe('rotate-ccw');
  });

  it('rejects a flow id that does not match FlowIdPattern', () => {
    const data = {
      version: 1,
      name: 'Bad Ids',
      defaultFlow: 'Main',
      flows: [{ id: 'Main', name: 'Main' }],
    };
    const result = SeeflowManifestSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    const idIssue = result.error.issues.find(
      (issue) =>
        issue.path.length === 3 &&
        issue.path[0] === 'flows' &&
        issue.path[1] === 0 &&
        issue.path[2] === 'id',
    );
    expect(idIssue).toBeDefined();
  });

  it('rejects an empty flows[] array', () => {
    const data = {
      version: 1,
      name: 'Empty',
      defaultFlow: 'main',
      flows: [],
    };
    const result = SeeflowManifestSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    const flowsIssue = result.error.issues.find(
      (issue) => issue.path.length === 1 && issue.path[0] === 'flows',
    );
    expect(flowsIssue).toBeDefined();
  });

  it('rejects duplicate flow ids', () => {
    const data = {
      version: 1,
      name: 'Dupes',
      defaultFlow: 'main',
      flows: [
        { id: 'main', name: 'Main' },
        { id: 'main', name: 'Main again' },
      ],
    };
    const result = SeeflowManifestSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    const dupIssue = result.error.issues.find((issue) => issue.message.includes('duplicate'));
    expect(dupIssue).toBeDefined();
  });

  it('rejects defaultFlow that does not match any entry in flows[]', () => {
    const data = {
      version: 1,
      name: 'Missing default',
      defaultFlow: 'ghost',
      flows: [{ id: 'main', name: 'Main' }],
    };
    const result = SeeflowManifestSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    const defaultIssue = result.error.issues.find(
      (issue) => issue.path.length === 1 && issue.path[0] === 'defaultFlow',
    );
    expect(defaultIssue).toBeDefined();
    expect(defaultIssue?.message).toContain('ghost');
  });

  it('FlowIdPattern accepts lowercase alphanumerics + dashes starting with alnum', () => {
    expect(FlowIdPattern.test('main')).toBe(true);
    expect(FlowIdPattern.test('retry-v2')).toBe(true);
    expect(FlowIdPattern.test('flow-1')).toBe(true);
    expect(FlowIdPattern.test('1main')).toBe(true);
    expect(FlowIdPattern.test('Main')).toBe(false);
    expect(FlowIdPattern.test('-main')).toBe(false);
    expect(FlowIdPattern.test('main_v2')).toBe(false);
    expect(FlowIdPattern.test('')).toBe(false);
  });
});

describe('canvas ↔ disk schema parity', () => {
  it('every canvas GeometricNodeData field is either persisted to disk or in STRIPPED_VISUAL_FIELDS', () => {
    const diskFields = new Set(Object.keys(FlowRectangleNodeSchema.shape.data.shape));
    const offenders: string[] = [];
    for (const field of Object.keys(CANVAS_NODE_DATA_FIELDS)) {
      const persisted = diskFields.has(field);
      const stripped = STRIPPED_VISUAL_FIELDS.has(field);
      if (!persisted && !stripped) offenders.push(field);
    }
    if (offenders.length > 0) {
      const list = offenders.map((f) => `'${f}'`).join(', ');
      throw new Error(
        `Canvas field(s) ${list} are neither in the disk schema (FlowGeometricNodeData) nor in STRIPPED_VISUAL_FIELDS. Add to apps/studio/src/schema.ts (NodeCapabilitiesShape / NodeSemanticBaseShape) to persist, or to STRIPPED_VISUAL_FIELDS in this test if it is a visual stripped into style.json.`,
      );
    }
  });
});

describe('freehand node type', () => {
  test('NodeTypeSchema accepts freehand', () => {
    expect(NodeTypeSchema.safeParse('freehand').success).toBe(true);
  });

  test('FlowFreehandNodeSchema requires >=2 points', () => {
    const ok = FlowFreehandNodeSchema.safeParse({
      id: 'n1',
      type: 'freehand',
      data: {
        points: [
          [0, 0, 0.5],
          [1, 1, 0.5],
        ],
      },
    });
    expect(ok.success).toBe(true);

    const tooFew = FlowFreehandNodeSchema.safeParse({
      id: 'n1',
      type: 'freehand',
      data: { points: [[0, 0, 0.5]] },
    });
    expect(tooFew.success).toBe(false);
  });

  test('FlowFreehandNodeSchema rejects unknown data fields (strict)', () => {
    const res = FlowFreehandNodeSchema.safeParse({
      id: 'n1',
      type: 'freehand',
      data: {
        points: [
          [0, 0, 0.5],
          [1, 1, 0.5],
        ],
        bogus: true,
      },
    });
    expect(res.success).toBe(false);
  });
});

describe('group node type', () => {
  // A minimal resolved flow with two member nodes + a group containing them.
  const makeResolved = (overrides?: {
    childIds?: string[];
    extraNodes?: Array<Record<string, unknown>>;
  }) => ({
    version: 2 as const,
    name: 'Group flow',
    nodes: [
      { id: 'n1', type: 'rectangle', position: { x: 0, y: 0 }, data: {} },
      { id: 'n2', type: 'rectangle', position: { x: 200, y: 0 }, data: {} },
      ...(overrides?.extraNodes ?? []),
      {
        id: 'g1',
        type: 'group',
        position: { x: -20, y: -40 },
        data: {
          childIds: overrides?.childIds ?? ['n1', 'n2'],
          name: 'My group',
          width: 320,
          height: 200,
          backgroundColor: 'slate',
          borderColor: 'blue',
        },
      },
    ],
    connectors: [],
  });

  test('NodeTypeSchema accepts "group"', () => {
    expect(NodeTypeSchema.safeParse('group').success).toBe(true);
  });

  test('ResolvedFlowSchema parses a valid group referencing existing members', () => {
    const res = ResolvedFlowSchema.safeParse(makeResolved());
    if (!res.success) {
      throw new Error(
        `expected valid group flow, got: ${JSON.stringify(res.error.issues, null, 2)}`,
      );
    }
    const group = res.data.nodes.find((n) => n.id === 'g1');
    expect(group?.type).toBe('group');
    if (group?.type === 'group') {
      expect(group.data.childIds).toEqual(['n1', 'n2']);
    }
  });

  test('childIds defaults to [] when omitted (empty group / labeled zone)', () => {
    const res = FlowGroupNodeSchema.safeParse({
      id: 'g1',
      type: 'group',
      data: { name: 'Zone' },
    });
    if (!res.success) {
      throw new Error(
        `expected default childIds, got: ${JSON.stringify(res.error.issues, null, 2)}`,
      );
    }
    expect(res.data.data.childIds).toEqual([]);
  });

  test('ResolvedFlowSchema rejects a group with a non-existent child id', () => {
    const res = ResolvedFlowSchema.safeParse(makeResolved({ childIds: ['n1', 'ghost'] }));
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.issues.some((i) => /unknown child node: ghost/.test(i.message))).toBe(true);
  });

  test('ResolvedFlowSchema rejects a node that is a member of two groups', () => {
    const doubled = makeResolved();
    doubled.nodes.push({
      id: 'g2',
      type: 'group',
      position: { x: 400, y: 0 },
      data: { childIds: ['n1'], name: 'Other', width: 100, height: 100 },
    });
    const res = ResolvedFlowSchema.safeParse(doubled);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.issues.some((i) => /no double-membership/.test(i.message))).toBe(true);
  });

  test('ResolvedFlowSchema rejects a nested group (group id inside childIds)', () => {
    const nested = makeResolved();
    // g1 already lists n1/n2; add a g2 that tries to contain g1.
    nested.nodes.push({
      id: 'g2',
      type: 'group',
      position: { x: 400, y: 0 },
      data: { childIds: ['g1'], name: 'Outer', width: 500, height: 400 },
    });
    const res = ResolvedFlowSchema.safeParse(nested);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.issues.some((i) => /no nested groups/.test(i.message))).toBe(true);
  });

  test('FlowSchema (on-disk) also enforces membership integrity', () => {
    const res = FlowSchema.safeParse({
      version: 2,
      name: 'Group flow',
      nodes: [
        { id: 'n1', type: 'rectangle', data: {} },
        { id: 'g1', type: 'group', data: { childIds: ['n1', 'ghost'] } },
      ],
      connectors: [],
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.issues.some((i) => /unknown child node: ghost/.test(i.message))).toBe(true);
  });

  test('FlowGroupNodeSchema rejects unknown data fields (strict)', () => {
    const res = FlowGroupNodeSchema.safeParse({
      id: 'g1',
      type: 'group',
      data: { childIds: [], bogus: true },
    });
    expect(res.success).toBe(false);
  });

  test('round-trips: childIds → flow.json, position + visuals → style.json', () => {
    const resolved = makeResolved();
    const parsed = ResolvedFlowSchema.parse(resolved);
    const { flow, style } = splitFlow(parsed as unknown as Parameters<typeof splitFlow>[0]);

    // childIds (semantic) lands in flow.json on the group node.
    const flowGroup = (flow.nodes as Array<Record<string, unknown>>).find((n) => n.id === 'g1');
    expect((flowGroup?.data as { childIds?: string[] }).childIds).toEqual(['n1', 'n2']);
    // Visual + name route correctly: name stays in flow.json; width/colors strip
    // into style.json; childIds must NOT leak into style.json.
    expect((flowGroup?.data as { name?: string }).name).toBe('My group');
    expect((flowGroup?.data as Record<string, unknown>).width).toBeUndefined();
    const styleNodes = (style.nodes ?? {}) as Record<string, Record<string, unknown>>;
    expect(styleNodes.g1?.width).toBe(320);
    expect(styleNodes.g1?.backgroundColor).toBe('slate');
    expect(styleNodes.g1?.position).toEqual({ x: -20, y: -40 });
    expect('childIds' in (styleNodes.g1 ?? {})).toBe(false);

    // The on-disk flow.json re-parses cleanly, and re-merging reproduces the
    // resolved group (childIds + visuals back together).
    const flowReparse = FlowSchema.safeParse(flow);
    expect(flowReparse.success).toBe(true);
    const styleReparse = StyleSchema.safeParse(style);
    expect(styleReparse.success).toBe(true);
    if (flowReparse.success && styleReparse.success) {
      const merged = mergeFlowAndStyle(flowReparse.data, styleReparse.data);
      const mergedGroup = merged.nodes.find((n) => n.id === 'g1');
      expect(mergedGroup?.type).toBe('group');
      if (mergedGroup?.type === 'group') {
        expect(mergedGroup.data.childIds).toEqual(['n1', 'n2']);
        expect(mergedGroup.data.width).toBe(320);
        expect(mergedGroup.data.backgroundColor).toBe('slate');
      }
      expect(mergedGroup?.position).toEqual({ x: -20, y: -40 });
    }
  });
});

// Table node — a Miro-style visual grid. Structure (columns/rows ids + their
// own width/height, sparse cells, headerRow) is intrinsic and self-contained
// in flow.json; generic styling still routes to style.json like every node.
describe('table node', () => {
  const tableNode = {
    id: 't1',
    type: 'table' as const,
    position: { x: 0, y: 0 },
    data: {
      columns: [
        { id: 'c1', width: 140 },
        { id: 'c2', width: 200 },
      ],
      rows: [
        { id: 'r1', height: 40 },
        { id: 'r2', height: 40 },
      ],
      cells: { 'r1:c1': 'Name', 'r2:c2': '42' },
      headerRow: true,
    },
  };

  it('parses through ResolvedFlowSchema', () => {
    const result = ResolvedFlowSchema.safeParse({
      version: 2,
      name: 'tbl',
      nodes: [tableNode],
      connectors: [],
    });
    if (!result.success) {
      throw new Error(`expected table to parse: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.data.nodes[0]?.type).toBe('table');
  });

  it('parses through the on-disk FlowSchema', () => {
    const onDisk = { id: 't1', type: 'table' as const, data: tableNode.data };
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'tbl',
      nodes: [onDisk],
      connectors: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a table with zero columns', () => {
    const result = FlowSchema.safeParse({
      version: 2,
      name: 'tbl',
      nodes: [{ id: 't1', type: 'table', data: { ...tableNode.data, columns: [] } }],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('routes table structure to flow.json and styling to style.json', () => {
    const resolved = {
      version: 2,
      name: 'tbl',
      nodes: [
        {
          ...tableNode,
          data: { ...tableNode.data, borderColor: 'blue', fontSize: 14 },
        },
      ],
      connectors: [],
    };
    const { flow, style } = splitFlow(resolved);
    const flowNode = (flow.nodes as Array<Record<string, unknown>>)[0];
    const flowData = flowNode?.data as Record<string, unknown>;
    // structure + sizing stay in flow.json (self-contained)
    expect(flowData.columns).toHaveLength(2);
    expect(flowData.rows).toHaveLength(2);
    expect(flowData.cells).toEqual({ 'r1:c1': 'Name', 'r2:c2': '42' });
    expect(flowData.headerRow).toBe(true);
    // generic styling routes to style.json
    const styleEntry = (style.nodes as Record<string, Record<string, unknown>>).t1;
    if (!styleEntry) throw new Error('expected a style entry for the table node');
    expect(styleEntry).toMatchObject({ borderColor: 'blue', fontSize: 14 });
    expect('columns' in styleEntry).toBe(false);

    // round-trips back through the on-disk schemas + merge
    const flowReparse = FlowSchema.safeParse(flow);
    const styleReparse = StyleSchema.safeParse(style);
    expect(flowReparse.success).toBe(true);
    expect(styleReparse.success).toBe(true);
    if (flowReparse.success && styleReparse.success) {
      const merged = mergeFlowAndStyle(flowReparse.data, styleReparse.data);
      const mergedTable = merged.nodes.find((n) => n.id === 't1');
      expect(mergedTable?.type).toBe('table');
      if (mergedTable?.type === 'table') {
        expect(mergedTable.data.columns).toHaveLength(2);
        expect(mergedTable.data.cells['r1:c1']).toBe('Name');
        expect(mergedTable.data.borderColor).toBe('blue');
      }
    }
  });
});

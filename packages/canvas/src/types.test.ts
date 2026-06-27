import { describe, expect, test } from 'bun:test';
import type {
  ComponentAction,
  ComponentNodeData,
  ComponentSpec,
  ComponentSpecElement,
  FlowNode,
  GroupNodeData,
  NodeType,
  ScriptAction,
  SetComponentAction,
} from './types.ts';

describe('US-010: component node types', () => {
  test('NodeType union includes "component"', () => {
    const t: NodeType = 'component';
    expect(t).toBe('component');
  });

  test('ComponentSpecElement carries type + optional props/children/watch', () => {
    const el: ComponentSpecElement = {
      type: 'Card',
      props: { padding: 4 },
      children: ['btn'],
      watch: { '/count': true },
    };
    expect(el.type).toBe('Card');
    expect(el.children).toEqual(['btn']);
  });

  test('ComponentAction discriminates on kind: "set" | "script"', () => {
    const setAct: SetComponentAction = { kind: 'set', path: '/count', value: 0 };
    const scriptAct: ScriptAction = {
      kind: 'script',
      interpreter: 'bun',
      scriptPath: 'actions/refresh.ts',
    };
    const a: ComponentAction = setAct;
    const b: ComponentAction = scriptAct;
    if (a.kind === 'set') expect(a.path).toBe('/count');
    if (b.kind === 'script') expect(b.scriptPath).toBe('actions/refresh.ts');
  });

  test('ComponentSpec ties root + elements together', () => {
    const spec: ComponentSpec = {
      root: 'root',
      elements: {
        root: { type: 'Card', children: ['m'] },
        m: { type: 'Metric', props: { value: { $state: '/count' } } },
      },
      state: { '/count': 0 },
      actions: { inc: { kind: 'set', path: '/count', value: 1 } },
    };
    expect(spec.elements.root?.type).toBe('Card');
  });

  test('FlowNode discriminated union extracts the component variant', () => {
    const node: FlowNode = {
      id: 'c1',
      type: 'component',
      position: { x: 0, y: 0 },
      data: {
        spec: {
          root: 'root',
          elements: { root: { type: 'Text', props: { text: 'hi' } } },
        },
      },
    };
    if (node.type !== 'component') throw new Error('unreachable');
    const data: ComponentNodeData = node.data;
    expect(data.spec.root).toBe('root');
  });

  test('exhaustive switch over FlowNode handles every variant including component', () => {
    // Compile-time exhaustiveness: the never-typed `_` arm fails to compile
    // if NodeType grows a tag without a matching case here. The component
    // arm is the US-010 addition.
    const describe = (n: FlowNode): string => {
      switch (n.type) {
        case 'rectangle':
        case 'ellipse':
        case 'sticky':
        case 'text':
        case 'database':
        case 'server':
        case 'user':
        case 'queue':
        case 'cloud':
        case 'diamond':
        case 'hexagon':
        case 'triangle':
        case 'parallelogram':
        case 'document':
          return 'geometric';
        case 'image':
          return 'image';
        case 'html':
          return 'html';
        case 'icon':
          return 'icon';
        case 'component':
          return 'component';
        case 'linkflow':
          return 'linkflow';
        case 'freehand':
          return 'freehand';
        case 'line':
          return 'line';
        case 'group':
          return 'group';
        default: {
          const _exhaustive: never = n;
          return _exhaustive;
        }
      }
    };

    const componentNode: FlowNode = {
      id: 'c1',
      type: 'component',
      position: { x: 0, y: 0 },
      data: { spec: { root: 'r', elements: { r: { type: 'Text' } } } },
    };
    expect(describe(componentNode)).toBe('component');

    const groupNode: FlowNode = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { childIds: ['c1'] },
    };
    expect(describe(groupNode)).toBe('group');
  });
});

describe('M1: group node types', () => {
  test('NodeType union includes "group"', () => {
    const t: NodeType = 'group';
    expect(t).toBe('group');
  });

  test('GroupNodeData carries childIds plus the shared semantic/visual base', () => {
    const data: GroupNodeData = {
      childIds: ['a', 'b'],
      name: 'My group',
      backgroundColor: 'slate',
      borderColor: 'blue',
    };
    expect(data.childIds).toEqual(['a', 'b']);
    expect(data.name).toBe('My group');
  });

  test('an empty group (childIds: []) is a valid labeled zone', () => {
    const data: GroupNodeData = { childIds: [] };
    expect(data.childIds).toHaveLength(0);
  });

  test('FlowNode discriminated union extracts the group variant', () => {
    const node: FlowNode = {
      id: 'g1',
      type: 'group',
      position: { x: 10, y: 20 },
      data: { childIds: ['n1', 'n2'], width: 300, height: 200 },
    };
    if (node.type !== 'group') throw new Error('unreachable');
    const data: GroupNodeData = node.data;
    expect(data.childIds).toEqual(['n1', 'n2']);
    expect(data.width).toBe(300);
  });
});

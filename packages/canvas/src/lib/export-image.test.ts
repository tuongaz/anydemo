import { describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

// happy-dom Element → viewportExportFilter uses `node instanceof Element`.
// Install BEFORE the helper is imported so the global resolves to the
// browser-like impl (Bun's runtime does not ship a global `Element`).
const window = new Window();
const doc = window.document;
(globalThis as { Element?: unknown }).Element = window.Element;

const { viewportExportFilter } = await import('./export-image.ts');

const makeEl = (tag: string, className?: string) => {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  return el;
};

describe('viewportExportFilter (US-009)', () => {
  it('excludes react-flow__minimap elements', () => {
    const node = makeEl('div', 'react-flow__minimap');
    expect(viewportExportFilter(node as unknown as Node)).toBe(false);
  });

  it('excludes react-flow__controls elements', () => {
    const node = makeEl('div', 'react-flow__controls');
    expect(viewportExportFilter(node as unknown as Node)).toBe(false);
  });

  it('excludes react-flow__panel elements (toolbar / style strip / share menu)', () => {
    const node = makeEl('div', 'react-flow__panel');
    expect(viewportExportFilter(node as unknown as Node)).toBe(false);
  });

  it('includes plain divs with no chrome classes', () => {
    const node = makeEl('div', 'some-other-class');
    expect(viewportExportFilter(node as unknown as Node)).toBe(true);
  });

  it('includes divs with no class attribute at all', () => {
    const node = makeEl('div');
    expect(viewportExportFilter(node as unknown as Node)).toBe(true);
  });

  it('includes non-Element nodes (text nodes, comments)', () => {
    const text = doc.createTextNode('hello');
    expect(viewportExportFilter(text as unknown as Node)).toBe(true);
  });

  it('keeps node types other than the three chrome surfaces (e.g. node wrappers)', () => {
    const nodeWrapper = makeEl('div', 'react-flow__node');
    const edgePath = makeEl('path', 'react-flow__edge-path');
    expect(viewportExportFilter(nodeWrapper as unknown as Node)).toBe(true);
    expect(viewportExportFilter(edgePath as unknown as Node)).toBe(true);
  });
});

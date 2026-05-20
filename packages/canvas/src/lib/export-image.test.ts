import { describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

// happy-dom Element → viewportExportFilter uses `node instanceof Element`.
// Install BEFORE the helper is imported so the global resolves to the
// browser-like impl (Bun's runtime does not ship a global `Element`).
const window = new Window();
const doc = window.document;
(globalThis as { Element?: unknown }).Element = window.Element;

// jsdom-style globals required by resolveCanvasBackground (getComputedStyle).
(globalThis as { getComputedStyle?: unknown }).getComputedStyle =
  window.getComputedStyle.bind(window);
// happy-dom 20.9 references `window.SyntaxError` from its selector parser; Bun's
// `Window` impl doesn't define it, so any getComputedStyle / closest call throws
// `undefined is not a constructor` without this patch.
(window as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;

const { resolveCanvasBackground, viewportExportFilter } = await import('./export-image.ts');

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

describe('resolveCanvasBackground', () => {
  it('returns the --bg-canvas token from the nearest .seeflow-canvas-root', () => {
    const root = makeEl('div', 'seeflow-canvas-root');
    root.setAttribute('style', '--bg-canvas: #123456');
    const viewport = makeEl('div', 'react-flow__viewport');
    root.appendChild(viewport);
    doc.body.appendChild(root);
    try {
      expect(resolveCanvasBackground(viewport as unknown as Element)).toBe('#123456');
    } finally {
      doc.body.removeChild(root);
    }
  });

  it('falls back to #0a0a0c when no .seeflow-canvas-root ancestor exists', () => {
    const orphan = makeEl('div', 'react-flow__viewport');
    doc.body.appendChild(orphan);
    try {
      expect(resolveCanvasBackground(orphan as unknown as Element)).toBe('#0a0a0c');
    } finally {
      doc.body.removeChild(orphan);
    }
  });

  it('falls back to #0a0a0c when the ancestor exists but the token is empty', () => {
    const root = makeEl('div', 'seeflow-canvas-root');
    const viewport = makeEl('div', 'react-flow__viewport');
    root.appendChild(viewport);
    doc.body.appendChild(root);
    try {
      expect(resolveCanvasBackground(viewport as unknown as Element)).toBe('#0a0a0c');
    } finally {
      doc.body.removeChild(root);
    }
  });
});

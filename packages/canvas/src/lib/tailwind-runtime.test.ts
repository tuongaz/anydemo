import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

/** Minimal mutable Element stand-in: enough to participate in querySelector,
 *  setAttribute, and the head's children list. */
interface MockElement {
  tagName: string;
  attrs: Map<string, string>;
  children: MockElement[];
  src?: string;
  async?: boolean;
  setAttribute(name: string, value: string): void;
}

const makeElement = (tagName: string): MockElement => {
  const attrs = new Map<string, string>();
  return {
    tagName: tagName.toUpperCase(),
    attrs,
    children: [],
    setAttribute(name, value) {
      attrs.set(name, value);
    },
  };
};

/** Install a tiny `document` global supporting just the surface area
 *  `ensureTailwindLoaded` touches: `head.appendChild`, `createElement`, and
 *  `querySelector('script[<attr>]')`. Returns the head so tests can inspect
 *  its children directly. */
const installMockDocument = (): MockElement => {
  const head = makeElement('head');
  const doc = {
    head,
    createElement: (tagName: string): MockElement => makeElement(tagName),
    querySelector: (selector: string): MockElement | null => {
      const match = selector.match(/^script\[([\w-]+)\]$/);
      if (!match) throw new Error(`mock querySelector only supports script[attr]: ${selector}`);
      const attr = match[1] ?? '';
      for (const child of head.children) {
        if (child.tagName === 'SCRIPT' && child.attrs.has(attr)) return child;
      }
      return null;
    },
  };
  Object.assign(head, {
    appendChild(node: MockElement) {
      head.children.push(node);
      return node;
    },
  });
  (globalThis as unknown as { document: typeof doc }).document = doc;
  return head;
};

const clearDocument = () => {
  // Setting to undefined is enough for the SSR branch — `typeof undefined`
  // is 'undefined', which is what `ensureTailwindLoaded`'s guard checks.
  (globalThis as { document?: unknown }).document = undefined;
};

const { ensureTailwindLoaded, TAILWIND_RUNTIME_MARKER, TAILWIND_RUNTIME_SRC } = await import(
  './tailwind-runtime.ts'
);

describe('ensureTailwindLoaded (US-012)', () => {
  let head: MockElement;

  beforeEach(() => {
    head = installMockDocument();
  });

  afterEach(clearDocument);

  it('injects a single <script src="/runtime/tailwind.js?v=..."> on first call', () => {
    ensureTailwindLoaded();
    expect(head.children).toHaveLength(1);
    const script = head.children[0];
    if (!script) throw new Error('expected an injected script');
    expect(script.tagName).toBe('SCRIPT');
    expect(script.src).toBe(TAILWIND_RUNTIME_SRC);
    expect(script.async).toBe(true);
    expect(script.attrs.get(TAILWIND_RUNTIME_MARKER)).toBe('true');
  });

  it('is idempotent across repeated calls', () => {
    ensureTailwindLoaded();
    ensureTailwindLoaded();
    ensureTailwindLoaded();
    expect(head.children).toHaveLength(1);
  });

  it('points at the vendored Hono runtime path with a cache-busting version', () => {
    expect(TAILWIND_RUNTIME_SRC.startsWith('/runtime/tailwind.js?v=')).toBe(true);
    expect(TAILWIND_RUNTIME_SRC).not.toContain('cdn.tailwindcss.com');
    expect(TAILWIND_RUNTIME_SRC).not.toContain('cdn.jsdelivr.net');
  });
});

describe('ensureTailwindLoaded — SSR safety', () => {
  beforeEach(clearDocument);

  it('returns silently when document is undefined', () => {
    expect(() => ensureTailwindLoaded()).not.toThrow();
  });
});

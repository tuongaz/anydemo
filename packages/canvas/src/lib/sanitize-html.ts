/** Tags whose entire subtree is dropped by the sanitizer. */
const DANGEROUS_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK']);

/** URL-bearing attributes inspected for `javascript:` schemes. */
const URL_ATTRS = new Set(['href', 'src']);

/** True for `on*=` event-handler attributes (case-insensitive). */
const isEventHandlerAttr = (name: string): boolean => /^on/i.test(name);

/** True when a URL value resolves to the `javascript:` pseudo-scheme. Strips
 *  leading whitespace + ASCII control chars (U+0000..U+0020), mirroring how a
 *  URL parser would normalize before scheme detection. Implemented with
 *  charCodeAt + slice (rather than a regex with raw control bytes) so the
 *  source file stays plain ASCII for biome/lint. */
const isJavaScriptUrl = (value: string): boolean => {
  let i = 0;
  while (i < value.length && value.charCodeAt(i) <= 0x20) {
    i += 1;
  }
  return value.slice(i, i + 11).toLowerCase() === 'javascript:';
};

/** Sanitize untrusted HTML so the trust boundary is grep-able in one place.
 *  Strips dangerous elements (script / style / iframe / object / embed / link)
 *  and their entire subtree, removes every `on*=` event-handler attribute, and
 *  drops `href`/`src` values that resolve to the `javascript:` pseudo-scheme.
 *
 *  Pure function: same input produces the same output and no global state is
 *  mutated. Uses the browser's `DOMParser` plus a `TreeWalker` — no third-party
 *  dependency. SSR-safe: returns `''` when `DOMParser` is unavailable so the
 *  caller can never accidentally inject the raw input. */
export function sanitizeHtml(raw: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${raw}</body></html>`,
    'text/html',
  );
  const body = doc.body;

  // SHOW_ELEMENT === 1 — referenced as a numeric literal so the implementation
  // does not depend on the runtime exposing the `NodeFilter` global, only on
  // `Document.createTreeWalker` accepting the bitmask.
  const walker = doc.createTreeWalker(body, 1);
  const toRemove: Element[] = [];

  let node: Node | null = walker.nextNode();
  while (node) {
    const el = node as Element;
    if (DANGEROUS_TAGS.has(el.tagName)) {
      toRemove.push(el);
    } else {
      for (const attr of Array.from(el.attributes)) {
        if (isEventHandlerAttr(attr.name)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (URL_ATTRS.has(attr.name.toLowerCase()) && isJavaScriptUrl(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
    node = walker.nextNode();
  }

  for (const el of toRemove) {
    el.remove();
  }

  return body.innerHTML;
}

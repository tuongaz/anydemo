import { sanitizeHtml } from './sanitize-html.ts';

/**
 * US-014: trust boundary for the type:'html' renderer. This helper is the ONE
 * place in the codebase that builds React's inner-HTML prop from author HTML.
 * Author HTML is first passed through `sanitizeHtml` (US-013), which strips
 * dangerous tags (script / style / iframe / object / embed / link), every
 * `on*=` event-handler attribute, and `javascript:` URLs.
 *
 * The return shape is a spreadable React props object — call sites use
 * `<div {...injectSanitizedHtml(raw)} />` so the inner-HTML JSX attribute
 * never appears in user-facing renderers, keeping the trust boundary
 * grep-able to this file.
 */
export function injectSanitizedHtml(raw: string): { dangerouslySetInnerHTML: { __html: string } } {
  return { dangerouslySetInnerHTML: { __html: sanitizeHtml(raw) } };
}

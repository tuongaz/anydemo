/** Path to the vendored Tailwind Play CDN runtime, served by the Hono studio
 *  at `/runtime/tailwind.js`. The studio serves the same file in dev and
 *  prod modes so htmlNode renderers can inject it without depending on the
 *  web bundle build. */
export const TAILWIND_RUNTIME_SRC = '/runtime/tailwind.js';

/** Marker attribute placed on the injected <script> tag so subsequent calls
 *  can short-circuit. Distinct from the `src` URL check so the marker stays
 *  recognizable even if the URL is hashed/rewritten in the future. */
export const TAILWIND_RUNTIME_MARKER = 'data-seeflow-tailwind-runtime';

/** Inject the Tailwind Play CDN runtime into <head> exactly once per page.
 *  Idempotent — subsequent calls are no-ops, so it's safe to invoke from a
 *  React mount effect on every htmlNode that needs Tailwind. SSR-safe:
 *  returns early when `document` is undefined. */
export function ensureTailwindLoaded(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`script[${TAILWIND_RUNTIME_MARKER}]`)) return;
  const script = document.createElement('script');
  script.src = TAILWIND_RUNTIME_SRC;
  script.async = true;
  script.setAttribute(TAILWIND_RUNTIME_MARKER, 'true');
  document.head.appendChild(script);
}

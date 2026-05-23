/** Version tag appended to the runtime URL as a query string. Bump this
 *  alongside `bun run vendor:tailwind-runtime` whenever the vendored bundle
 *  changes — browsers cache the prod response as `immutable`, so a stable
 *  URL silently serves the old bundle forever after a swap. The string
 *  itself is opaque; the studio ignores the query when resolving the file. */
export const TAILWIND_RUNTIME_VERSION = 'v4.3.0';

/** Path to the vendored `@tailwindcss/browser@4` runtime, served by the Hono
 *  studio at `/runtime/tailwind.js`. The studio ships the same file in dev
 *  and prod modes so type:'html' renderers can inject it without depending on
 *  the web bundle build. Refresh via `bun run vendor:tailwind-runtime` after
 *  bumping the @tailwindcss/browser dep, then bump TAILWIND_RUNTIME_VERSION
 *  so caches invalidate. */
export const TAILWIND_RUNTIME_SRC = `/runtime/tailwind.js?v=${TAILWIND_RUNTIME_VERSION}`;

/** Marker attribute placed on the injected <script> tag so subsequent calls
 *  can short-circuit. Distinct from the `src` URL check so the marker stays
 *  recognizable even if the URL is hashed/rewritten in the future. */
export const TAILWIND_RUNTIME_MARKER = 'data-seeflow-tailwind-runtime';

/** Inject the Tailwind v4 browser runtime into <head> exactly once per page.
 *  Idempotent — subsequent calls are no-ops, so it's safe to invoke from a
 *  React mount effect on every type:'html' node that needs Tailwind. SSR-safe:
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

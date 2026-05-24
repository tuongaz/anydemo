/**
 * Pure helpers for the Embed dialog (US-010). Decoupled from the DOM so they
 * can be unit-tested without rendering — the dialog component (US-012) calls
 * `buildEmbedSnippet(buildEmbedUrl(projectId, theme?))` to populate its
 * textarea. The optional `theme` query param was added in US-009 so embedders
 * can pin the iframe to light or dark independently of the host's preference.
 */

/** Public host for embed snippets. Hardcoded per the design doc. */
export const EMBED_HOST = 'https://seeflow.dev/embed';

/**
 * The two concrete palettes the embed URL can carry. The Embed dialog also
 * exposes a `'match'` option, but that resolves to one of these two values
 * before the URL is built.
 */
export type ResolvedEmbedTheme = 'light' | 'dark';

/**
 * Build the canonical embed URL for a given project id. When `theme` is
 * provided, appends `?theme=<value>` so the viewer (US-010) can apply the
 * right palette before paint.
 */
export const buildEmbedUrl = (projectId: string, theme?: ResolvedEmbedTheme): string => {
  const base = `${EMBED_HOST}/${encodeURIComponent(projectId)}`;
  return theme ? `${base}?theme=${theme}` : base;
};

/**
 * Structural shapes we read off the document. Kept tiny so the helper can be
 * unit-tested with a plain `{ documentElement: { classList: { contains } } }`
 * stub — no jsdom / happy-dom dependency required.
 */
interface ClassListLike {
  contains(token: string): boolean;
}
interface DocumentElementLike {
  classList: ClassListLike;
}
interface DocumentLike {
  documentElement: DocumentElementLike;
}

/**
 * Resolve the active theme by inspecting `<html>` for the `.dark` class. The
 * studio's FOUC script (US-005) and `useTheme` hook both write this class, so
 * any host that follows the standard light/dark wiring sees the correct value.
 * Hosts that scope `.dark` somewhere other than the document element should
 * opt out of "Match my theme" and pick Light/Dark explicitly in the dialog.
 * Returns `'light'` when no document is available (SSR or test environments
 * without DOM globals) — that matches the new package default.
 */
export const getResolvedThemeFromDocument = (doc?: DocumentLike | null): ResolvedEmbedTheme =>
  doc?.documentElement?.classList?.contains('dark') ? 'dark' : 'light';

/**
 * HTML-attribute-escape a value so it can be safely interpolated inside a
 * double-quoted attribute. Covers `&`, `"`, `<` (the trio the PRD calls out);
 * we do `&` first so the subsequent replacements don't double-encode.
 */
const escapeHtmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Build the multi-line `<iframe>` snippet shown in the Embed dialog. The URL
 * is HTML-attribute-escaped before interpolation so an embed URL containing
 * `&` (e.g. query strings) doesn't break the attribute syntax.
 */
export const buildEmbedSnippet = (url: string): string => {
  const safeUrl = escapeHtmlAttribute(url);
  return [
    `<iframe src="${safeUrl}"`,
    `  width="100%"`,
    `  height="600"`,
    `  style="border:0"`,
    `  allow="fullscreen"`,
    `  loading="lazy"></iframe>`,
  ].join('\n');
};

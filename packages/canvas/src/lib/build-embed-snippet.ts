/**
 * Pure helpers for the Embed dialog (US-010). Decoupled from the DOM so they
 * can be unit-tested without rendering — the dialog component (US-012) calls
 * `buildEmbedSnippet(buildEmbedUrl(projectId))` to populate its textarea.
 */

/** Public host for embed snippets. Hardcoded per the design doc. */
export const EMBED_HOST = 'https://seeflow.dev/embed';

/** Build the canonical embed URL for a given project id. */
export const buildEmbedUrl = (projectId: string): string =>
  `${EMBED_HOST}/${encodeURIComponent(projectId)}`;

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

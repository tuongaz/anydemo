import type { FontFamilyToken } from '../types.ts';

/**
 * Curated cross-platform font stacks, keyed by FontFamilyToken. Each stack
 * leans on fonts already present on the OS (the point of "system fonts");
 * only Inter + JetBrains Mono are web-loaded by the canvas, the rest resolve
 * locally so a shared / exported flow renders consistently without pulling new
 * web-font downloads. Tune the stacks here without touching saved flows — only
 * the token is persisted.
 */
export const FONT_STACKS: Record<FontFamilyToken, string> = {
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  rounded: '"SF Pro Rounded", "Varela Round", "Nunito", system-ui, sans-serif',
  handwritten: '"Comic Sans MS", "Comic Sans", "Bradley Hand", "Segoe Print", cursive',
};

export interface FontFamilyOption {
  token: FontFamilyToken;
  label: string;
}

/**
 * Picker options in display order. `sans` is the default (first). Labels stay
 * short; the picker renders each row in its own stack as a live preview.
 */
export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  { token: 'sans', label: 'Sans' },
  { token: 'system', label: 'System UI' },
  { token: 'serif', label: 'Serif' },
  { token: 'mono', label: 'Mono' },
  { token: 'rounded', label: 'Rounded' },
  { token: 'handwritten', label: 'Handwritten' },
];

/**
 * Resolve a font token to a concrete CSS font-family stack. Returns `undefined`
 * for an unset token so callers omit the CSS property entirely and inherit the
 * canvas default font (today's Inter).
 */
export function resolveFontStack(token: FontFamilyToken | undefined): string | undefined {
  if (token === undefined) return undefined;
  return FONT_STACKS[token];
}

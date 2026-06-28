// Shared type for the generated emoji catalog (see `emoji-catalog.ts`, produced
// by `scripts/gen-emoji-catalog.ts`). Kept in its own module so consumers can
// `import type { EmojiCatalogEntry }` without statically pulling in the catalog
// data — the picker lazy-loads the data via dynamic `import()`.
export interface EmojiCatalogEntry {
  /**
   * iconify name segment (the part after `iconify:`), e.g. `twemoji:grinning-face`.
   * Combined with the `iconify` vendor it round-trips through `formatIconId` to
   * the stored id `iconify:twemoji:grinning-face`.
   */
  id: string;
  /** Human-readable name, e.g. `grinning face` — used for tile title/aria. */
  label: string;
  /**
   * Lowercased space-joined search haystack (label + CLDR tags + emoticon).
   * The picker matches a query via `keywords.includes(query)`.
   */
  keywords: string;
}

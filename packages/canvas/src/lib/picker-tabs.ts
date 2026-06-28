// Picker-tab model. The Insert-Icon picker's tabs are MOSTLY 1:1 with the
// `IconVendor` union, but the Emoji tab is a picker-only concept: its tiles are
// Twemoji icons that store the ordinary `iconify:twemoji:<slug>` id (same
// `iconify` vendor as the Logos tab). So "tab" is a superset of "vendor".
import type { EmojiCatalogEntry } from './emoji-catalog-types.ts';
import type { IconVendor } from './icon-id.ts';

export type PickerTab = IconVendor | 'emoji';

export const EMOJI_TAB = 'emoji' as const;

/** The vendor used to build/render ids for a tab. Emoji tiles render as iconify. */
export function tabRenderVendor(tab: PickerTab): IconVendor {
  return tab === EMOJI_TAB ? 'iconify' : tab;
}

export function isEmojiTab(tab: PickerTab): tab is typeof EMOJI_TAB {
  return tab === EMOJI_TAB;
}

/**
 * Names (iconify name-segments, e.g. `twemoji:grinning-face`) to render in the
 * Emoji tab, filtered by `query`. Emoji "names" are slugs, so a query is matched
 * against each entry's precomputed `keywords` haystack rather than the slug —
 * "happy" finds `twemoji:grinning-face`. Returns `[]` until the catalog loads.
 */
export function filterEmoji(
  catalog: readonly EmojiCatalogEntry[] | null,
  query: string,
): string[] {
  if (!catalog) return [];
  const q = query.trim().toLowerCase();
  if (q === '') return catalog.map((e) => e.id);
  return catalog.filter((e) => e.keywords.includes(q)).map((e) => e.id);
}

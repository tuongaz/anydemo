import type { LucideIcon } from 'lucide-react';
import * as Lucide from 'lucide-react';
import type { PackSummary } from '../adapter/types.ts';
import type { IconVendor } from './icon-id.ts';

const NON_ICON_EXPORTS = new Set(['createLucideIcon', 'Icon', 'icons', 'default']);

const FORWARD_REF_SYMBOL = Symbol.for('react.forward_ref');

function isLucideIconComponent(value: unknown): value is LucideIcon {
  if (typeof value === 'function') return true;
  if (value !== null && typeof value === 'object') {
    const tag = (value as { $$typeof?: symbol }).$$typeof;
    return tag === FORWARD_REF_SYMBOL;
  }
  return false;
}

function pascalToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (char, index: number) =>
    index === 0 ? char.toLowerCase() : `-${char.toLowerCase()}`,
  );
}

function buildRegistry(): Record<string, LucideIcon> {
  const registry: Record<string, LucideIcon> = {};
  for (const [name, value] of Object.entries(Lucide)) {
    if (NON_ICON_EXPORTS.has(name)) continue;
    if (!isLucideIconComponent(value)) continue;
    registry[pascalToKebab(name)] = value;
  }
  return registry;
}

export const ICON_REGISTRY: Record<string, LucideIcon> = buildRegistry();
export const ICON_FALLBACK_NAME = 'help-circle';
export const ICON_NAMES: string[] = Object.keys(ICON_REGISTRY).sort();

/**
 * Curated iconify glyphs seeded into the picker's `iconify` tab. The list
 * stays short on purpose — iconify ships thousands of glyphs across hundreds
 * of sets, so the picker exposes only the brand-logo entries that the cloud
 * vendor tabs lean on (matches the "Logos" tab label in US-016). Future
 * stories can expand or make this user-configurable.
 */
const SEEDED_ICONIFY_NAMES: ReadonlyArray<string> = [
  'logos:aws',
  'logos:google-cloud',
  'logos:microsoft-azure',
];

/**
 * Per-vendor icon-name catalog. `lucide` is auto-built from the bundled
 * lucide-react module; `aws`/`gcp`/`azure` start empty and are populated by
 * {@link applyPackSummaries} when the host's adapter reports installed packs;
 * `iconify` ships a curated short list (see {@link SEEDED_ICONIFY_NAMES}).
 *
 * The exported record is mutated in place by `applyPackSummaries` so the
 * picker (US-016) and any future consumer can read the latest view without
 * extra context/subscription plumbing. Mutability is contained to that one
 * helper; outside callers should treat the inner arrays as read-only.
 */
export const ICON_NAMES_BY_VENDOR: Record<IconVendor, string[]> = {
  lucide: ICON_NAMES,
  aws: [],
  gcp: [],
  azure: [],
  iconify: [...SEEDED_ICONIFY_NAMES],
};

/**
 * Replace the per-vendor pack catalog from the latest pack summaries reported
 * by `adapter.icons.listPacks()`. Uninstalled entries clear the vendor's
 * array; installed entries overwrite it with the pack's `iconNames`. Leaves
 * `lucide` and `iconify` untouched — those are bundled / curated, not
 * pack-managed. Silent no-op when `packs` is empty.
 */
export function applyPackSummaries(packs: ReadonlyArray<PackSummary>): void {
  for (const pack of packs) {
    if (pack.installed) {
      ICON_NAMES_BY_VENDOR[pack.vendor] = [...pack.iconNames];
    } else {
      ICON_NAMES_BY_VENDOR[pack.vendor] = [];
    }
  }
}

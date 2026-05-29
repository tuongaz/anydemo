// Vendor-prefixed icon identifier encoding.
//
// Wire format: `vendor:name` (e.g. `aws:lambda`, `azure:functions`).
// Unprefixed strings are treated as Lucide icons (e.g. `cloud-upload`).
// The `iconify` vendor carries a nested `set:name` payload (e.g.
// `iconify:logos:google-cloud`), so its name segment may contain colons.

export type IconVendor = 'lucide' | 'aws' | 'gcp' | 'azure' | 'iconify';

export interface IconId {
  vendor: IconVendor;
  name: string;
}

const PREFIXED_VENDORS: ReadonlyArray<Exclude<IconVendor, 'lucide'>> = [
  'aws',
  'gcp',
  'azure',
  'iconify',
];

export function parseIconId(raw: string): IconId | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const colon = trimmed.indexOf(':');
  if (colon === -1) {
    return { vendor: 'lucide', name: trimmed };
  }

  const prefix = trimmed.slice(0, colon);
  const rest = trimmed.slice(colon + 1);
  if (rest.length === 0) return null;

  if (prefix === 'lucide') {
    return { vendor: 'lucide', name: rest };
  }
  if ((PREFIXED_VENDORS as readonly string[]).includes(prefix)) {
    return { vendor: prefix as Exclude<IconVendor, 'lucide'>, name: rest };
  }
  return null;
}

export function formatIconId(id: IconId): string {
  if (id.vendor === 'lucide') return id.name;
  return `${id.vendor}:${id.name}`;
}

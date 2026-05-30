// Vendor-aware icon resolver.
//
// Dispatches a `vendor:name` string (or unprefixed Lucide name) to one of
// three render strategies — the bundled Lucide component, a studio-served
// SVG URL, or an iconify identifier handled inline by `@iconify/react`.
// `<IconRenderer>` is the only consumer; the picker uses it indirectly.

import type { LucideIcon } from 'lucide-react';
import { parseIconId } from './icon-id.ts';
import { ICON_REGISTRY } from './icon-registry.ts';

export type Resolved =
  | { kind: 'lucide'; component: LucideIcon }
  | { kind: 'svg-url'; url: string }
  | { kind: 'iconify'; identifier: string };

export interface ResolveOptions {
  studioBaseUrl: string;
}

export function resolveIcon(raw: string, opts: ResolveOptions): Resolved | null {
  const id = parseIconId(raw);
  if (!id) return null;
  if (id.vendor === 'lucide') {
    const c = ICON_REGISTRY[id.name];
    return c ? { kind: 'lucide', component: c } : null;
  }
  if (id.vendor === 'iconify') {
    return { kind: 'iconify', identifier: id.name };
  }
  return {
    kind: 'svg-url',
    url: `${opts.studioBaseUrl}/api/icons/${id.vendor}/${id.name}.svg`,
  };
}

import { HelpCircle } from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';
import { resolveIcon } from '../lib/icon-resolve.ts';

// Optional peer dep — dynamically imported so consumers without
// `@iconify/react` installed still get a usable canvas (we render the
// placeholder for iconify-prefixed names instead of crashing). Mirrors the
// mermaid-block lazy-load pattern.
interface IconifyComponent {
  Icon: ComponentType<{
    icon: string;
    className?: string;
    color?: string;
    width?: number | string;
    height?: number | string;
    style?: Record<string, unknown>;
    // The `@iconify/react` typings use plain boolean here, matching <img>.
    'aria-label'?: string;
    'aria-hidden'?: boolean;
  }>;
}

let iconifyPromise: Promise<IconifyComponent | null> | null = null;

function loadIconify(): Promise<IconifyComponent | null> {
  if (iconifyPromise) return iconifyPromise;
  iconifyPromise = import('@iconify/react').then(
    (m) => m as unknown as IconifyComponent,
    () => null,
  );
  return iconifyPromise;
}

export interface IconRendererProps {
  iconId: string;
  studioBaseUrl: string;
  className?: string;
  ariaLabel?: string;
  // Lucide / iconify passthroughs — ignored for svg-url.
  color?: string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
}

function renderPlaceholder(className: string | undefined, ariaLabel: string | undefined) {
  return (
    <HelpCircle
      className={className}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel === undefined ? true : undefined}
      data-testid="icon-renderer-placeholder"
    />
  );
}

function IconifyOrPlaceholder({
  identifier,
  className,
  ariaLabel,
  color,
}: {
  identifier: string;
  className?: string;
  ariaLabel?: string;
  color?: string;
}) {
  const [mod, setMod] = useState<IconifyComponent | null>(null);
  useEffect(() => {
    let active = true;
    loadIconify().then((m) => {
      if (active) setMod(m);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!mod) return renderPlaceholder(className, ariaLabel);
  const I = mod.Icon;
  return (
    <I
      icon={identifier}
      className={className}
      color={color}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel === undefined ? true : undefined}
    />
  );
}

// Single component that renders any vendor-prefixed icon-id through the
// resolver. `kind:'lucide'` paints the bundled component, `kind:'svg-url'`
// inlines the studio-served SVG via `<img>` (browser-cached, no shadow DOM),
// `kind:'iconify'` delegates to `@iconify/react` when available. Anything
// unresolvable — empty input, unknown Lucide name, malformed prefix — falls
// through to a stable HelpCircle placeholder with a `data-testid` so the
// missing-icon case is observable in tests + dev tools.
export function IconRenderer({
  iconId,
  studioBaseUrl,
  className,
  ariaLabel,
  color,
  strokeWidth,
  absoluteStrokeWidth,
}: IconRendererProps) {
  const resolved = resolveIcon(iconId, { studioBaseUrl });
  if (!resolved) return renderPlaceholder(className, ariaLabel);
  if (resolved.kind === 'lucide') {
    const C = resolved.component;
    return (
      <C
        className={className}
        color={color}
        strokeWidth={strokeWidth}
        absoluteStrokeWidth={absoluteStrokeWidth}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel === undefined ? true : undefined}
      />
    );
  }
  if (resolved.kind === 'svg-url') {
    return (
      <img
        src={resolved.url}
        loading="lazy"
        draggable={false}
        className={className}
        alt={ariaLabel ?? ''}
        aria-hidden={ariaLabel === undefined ? true : undefined}
      />
    );
  }
  return (
    <IconifyOrPlaceholder
      identifier={resolved.identifier}
      className={className}
      ariaLabel={ariaLabel}
      color={color}
    />
  );
}

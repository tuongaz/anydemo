import { Check, Download, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { IconPackVendor, PackSummary } from '../adapter/types.ts';
import { cn } from '../lib/cn.ts';

// US-017: Browse Packs panel shown inside the IconPickerPopover when the
// author clicks "Browse packs". Stateless — owner passes the latest pack
// summaries and handles install / remove via callbacks. The picker is
// responsible for opening the InstallPackModal + rendering the progress
// toast; this panel only emits the user intent.

const VENDOR_LABELS: Record<IconPackVendor, string> = {
  aws: 'AWS',
  azure: 'Microsoft Azure',
};

const VENDOR_ORDER: ReadonlyArray<IconPackVendor> = ['aws', 'azure'];

export interface BrowsePacksPanelProps {
  /** All known packs. Missing vendors are treated as uninstalled. */
  packs: ReadonlyArray<PackSummary>;
  /** Fired when the author clicks the Install button for a vendor. */
  onInstall: (vendor: IconPackVendor) => void;
  /** Fired when the author clicks the Remove button for an installed pack. */
  onRemove: (vendor: IconPackVendor) => void;
  /**
   * Disable both action buttons for the given vendor — used by the picker
   * while an install or removal is already in flight for that vendor.
   */
  busyVendor?: IconPackVendor | null;
}

export function BrowsePacksPanel({
  packs,
  onInstall,
  onRemove,
  busyVendor,
}: BrowsePacksPanelProps): ReactNode {
  // Normalize: build a per-vendor lookup so a missing entry → uninstalled.
  const byVendor = new Map<IconPackVendor, PackSummary>();
  for (const p of packs) byVendor.set(p.vendor, p);

  return (
    <div className="sf:flex sf:w-full sf:flex-col sf:gap-2 sf:p-3" data-testid="browse-packs-panel">
      <div className="sf:flex sf:flex-col sf:gap-1">
        <div className="sf:text-sm sf:font-semibold sf:text-foreground">Icon packs</div>
        <div className="sf:text-xs sf:text-muted-foreground">
          Install cloud-vendor icon packs to use them in flows. Packs are cached locally.
        </div>
      </div>
      <ul className="sf:flex sf:flex-col sf:gap-1">
        {VENDOR_ORDER.map((vendor) => {
          const entry = byVendor.get(vendor) ?? { vendor, installed: false as const };
          return renderRow({
            entry,
            busy: busyVendor === vendor,
            onInstall,
            onRemove,
          });
        })}
      </ul>
    </div>
  );
}

interface RowArgs {
  entry: PackSummary;
  busy: boolean;
  onInstall: (vendor: IconPackVendor) => void;
  onRemove: (vendor: IconPackVendor) => void;
}

function renderRow({ entry, busy, onInstall, onRemove }: RowArgs): ReactNode {
  const { vendor } = entry;
  const label = VENDOR_LABELS[vendor];
  return (
    <li
      key={`browse-packs-row-${vendor}`}
      data-testid={`browse-packs-row-${vendor}`}
      data-installed={entry.installed ? 'true' : 'false'}
      className="sf:flex sf:items-center sf:justify-between sf:gap-2 sf:rounded-md sf:border sf:border-border sf:bg-background sf:px-3 sf:py-2"
    >
      <div className="sf:flex sf:min-w-0 sf:flex-col">
        <div className="sf:text-sm sf:font-medium sf:text-foreground">{label}</div>
        <div className="sf:text-[11px] sf:text-muted-foreground">
          {entry.installed
            ? `Installed · ${entry.iconCount} icons · v${entry.version}`
            : 'Not installed'}
        </div>
      </div>
      {entry.installed ? (
        <div className="sf:flex sf:items-center sf:gap-1">
          <span
            data-testid={`browse-packs-installed-${vendor}`}
            className="sf:inline-flex sf:items-center sf:gap-1 sf:rounded-md sf:bg-emerald-500/10 sf:px-2 sf:py-1 sf:text-[11px] sf:font-medium sf:text-emerald-700"
          >
            <Check className="sf:h-3 sf:w-3" aria-hidden="true" />
            Installed
          </span>
          <button
            type="button"
            data-testid={`browse-packs-remove-${vendor}`}
            disabled={busy}
            onClick={() => onRemove(vendor)}
            aria-label={`Remove ${label} pack`}
            className={cn(
              'sf:inline-flex sf:h-8 sf:items-center sf:gap-1 sf:rounded-md sf:px-2 sf:text-xs sf:font-medium sf:text-muted-foreground sf:transition-colors',
              'sf:hover:bg-destructive/10 sf:hover:text-destructive',
              'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
              'sf:disabled:cursor-not-allowed sf:disabled:opacity-50',
            )}
          >
            <Trash2 className="sf:h-3 sf:w-3" aria-hidden="true" />
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid={`browse-packs-install-${vendor}`}
          disabled={busy}
          onClick={() => onInstall(vendor)}
          aria-label={`Install ${label} pack`}
          className={cn(
            'sf:inline-flex sf:h-8 sf:items-center sf:gap-1 sf:rounded-md sf:bg-primary sf:px-3 sf:text-xs sf:font-medium sf:text-primary-foreground sf:transition-colors',
            'sf:hover:bg-primary/90',
            'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
            'sf:disabled:cursor-not-allowed sf:disabled:opacity-50',
          )}
        >
          <Download className="sf:h-3 sf:w-3" aria-hidden="true" />
          Install
        </button>
      )}
    </li>
  );
}

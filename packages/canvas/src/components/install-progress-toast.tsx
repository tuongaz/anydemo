import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { IconPackVendor, InstallEvent } from '../adapter/types.ts';
import { cn } from '../lib/cn.ts';

// US-017: Live progress toast for the icon pack installer. Stateless — the
// picker subscribes to the install job via `adapter.icons.subscribeJob` and
// feeds the most recent event in. The toast renders a single line summary
// per event type:
//   download-progress → "Downloading <vendor>… NN.N MB"
//   extracting        → "Extracting…"
//   indexing          → "Indexing N icons…"
//   done              → "Installed N icons"
//   error             → "Install failed: <message>" + Retry button
//   terms-required    → "License acceptance required"
//
// The `vendor` prop is used for the toast label so the user always knows
// which install is in flight even between events (e.g. while `extracting`
// doesn't carry the vendor in its label).

const VENDOR_LABELS: Record<IconPackVendor, string> = {
  aws: 'AWS',
  azure: 'Microsoft Azure',
};

export interface InstallProgressToastProps {
  vendor: IconPackVendor;
  /**
   * Latest event from `adapter.icons.subscribeJob`. `null` means the install
   * has just been kicked off and no event has landed yet — renders an
   * initial "Starting…" line.
   */
  event: InstallEvent | null;
  /**
   * Fired when the user clicks Retry on the error state. The picker re-runs
   * the install flow.
   */
  onRetry?: () => void;
  /** Fired when the user dismisses the toast. */
  onClose?: () => void;
}

function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

interface ToastBody {
  label: string;
  icon: ReactNode;
  variant: 'progress' | 'done' | 'error';
}

function bodyForEvent(vendor: IconPackVendor, event: InstallEvent | null): ToastBody {
  const label = VENDOR_LABELS[vendor];
  if (event === null) {
    return {
      label: `Starting install for ${label}…`,
      icon: <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />,
      variant: 'progress',
    };
  }
  switch (event.type) {
    case 'terms-required':
      return {
        label: `${label}: license acceptance required`,
        icon: <AlertTriangle className="sf:h-4 sf:w-4" aria-hidden="true" />,
        variant: 'error',
      };
    case 'download-started':
      return {
        label: `Downloading ${label}…`,
        icon: <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />,
        variant: 'progress',
      };
    case 'download-progress':
      return {
        label: `Downloading ${label}… ${formatMb(event.receivedBytes)}`,
        icon: <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />,
        variant: 'progress',
      };
    case 'extracting':
      return {
        label: `Extracting ${label}…`,
        icon: <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />,
        variant: 'progress',
      };
    case 'indexing':
      return {
        label: `Indexing ${event.iconCount} icons…`,
        icon: <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />,
        variant: 'progress',
      };
    case 'done':
      return {
        label: `Installed ${event.iconCount} ${label} icons`,
        icon: <CheckCircle2 className="sf:h-4 sf:w-4 sf:text-emerald-500" aria-hidden="true" />,
        variant: 'done',
      };
    case 'error':
      return {
        label: `Install failed: ${event.message}`,
        icon: <AlertTriangle className="sf:h-4 sf:w-4 sf:text-destructive" aria-hidden="true" />,
        variant: 'error',
      };
  }
}

export function InstallProgressToast({
  vendor,
  event,
  onRetry,
  onClose,
}: InstallProgressToastProps): ReactNode {
  const body = bodyForEvent(vendor, event);
  const showRetry = body.variant === 'error' && onRetry !== undefined;

  return (
    <output
      aria-live="polite"
      data-testid="install-progress-toast"
      data-variant={body.variant}
      data-vendor={vendor}
      className={cn(
        'sf:flex sf:items-center sf:gap-2 sf:rounded-md sf:border sf:border-border sf:bg-card sf:p-3 sf:text-sm sf:text-foreground sf:shadow-md',
      )}
    >
      <span className="sf:flex sf:shrink-0 sf:items-center">{body.icon}</span>
      <span className="sf:min-w-0 sf:flex-1 sf:truncate" data-testid="install-progress-toast-label">
        {body.label}
      </span>
      {showRetry ? (
        <button
          type="button"
          data-testid="install-progress-toast-retry"
          onClick={() => onRetry?.()}
          className={cn(
            'sf:inline-flex sf:h-7 sf:items-center sf:rounded-md sf:bg-primary sf:px-2 sf:text-xs sf:font-medium sf:text-primary-foreground sf:transition-colors',
            'sf:hover:bg-primary/90',
            'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
          )}
        >
          Retry
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          data-testid="install-progress-toast-close"
          aria-label="Dismiss"
          onClick={() => onClose()}
          className={cn(
            'sf:inline-flex sf:h-7 sf:w-7 sf:shrink-0 sf:items-center sf:justify-center sf:rounded-md sf:text-muted-foreground sf:transition-colors',
            'sf:hover:bg-muted sf:hover:text-foreground',
            'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
          )}
        >
          <X className="sf:h-3 sf:w-3" aria-hidden="true" />
        </button>
      ) : null}
    </output>
  );
}

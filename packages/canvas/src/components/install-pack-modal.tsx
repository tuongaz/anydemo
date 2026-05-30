import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { IconPackVendor } from '../adapter/types.ts';
import { cn } from '../lib/cn.ts';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';

// US-017: Install Pack modal. Shown when the author clicks Install on a
// vendor row in <BrowsePacksPanel>. The Confirm button is disabled until the
// "I have read the license" checkbox is checked when `requiresAcceptance` is
// true; for vendors that don't require acceptance (AWS) the checkbox
// is hidden and Confirm is enabled immediately.

const VENDOR_LABELS: Record<IconPackVendor, string> = {
  aws: 'AWS',
  azure: 'Microsoft Azure',
};

export interface InstallPackModalProps {
  /** Controlled visibility — owner is the picker. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: IconPackVendor;
  licenseSummary: string;
  licenseUrl: string;
  requiresAcceptance: boolean;
  /**
   * Fired when the author confirms the install. `acceptTerms` is true when
   * the vendor requires explicit acceptance AND the checkbox was checked;
   * always false otherwise. The picker forwards this to
   * `adapter.icons.install(vendor, { acceptTerms })`.
   */
  onConfirm: (payload: { acceptTerms: boolean }) => void;
  onCancel: () => void;
}

export function InstallPackModal({
  open,
  onOpenChange,
  vendor,
  licenseSummary,
  licenseUrl,
  requiresAcceptance,
  onConfirm,
  onCancel,
}: InstallPackModalProps) {
  const [accepted, setAccepted] = useState(false);
  const label = VENDOR_LABELS[vendor];
  const canConfirm = !requiresAcceptance || accepted;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setAccepted(false);
      }}
    >
      <DialogContent data-testid="install-pack-modal" className="sf:max-w-md">
        <DialogHeader>
          <DialogTitle>Install {label} icon pack</DialogTitle>
          <DialogDescription>
            Icons will be downloaded and cached locally. You can remove the pack at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="sf:flex sf:flex-col sf:gap-3">
          <div
            className="sf:rounded-md sf:border sf:border-border sf:bg-muted sf:p-3 sf:text-xs sf:text-muted-foreground"
            data-testid="install-pack-modal-license"
          >
            <div className="sf:mb-1 sf:font-medium sf:text-foreground">License</div>
            <div>{licenseSummary}</div>
            <a
              href={licenseUrl}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="install-pack-modal-license-link"
              className="sf:mt-2 sf:inline-flex sf:items-center sf:gap-1 sf:text-primary sf:hover:underline"
            >
              View full license <ExternalLink className="sf:h-3 sf:w-3" aria-hidden="true" />
            </a>
          </div>

          {requiresAcceptance ? (
            <label
              className="sf:flex sf:cursor-pointer sf:items-center sf:gap-2 sf:text-sm sf:text-foreground"
              data-testid="install-pack-modal-accept-label"
            >
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                data-testid="install-pack-modal-accept"
                className={cn(
                  'sf:h-4 sf:w-4 sf:rounded sf:border sf:border-input sf:bg-background',
                  'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
                )}
              />
              I have read and accept the license terms
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid="install-pack-modal-cancel"
            onClick={() => {
              onCancel();
              setAccepted(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="install-pack-modal-confirm"
            disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm) return;
              onConfirm({ acceptTerms: requiresAcceptance ? accepted : false });
              setAccepted(false);
            }}
          >
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

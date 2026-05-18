import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@seeflow/canvas';
import { FileDown, Image as ImageIcon, Loader2, Share2, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';

export interface ShareMenuProps {
  /**
   * Download the current canvas as a PDF. When omitted, the "Download PDF"
   * menu item is hidden. When both callbacks are omitted, the trigger button
   * itself is hidden so an unloaded demo has no share affordance.
   */
  onDownloadPdf?: () => Promise<unknown> | unknown;
  /**
   * Download the current canvas as a PNG. When omitted, the "Download PNG"
   * menu item is hidden.
   */
  onDownloadPng?: () => Promise<unknown> | unknown;
  /**
   * Open the export-to-cloud dialog. When omitted, the "Export to seeflow.dev"
   * menu item is hidden.
   */
  onExportToCloud?: () => void;
}

const SHARE_LABEL = 'Share / download';
const DOWNLOAD_PDF_LABEL = 'Download PDF';
const DOWNLOAD_PNG_LABEL = 'Download PNG';
const EXPORT_TO_CLOUD_LABEL = 'Export to seeflow.dev';

/**
 * Top-right share affordance. Replaces the toolbar's Export SVG/PDF buttons
 * with a single discoverable entry point that offers PDF and PNG formats.
 */
export function ShareMenu({ onDownloadPdf, onDownloadPng, onExportToCloud }: ShareMenuProps) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingPng, setDownloadingPng] = useState(false);

  const handleDownloadPdf = useCallback(() => {
    if (!onDownloadPdf || downloadingPdf) return;
    setDownloadingPdf(true);
    Promise.resolve(onDownloadPdf()).finally(() => setDownloadingPdf(false));
  }, [onDownloadPdf, downloadingPdf]);

  const handleDownloadPng = useCallback(() => {
    if (!onDownloadPng || downloadingPng) return;
    setDownloadingPng(true);
    Promise.resolve(onDownloadPng()).finally(() => setDownloadingPng(false));
  }, [onDownloadPng, downloadingPng]);

  if (!onDownloadPdf && !onDownloadPng && !onExportToCloud) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="share-menu-trigger"
          aria-label={SHARE_LABEL}
          title={SHARE_LABEL}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground shadow-md backdrop-blur transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        data-testid="share-menu-content"
        onCloseAutoFocus={(e) => {
          // Keep focus where the click happened; don't yank it back to the
          // trigger after the download starts (the download is silent).
          e.preventDefault();
        }}
      >
        {onDownloadPdf ? (
          <DropdownMenuItem
            data-testid="share-menu-pdf"
            disabled={downloadingPdf}
            onSelect={(e) => {
              // Trigger via our handler instead of letting Radix auto-close;
              // we want the spinner to remain visible until the export settles.
              e.preventDefault();
              handleDownloadPdf();
            }}
          >
            {downloadingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{DOWNLOAD_PDF_LABEL}</span>
          </DropdownMenuItem>
        ) : null}
        {onDownloadPng ? (
          <DropdownMenuItem
            data-testid="share-menu-png"
            disabled={downloadingPng}
            onSelect={(e) => {
              e.preventDefault();
              handleDownloadPng();
            }}
          >
            {downloadingPng ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{DOWNLOAD_PNG_LABEL}</span>
          </DropdownMenuItem>
        ) : null}
        {onExportToCloud ? (
          <DropdownMenuItem
            data-testid="share-menu-export-cloud"
            onSelect={() => {
              onExportToCloud();
            }}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{EXPORT_TO_CLOUD_LABEL}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

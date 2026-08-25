import { FileDown, Image as ImageIcon, Loader2, Share2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { cn } from '../lib/cn.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx';

export interface ShareMenuProps {
  /**
   * Download the current canvas as a PDF. When omitted, the "Download PDF"
   * menu item is hidden.
   */
  onDownloadPdf?: () => Promise<unknown> | unknown;
  /**
   * Download the current canvas as a PNG. When omitted, the "Download PNG"
   * menu item is hidden.
   */
  onDownloadPng?: () => Promise<unknown> | unknown;
}

const DOWNLOAD_LABEL = 'Download';
const DOWNLOAD_PDF_LABEL = 'Download PDF';
const DOWNLOAD_PNG_LABEL = 'Download PNG';

/**
 * Top-right download affordance for SeeflowCanvas. Surfaces Download PDF /
 * Download PNG — each item gated on its own callback being wired. The whole
 * trigger disappears when nothing is renderable.
 */
export function ShareMenu({ onDownloadPdf, onDownloadPng }: ShareMenuProps) {
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

  const showPdf = Boolean(onDownloadPdf);
  const showPng = Boolean(onDownloadPng);

  if (!showPdf && !showPng) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="share-menu-trigger"
          aria-label={DOWNLOAD_LABEL}
          title={DOWNLOAD_LABEL}
          className={cn(
            'sf:inline-flex sf:h-8 sf:w-8 sf:items-center sf:justify-center sf:rounded-md sf:border sf:border-border sf:bg-background/95 sf:text-muted-foreground sf:shadow-md sf:backdrop-blur-sm sf:transition-colors',
            'sf:hover:bg-accent sf:hover:text-accent-foreground',
            'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring',
          )}
        >
          <Share2 className="sf:h-4 sf:w-4" aria-hidden="true" />
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
        {showPdf ? (
          <DropdownMenuItem
            data-testid="share-menu-pdf"
            disabled={downloadingPdf}
            onSelect={(e) => {
              // Keep the menu open until the export settles so the spinner stays visible.
              e.preventDefault();
              handleDownloadPdf();
            }}
          >
            {downloadingPdf ? (
              <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="sf:h-4 sf:w-4" aria-hidden="true" />
            )}
            <span>{DOWNLOAD_PDF_LABEL}</span>
          </DropdownMenuItem>
        ) : null}
        {showPng ? (
          <DropdownMenuItem
            data-testid="share-menu-png"
            disabled={downloadingPng}
            onSelect={(e) => {
              e.preventDefault();
              handleDownloadPng();
            }}
          >
            {downloadingPng ? (
              <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />
            ) : (
              <ImageIcon className="sf:h-4 sf:w-4" aria-hidden="true" />
            )}
            <span>{DOWNLOAD_PNG_LABEL}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

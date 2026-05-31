import { FileDown, Image as ImageIcon, Loader2, Share2, Square, Upload, Users } from 'lucide-react';
import { useCallback, useState } from 'react';

import { cn } from '../lib/cn.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx';
import { EmbedDialog } from './embed-dialog.tsx';

export type ShareMenuMode = 'edit' | 'view';

export interface ShareMenuProps {
  /**
   * Drives view-mode visibility rules. Export-to-seeflow.dev is force-hidden
   * when `mode === 'view'`, even if its callback is set. Embed used to share
   * that rule but is now gated solely by `enableEmbed` + `projectId`, so it
   * can surface in either mode when the host opts in. Mode is required so the
   * menu does not need to re-implement `resolveFlags`.
   */
  mode: ShareMenuMode;
  /**
   * Stable identifier the Embed dialog uses to construct the iframe URL. When
   * absent, the Embed menu item is hidden even in edit mode.
   */
  projectId?: string;
  /**
   * Master enable flag for the Embed menu item + inner EmbedDialog. When
   * false, the item is hidden and the dialog is not mounted regardless of
   * `mode` / `projectId`. The host always resolves this through
   * `resolveFlags`, so the prop is required.
   */
  enableEmbed: boolean;
  /**
   * Download the current canvas as a PDF. When omitted, the "Download PDF"
   * menu item is hidden. Works in both `edit` and `view` modes.
   */
  onDownloadPdf?: () => Promise<unknown> | unknown;
  /**
   * Download the current canvas as a PNG. When omitted, the "Download PNG"
   * menu item is hidden. Works in both `edit` and `view` modes.
   */
  onDownloadPng?: () => Promise<unknown> | unknown;
  /**
   * Open the host's export-to-cloud dialog. Edit-mode-only opt-in: rendered
   * only when this callback is set AND `mode === 'edit'`.
   */
  onExportToCloud?: () => void;
  /**
   * Open the host's Live Share dialog (real-time co-edit session). Edit-mode-only
   * opt-in: rendered only when this callback is set AND `mode === 'edit'`. The
   * dialog itself drives start/stop/peer-management — this callback just opens it.
   */
  onLiveShare?: () => void;
  /**
   * Controlled `open` state for the inner EmbedDialog. When provided, the menu
   * defers entirely to the host for embed-state ownership (used by
   * SeeflowCanvas's imperative `openEmbedDialog()` handle in US-014). When
   * absent the menu falls back to its own internal state.
   */
  embedOpen?: boolean;
  /**
   * Controlled `onOpenChange` for the inner EmbedDialog. Pairs with
   * `embedOpen`; called both when the user clicks the Embed menu item and when
   * the dialog dismisses (outside-click / ESC / Close). Falls back to internal
   * state when absent.
   */
  onEmbedOpenChange?: (open: boolean) => void;
}

const SHARE_LABEL = 'Share / download';
const DOWNLOAD_PDF_LABEL = 'Download PDF';
const DOWNLOAD_PNG_LABEL = 'Download PNG';
const EMBED_LABEL = 'Embed';
const LIVE_SHARE_LABEL = 'Live Share';
const EXPORT_TO_CLOUD_LABEL = 'Export to seeflow.dev';

/**
 * Top-right share affordance for SeeflowCanvas. Surfaces Download PDF /
 * Download PNG / Embed / Export to seeflow.dev — each item gated on its own
 * input AND the mode-visibility rules from the design doc. The whole trigger
 * disappears when nothing is renderable.
 */
export function ShareMenu({
  mode,
  projectId,
  enableEmbed,
  onDownloadPdf,
  onDownloadPng,
  onExportToCloud,
  onLiveShare,
  embedOpen: embedOpenProp,
  onEmbedOpenChange,
}: ShareMenuProps) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingPng, setDownloadingPng] = useState(false);
  const [internalEmbedOpen, setInternalEmbedOpen] = useState(false);
  const embedControlled = embedOpenProp !== undefined;
  const embedOpen = embedControlled ? embedOpenProp : internalEmbedOpen;
  const setEmbedOpen = useCallback(
    (next: boolean) => {
      if (!embedControlled) setInternalEmbedOpen(next);
      onEmbedOpenChange?.(next);
    },
    [embedControlled, onEmbedOpenChange],
  );

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
  const showEmbed = enableEmbed && typeof projectId === 'string' && projectId.length > 0;
  const showExportToCloud = mode === 'edit' && Boolean(onExportToCloud);
  const showLiveShare = mode === 'edit' && Boolean(onLiveShare);

  if (!showPdf && !showPng && !showEmbed && !showExportToCloud && !showLiveShare) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="share-menu-trigger"
            aria-label={SHARE_LABEL}
            title={SHARE_LABEL}
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
          {showEmbed ? (
            <DropdownMenuItem
              data-testid="share-menu-embed"
              onSelect={(e) => {
                e.preventDefault();
                setEmbedOpen(true);
              }}
            >
              <Square className="sf:h-4 sf:w-4" aria-hidden="true" />
              <span>{EMBED_LABEL}</span>
            </DropdownMenuItem>
          ) : null}
          {showLiveShare ? (
            <DropdownMenuItem
              data-testid="share-menu-live-share"
              onSelect={() => {
                onLiveShare?.();
              }}
            >
              <Users className="sf:h-4 sf:w-4" aria-hidden="true" />
              <span>{LIVE_SHARE_LABEL}</span>
            </DropdownMenuItem>
          ) : null}
          {showExportToCloud ? (
            <DropdownMenuItem
              data-testid="share-menu-export-cloud"
              onSelect={() => {
                onExportToCloud?.();
              }}
            >
              <Upload className="sf:h-4 sf:w-4" aria-hidden="true" />
              <span>{EXPORT_TO_CLOUD_LABEL}</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {showEmbed && projectId ? (
        <EmbedDialog open={embedOpen} onOpenChange={setEmbedOpen} projectId={projectId} />
      ) : null}
    </>
  );
}

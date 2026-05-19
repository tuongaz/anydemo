import { useCallback, useRef, useState } from 'react';
import { buildEmbedSnippet, buildEmbedUrl } from '../lib/build-embed-snippet.ts';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';

export interface EmbedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

const TITLE = 'Embed this canvas';
const DESCRIPTION = 'Paste this iframe into any page to embed the canvas.';
const COPY_LABEL = 'Copy snippet';
const COPIED_LABEL = 'Copied!';
const FALLBACK_HINT = 'Press ⌘C to copy';
const CLOSE_LABEL = 'Close';
const COPIED_RESET_MS = 1500;

type CopyStatus = 'idle' | 'copied' | 'fallback';

/**
 * Modal that surfaces the iframe snippet for embedding a canvas. Mounts via
 * the canvas portal container (inherited from `src/ui/dialog.tsx`) so it lands
 * inside `.seeflow-canvas-root` and inherits the scoped CSS. ShareMenu (US-013)
 * owns the open state.
 */
export function EmbedDialog({ open, onOpenChange, projectId }: EmbedDialogProps) {
  const snippet = buildEmbedSnippet(buildEmbedUrl(projectId));
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), COPIED_RESET_MS);
    } catch {
      setCopyStatus('fallback');
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.select();
      }
    }
  }, [snippet]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="embed-dialog-content">
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <textarea
          ref={textareaRef}
          data-testid="embed-dialog-snippet"
          readOnly
          rows={7}
          value={snippet}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          className="sf:w-full sf:resize-none sf:rounded-md sf:border sf:border-border sf:bg-background sf:p-3 sf:font-mono sf:text-xs sf:leading-relaxed sf:text-foreground sf:focus:outline-hidden sf:focus:ring-2 sf:focus:ring-ring"
        />
        {copyStatus === 'fallback' ? (
          <p
            data-testid="embed-dialog-fallback-hint"
            className="sf:text-xs sf:text-muted-foreground"
          >
            {FALLBACK_HINT}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            data-testid="embed-dialog-close"
            onClick={() => onOpenChange(false)}
          >
            {CLOSE_LABEL}
          </Button>
          <Button data-testid="embed-dialog-copy" onClick={handleCopy}>
            {copyStatus === 'copied' ? COPIED_LABEL : COPY_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

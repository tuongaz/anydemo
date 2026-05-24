import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type ResolvedEmbedTheme,
  buildEmbedSnippet,
  buildEmbedUrl,
  getResolvedThemeFromDocument,
} from '../lib/build-embed-snippet.ts';
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

export interface EmbedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

/**
 * Theme toggle choices surfaced in the dialog. `'match'` resolves to the
 * calling canvas's current resolved theme (read off `<html>`'s `.dark` class)
 * at render time, so the embed URL always reflects the host's active palette.
 */
export type EmbedThemeChoice = 'match' | 'light' | 'dark';

const TITLE = 'Embed this canvas';
const DESCRIPTION = 'Paste this iframe into any page to embed the canvas.';
const COPY_LABEL = 'Copy snippet';
const COPIED_LABEL = 'Copied!';
const FALLBACK_HINT = 'Press ⌘C to copy';
const CLOSE_LABEL = 'Close';
const THEME_GROUP_LABEL = 'Theme';
const COPIED_RESET_MS = 1500;

const THEME_CHOICE_OPTIONS: { value: EmbedThemeChoice; label: string }[] = [
  { value: 'match', label: 'Match my theme' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

type CopyStatus = 'idle' | 'copied' | 'fallback';

const resolveThemeForUrl = (choice: EmbedThemeChoice): ResolvedEmbedTheme => {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return getResolvedThemeFromDocument(typeof document !== 'undefined' ? document : null);
};

/**
 * Modal that surfaces the iframe snippet for embedding a canvas. Mounts via
 * the canvas portal container (inherited from `src/ui/dialog.tsx`) so it lands
 * inside `.seeflow-canvas-root` and inherits the scoped CSS. ShareMenu (US-013)
 * owns the open state. A theme toggle (US-009) appends `?theme=light|dark` to
 * the embed URL so the iframe can pin to a specific palette.
 */
export function EmbedDialog({ open, onOpenChange, projectId }: EmbedDialogProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [themeChoice, setThemeChoice] = useState<EmbedThemeChoice>('match');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const snippet = useMemo(
    () => buildEmbedSnippet(buildEmbedUrl(projectId, resolveThemeForUrl(themeChoice))),
    [projectId, themeChoice],
  );

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
        <fieldset className="sf:flex sf:flex-col sf:gap-2 sf:border-0 sf:p-0">
          <legend
            id="embed-dialog-theme-label"
            className="sf:mb-2 sf:text-xs sf:font-medium sf:text-foreground"
          >
            {THEME_GROUP_LABEL}
          </legend>
          <div
            data-testid="embed-dialog-theme-group"
            className="sf:inline-flex sf:self-start sf:rounded-md sf:border sf:border-input sf:bg-background sf:p-0.5"
          >
            {THEME_CHOICE_OPTIONS.map((opt) => {
              const active = themeChoice === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={opt.label}
                  data-testid={`embed-dialog-theme-${opt.value}`}
                  data-active={active}
                  onClick={() => setThemeChoice(opt.value)}
                  className={cn(
                    'sf:rounded sf:px-3 sf:py-1 sf:text-xs sf:transition-colors sf:focus-visible:outline-hidden sf:focus-visible:ring-1 sf:focus-visible:ring-ring',
                    active
                      ? 'sf:bg-secondary sf:text-secondary-foreground sf:shadow-sm'
                      : 'sf:text-muted-foreground sf:hover:bg-accent sf:hover:text-accent-foreground',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>
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

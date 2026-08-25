import type { FlowSummary } from '@/lib/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@seeflow/canvas';
import { useCallback, useEffect, useMemo, useState } from 'react';

// US-038-pattern: neutralize the upstream DialogContent enter/exit transforms so
// only opacity animates. Same idiom as flow-create-dialog.tsx.
const FADE_ONLY_STYLE = {
  '--tw-enter-translate-x': '-50%',
  '--tw-enter-translate-y': '-50%',
  '--tw-exit-translate-x': '-50%',
  '--tw-exit-translate-y': '-50%',
  '--tw-enter-scale': '1',
  '--tw-exit-scale': '1',
} as React.CSSProperties;

export interface LinkflowPickerTarget {
  project: string;
  flow: string;
}

export interface LinkflowPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 'link' = first-time pick (title: "Link to a flow", no preselection).
   * 'edit' = swap an existing target (title: "Change linked flow", pre-selects
   *          `initialTarget` when it resolves in `flows`).
   */
  mode: 'link' | 'edit';
  /** FlowSummary[] from `useFlows()`. */
  flows: readonly FlowSummary[];
  /** slug ('project/flow') of the currently-viewed flow — earns a "Currently
   *  viewing" badge but stays selectable so self-links work. */
  currentSlug?: string | null;
  /** Pre-selected target when mode === 'edit'. */
  initialTarget?: LinkflowPickerTarget | null;
  onCommit: (target: LinkflowPickerTarget) => void;
}

const targetToSlug = (t: LinkflowPickerTarget | null | undefined): string | null =>
  t ? `${t.project}/${t.flow}` : null;

const splitSlug = (slug: string): LinkflowPickerTarget | null => {
  const idx = slug.indexOf('/');
  if (idx < 1 || idx === slug.length - 1) return null;
  return { project: slug.slice(0, idx), flow: slug.slice(idx + 1) };
};

// HTML ids can't contain '/' — replace before binding aria-activedescendant.
const rowDomId = (slug: string): string => `linkflow-picker-row-${slug.replace(/\//g, '__')}`;

export function LinkflowPickerDialog({
  open,
  onOpenChange,
  mode,
  flows,
  currentSlug,
  initialTarget,
  onCommit,
}: LinkflowPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() =>
    mode === 'edit' ? targetToSlug(initialTarget) : null,
  );

  // Reset state every time the dialog (re)opens so a previous session's query
  // or selection doesn't leak.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedSlug(mode === 'edit' ? targetToSlug(initialTarget) : null);
    }
  }, [open, mode, initialTarget]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return flows.slice();
    return flows.filter((d) => {
      const projectSlug = d.slug.split('/')[0] ?? '';
      return projectSlug.toLowerCase().includes(q) || d.name.toLowerCase().includes(q);
    });
  }, [flows, query]);

  const selectedIndex = useMemo(() => {
    if (!selectedSlug) return -1;
    return filtered.findIndex((d) => d.slug === selectedSlug);
  }, [filtered, selectedSlug]);

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      if (filtered.length === 0) return;
      const len = filtered.length;
      const next =
        selectedIndex < 0
          ? direction === 1
            ? 0
            : len - 1
          : (selectedIndex + direction + len) % len;
      const row = filtered[next];
      if (row) setSelectedSlug(row.slug);
    },
    [filtered, selectedIndex],
  );

  const handleCommit = useCallback(() => {
    if (selectedIndex < 0 || !selectedSlug) return;
    const target = splitSlug(selectedSlug);
    if (!target) return;
    onCommit(target);
    onOpenChange(false);
  }, [selectedSlug, selectedIndex, onCommit, onOpenChange]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [moveSelection, handleCommit, onOpenChange],
  );

  const title = mode === 'edit' ? 'Change linked flow' : 'Link to a flow';
  const activeDescendantId =
    selectedSlug && selectedIndex >= 0 ? rowDomId(selectedSlug) : undefined;
  const canCommit = selectedIndex >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        style={FADE_ONLY_STYLE}
        data-testid="linkflow-picker-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="linkflow-picker-search"]',
          );
          input?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle data-testid="linkflow-picker-title">{title}</DialogTitle>
          <DialogDescription>Pick a flow to navigate to from this node.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search flows…"
            data-testid="linkflow-picker-search"
            aria-label="Search flows"
            aria-activedescendant={activeDescendantId}
            autoComplete="off"
            spellCheck={false}
            className="rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <div
            aria-label="Flows"
            data-testid="linkflow-picker-list"
            // 8 visible rows: each row is py-2 (8px top + 8px bottom) + text-sm
            // line-height ~20px = ~36px tall. 8 * 36 = 288 + 16 slack → 304.
            // Rounded to 304px so the scrollbar engages right at row 9.
            style={{ maxHeight: '304px' }}
            className="overflow-y-auto rounded-md border seeflow-no-scrollbar"
          >
            {filtered.length === 0 ? (
              <div
                data-testid="linkflow-picker-empty"
                className="px-3 py-6 text-center text-sm text-muted-foreground"
              >
                {query.trim().length === 0 ? 'No flows registered.' : `No flows match "${query}"`}
              </div>
            ) : (
              filtered.map((d) => {
                const projectSlug = d.slug.split('/')[0] ?? '';
                const isSelected = d.slug === selectedSlug;
                const isCurrent = d.slug === currentSlug;
                return (
                  <button
                    key={d.slug}
                    type="button"
                    id={rowDomId(d.slug)}
                    data-testid={`linkflow-picker-row-${d.slug}`}
                    data-selected={isSelected ? 'true' : 'false'}
                    onMouseDown={(e) => {
                      // Keep the search input focused so aria-activedescendant
                      // continues to drive screen-reader navigation.
                      e.preventDefault();
                    }}
                    onClick={() => setSelectedSlug(d.slug)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm outline-hidden',
                      isSelected ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/60',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs text-muted-foreground">{projectSlug}</span>
                      <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">
                        ·
                      </span>
                      <span className="truncate font-medium">{d.name}</span>
                    </div>
                    {isCurrent ? (
                      <span
                        data-testid={`linkflow-picker-current-badge-${d.slug}`}
                        className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                      >
                        Currently viewing
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="linkflow-picker-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleCommit}
            disabled={!canCommit}
            data-testid="linkflow-picker-commit"
          >
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

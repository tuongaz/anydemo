import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getRecents } from '@/lib/icon-recents';
import { ICON_NAMES, ICON_REGISTRY } from '@/lib/icon-registry';
import { cn } from '@seeflow/canvas';
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from 'react';

// Layout constants. Tile is h-7 w-7 (28px); rows are tile + 4px gap = 32px.
// LIST_HEIGHT * COLS keeps the all-icons grid roughly square in the popover.
const COLS = 8;
const ROW_HEIGHT = 32;
const LIST_HEIGHT = 256;
const OVERSCAN = 2;

export function filterIcons(names: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return names.slice();
  return names.filter((name) => name.toLowerCase().includes(q));
}

export interface IconPickerPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: ReactNode;
  onPick: (name: string) => void;
}

export function IconPickerPopover({ open, onOpenChange, anchor, onPick }: IconPickerPopoverProps) {
  const [query, setQuery] = useState('');
  // Recents are read at open time so a same-session push elsewhere becomes
  // visible the next time the picker opens. We deliberately do NOT subscribe
  // to storage events — the picker is short-lived and this keeps it simple.
  const recents = useMemo(() => (open ? getRecents() : []), [open]);

  // Reset the search field on close so the next open starts fresh.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[340px] p-0"
        data-testid="icon-picker-popover"
      >
        <IconPickerBody query={query} onQueryChange={setQuery} recents={recents} onPick={onPick} />
      </PopoverContent>
    </Popover>
  );
}

export interface IconPickerBodyProps {
  query: string;
  onQueryChange: (q: string) => void;
  recents: string[];
  onPick: (name: string) => void;
}

// Body is exported so unit tests can render it without standing up the Radix
// Popover (which needs a real DOM + portal). The wrapper is a thin shell —
// all picker behavior lives here.
export function IconPickerBody({ query, onQueryChange, recents, onPick }: IconPickerBodyProps) {
  const filtered = useMemo(() => filterIcons(ICON_NAMES, query), [query]);
  const showRecents = query.trim() === '' && recents.length > 0;

  // Hand-rolled vertical windowing: with ~5000 names the naive grid kills
  // scroll perf, and @tanstack/react-virtual isn't in deps. Compute the row
  // window from scrollTop, render only the slice that overlaps.
  const [scrollTop, setScrollTop] = useState(0);
  const totalRows = Math.max(1, Math.ceil(filtered.length / COLS));
  const totalHeight = totalRows * ROW_HEIGHT;
  const visibleRowCount = Math.ceil(LIST_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, startRow + visibleRowCount);
  const startIndex = startRow * COLS;
  const endIndex = Math.min(filtered.length, endRow * COLS);
  const visible = filtered.slice(startIndex, endIndex);

  return (
    <div className="flex w-full flex-col">
      <div className="border-b border-border p-2">
        <input
          type="text"
          value={query}
          placeholder="Search icons…"
          aria-label="Search icons"
          data-testid="icon-picker-search"
          className={cn(
            'flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          )}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
        />
      </div>

      {showRecents ? (
        <div className="border-b border-border p-2" data-testid="icon-picker-recents">
          <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Recent
          </div>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
          >
            {recents.map((name) => renderTile(name, onPick, `icon-picker-recent-${name}`))}
          </div>
        </div>
      ) : null}

      <div className="p-2">
        <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          All icons
        </div>
        {filtered.length === 0 ? (
          <div
            className="flex items-center justify-center text-xs text-muted-foreground"
            style={{ height: LIST_HEIGHT }}
            data-testid="icon-picker-empty"
          >
            No icons match.
          </div>
        ) : (
          <div
            data-testid="icon-picker-all"
            className="overflow-y-auto"
            style={{ height: LIST_HEIGHT }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  top: startRow * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                }}
              >
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
                >
                  {visible.map((name) => renderTile(name, onPick, `icon-picker-tile-${name}`))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline tile renderer (a function, not a component) so the rendered tree
// resolves to a plain <button> placeholder when IconPickerBody is called as
// a function in the apps/web hook-shim test pattern.
function renderTile(name: string, onPick: (name: string) => void, testId: string) {
  const Icon = ICON_REGISTRY[name];
  return (
    <button
      key={testId}
      type="button"
      title={name}
      aria-label={name}
      data-testid={testId}
      data-icon-name={name}
      onClick={() => onPick(name)}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
    >
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
    </button>
  );
}

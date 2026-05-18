import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  COMMANDS,
  type CommandCategory,
  type CommandContext,
  type CommandDef,
  type CommandId,
  cn,
} from '@seeflow/canvas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runCommand: (id: CommandId) => void;
  ctx: CommandContext;
}

// Order categories render in. Anything outside this list falls back to source
// order at the bottom — but every CommandCategory in keyboard-shortcuts.ts is
// covered here so that branch is defensive only.
const CATEGORY_ORDER: readonly CommandCategory[] = [
  'File',
  'Edit',
  'View',
  'Tools',
  'Layout',
  'Selection',
  'Help',
];

const RECENT_STORAGE_KEY = 'seeflow:command-palette:recent';
const RECENT_MAX = 5;

const COMMANDS_BY_ID = new Map<CommandId, CommandDef>(COMMANDS.map((c) => [c.id, c]));

const isCommandId = (value: unknown): value is CommandId =>
  typeof value === 'string' && COMMANDS_BY_ID.has(value as CommandId);

const loadRecents = (): CommandId[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCommandId).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
};

const persistRecents = (ids: readonly CommandId[]): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage can be unavailable (private mode quotas, sandboxed iframes).
    // Recents are a quality-of-life feature; silently degrading to in-memory
    // only is the right behavior.
  }
};

const isEnabled = (cmd: CommandDef, ctx: CommandContext): boolean =>
  cmd.enabled ? cmd.enabled(ctx) : true;

const matchesSearch = (cmd: CommandDef, query: string): boolean => {
  if (query.length === 0) return true;
  const haystack = `${cmd.label} ${cmd.description ?? ''}`.toLowerCase();
  return haystack.includes(query);
};

type GroupedCommand = { cmd: CommandDef; enabled: boolean };
type Group = { category: CommandCategory | 'Recent'; rows: GroupedCommand[] };

export function CommandPalette({ open, onOpenChange, runCommand, ctx }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [recents, setRecents] = useState<CommandId[]>(() => loadRecents());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state every time the palette opens — stale query/highlight would be
  // surprising on the next invocation. Recents are re-read from storage so an
  // update from another tab/window doesn't leave us with a stale list.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightedIndex(0);
      setRecents(loadRecents());
    }
  }, [open]);

  // Flat list of currently-visible rows (post-filter, post-disable-aware) plus
  // the groups for the rendered layout. The flat list backs keyboard navigation
  // so ArrowDown/ArrowUp can move past category headings without surprise.
  //
  // Default state (no query): show the user's recent commands if there are any,
  // otherwise render an empty list. The full grouped catalog only surfaces once
  // the user types — keeps the palette feeling like a search surface rather
  // than a wall of options.
  const { groups, flat } = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) {
      if (recents.length === 0) {
        return { groups: [] as Group[], flat: [] as GroupedCommand[] };
      }
      const recentRows: GroupedCommand[] = [];
      for (const id of recents) {
        const cmd = COMMANDS_BY_ID.get(id);
        if (!cmd) continue;
        recentRows.push({ cmd, enabled: isEnabled(cmd, ctx) });
      }
      const recentGroup: Group = { category: 'Recent', rows: recentRows };
      return { groups: [recentGroup], flat: recentRows };
    }
    const byCategory = new Map<CommandCategory, GroupedCommand[]>();
    for (const cmd of COMMANDS) {
      if (!matchesSearch(cmd, normalized)) continue;
      const entry: GroupedCommand = { cmd, enabled: isEnabled(cmd, ctx) };
      const bucket = byCategory.get(cmd.category);
      if (bucket) bucket.push(entry);
      else byCategory.set(cmd.category, [entry]);
    }
    const orderedCategories: CommandCategory[] = [
      ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
      ...Array.from(byCategory.keys()).filter((c) => !CATEGORY_ORDER.includes(c)),
    ];
    const builtGroups: Group[] = orderedCategories.map((category) => ({
      category,
      rows: byCategory.get(category) ?? [],
    }));
    const flatList: GroupedCommand[] = builtGroups.flatMap((g) => g.rows);
    return { groups: builtGroups, flat: flatList };
  }, [query, ctx, recents]);

  // Clamp the highlighted index any time the visible list shrinks. Skip
  // disabled rows when picking a fresh highlight so Enter never lands on one.
  useEffect(() => {
    if (flat.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((prev) => {
      let idx = prev;
      if (idx >= flat.length) idx = 0;
      // If the current index lands on a disabled row, advance to the next
      // enabled one. If none exist, stay put.
      if (!flat[idx]?.enabled) {
        const nextEnabled = flat.findIndex((r) => r.enabled);
        if (nextEnabled !== -1) idx = nextEnabled;
      }
      return idx;
    });
  }, [flat]);

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (flat.length === 0) return;
      setHighlightedIndex((prev) => {
        // Walk in `direction` until we land on an enabled row. Bail after one
        // full lap to avoid an infinite loop if every row is disabled.
        let next = prev;
        for (let i = 0; i < flat.length; i++) {
          next = (next + direction + flat.length) % flat.length;
          if (flat[next]?.enabled) return next;
        }
        return prev;
      });
    },
    [flat],
  );

  const recordRecent = useCallback((id: CommandId) => {
    setRecents((prev) => {
      const next = [id, ...prev.filter((existing) => existing !== id)].slice(0, RECENT_MAX);
      persistRecents(next);
      return next;
    });
  }, []);

  const executeAt = useCallback(
    (index: number) => {
      const row = flat[index];
      if (!row || !row.enabled) return;
      recordRecent(row.cmd.id);
      runCommand(row.cmd.id);
      onOpenChange(false);
    },
    [flat, onOpenChange, recordRecent, runCommand],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        executeAt(highlightedIndex);
      }
    },
    [executeAt, highlightedIndex, moveHighlight],
  );

  // Scroll the highlighted row into view as the user navigates. Without this,
  // ArrowDown past the visible window strands the highlight off-screen.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLButtonElement>(
      `[data-command-row-index="${highlightedIndex}"]`,
    );
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, open]);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          // `left-0 right-0 mx-auto` centers horizontally WITHOUT a translate
          // transform. The previous `left-[50%] translate-x-[-50%]` centering
          // collided with tailwindcss-animate's enter keyframe (which animates
          // `transform` from `translate3d(0, 0, 0)`), wiping out the -50%
          // offset on frame 0 and making the palette appear to slide in from
          // the right. With margin-based centering nothing transforms, so the
          // enter animation only fades opacity — which is what we want.
          className={cn(
            'fixed left-0 right-0 top-[20%] z-50 mx-auto w-[480px] max-w-[90vw] border border-border bg-card shadow-lg duration-200',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'sm:rounded-lg',
          )}
          data-testid="command-palette"
          onOpenAutoFocus={(e) => {
            // Let our search input grab focus instead of Radix's default close
            // button — the palette is search-first.
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className={cn('border-b', flat.length === 0 && !hasQuery && 'border-b-0')}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Type a command…"
              data-testid="command-palette-input"
              aria-label="Search commands"
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            ref={listRef}
            data-testid="command-palette-list"
            data-empty={flat.length === 0 ? 'true' : 'false'}
            // Hide the scrollbar chrome on every engine while keeping the
            // surface scrollable: Firefox honors `scrollbar-width: none`,
            // WebKit/Blink need the `::-webkit-scrollbar { display: none }`
            // rule below. The list still scrolls with wheel + keyboard.
            className={cn(
              'max-h-[50vh] overflow-y-auto',
              flat.length > 0 ? 'py-1' : '',
              'seeflow-no-scrollbar',
            )}
          >
            {flat.length === 0 ? (
              hasQuery ? (
                <div
                  data-testid="command-palette-empty"
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  No commands match "{query}"
                </div>
              ) : null
            ) : (
              (() => {
                let runningIndex = -1;
                return groups.map((group) => (
                  <div key={group.category} className="py-1">
                    <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {group.category}
                    </div>
                    {group.rows.map((row) => {
                      runningIndex += 1;
                      const index = runningIndex;
                      const isHighlighted = index === highlightedIndex;
                      return (
                        <button
                          key={row.cmd.id}
                          type="button"
                          data-testid={`command-palette-row-${row.cmd.id}`}
                          data-command-row-index={index}
                          data-highlighted={isHighlighted ? 'true' : 'false'}
                          aria-disabled={row.enabled ? undefined : true}
                          disabled={!row.enabled}
                          onMouseEnter={() => {
                            if (row.enabled) setHighlightedIndex(index);
                          }}
                          onClick={() => executeAt(index)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm outline-none',
                            row.enabled
                              ? 'cursor-pointer text-foreground hover:bg-muted'
                              : 'cursor-not-allowed text-muted-foreground/50',
                            isHighlighted && row.enabled ? 'bg-muted' : '',
                          )}
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{row.cmd.label}</span>
                            {row.cmd.description ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {row.cmd.description}
                              </span>
                            ) : null}
                          </div>
                          {row.cmd.shortcut ? (
                            <kbd
                              data-testid={`command-palette-shortcut-${row.cmd.id}`}
                              className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                            >
                              {row.cmd.shortcut}
                            </kbd>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

import { Ban, Download } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { CanvasStudioContext } from '../lib/canvas-studio-context.tsx';
import { cn } from '../lib/cn.ts';
import { type IconVendor, formatIconId } from '../lib/icon-id.ts';
import { getRecents } from '../lib/icon-recents.ts';
import { ICON_NAMES_BY_VENDOR, ICON_REGISTRY } from '../lib/icon-registry.ts';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { IconRenderer } from './icon-renderer.tsx';

// Layout constants. Tile is h-7 w-7 (28px); rows are tile + 4px gap = 32px.
// LIST_HEIGHT * COLS keeps the all-icons grid roughly square in the popover.
const COLS = 8;
const ROW_HEIGHT = 32;
const LIST_HEIGHT = 256;
const OVERSCAN = 2;

// Tab bar entries — matches the IconVendor union but ordered for the picker UI
// (bundled first, vendor packs middle, iconify last). `lucide` and `iconify`
// are always enabled; `aws`/`gcp`/`azure` flip to a disabled+Install state
// when the corresponding entry in ICON_NAMES_BY_VENDOR is empty.
const TAB_DEFS: ReadonlyArray<{ id: IconVendor; label: string }> = [
  { id: 'lucide', label: 'Bundled' },
  { id: 'aws', label: 'AWS' },
  { id: 'gcp', label: 'GCP' },
  { id: 'azure', label: 'Azure' },
  { id: 'iconify', label: 'Logos' },
];

const PACK_VENDORS: ReadonlyArray<IconVendor> = ['aws', 'gcp', 'azure'];

export function filterIcons(names: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return names.slice();
  return names.filter((name) => name.toLowerCase().includes(q));
}

export interface IconPickerPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: ReactNode;
  // `null` is emitted by the synthetic "No icon" tile when `clearable` is on
  // — consumers pass `null` through to clear the icon field on the underlying
  // node. When `clearable` is off (insert-icon-node use case) the tile is
  // hidden and only real names can be picked, so consumers may narrow the
  // handler to `(name: string) => void` if they prefer.
  onPick: (name: string | null) => void;
  // Whether the picker shows the synthetic "No icon" tile in the All-icons
  // grid. Defaults to `true` — turn off when the picker is used to insert a
  // new node (where "no icon" is meaningless).
  clearable?: boolean;
  // Invoked when the user clicks an "Install" affordance on a disabled vendor
  // tab or the empty-state CTA. US-017 wires this to the Browse Packs panel.
  onBrowsePacks?: () => void;
}

export function IconPickerPopover({
  open,
  onOpenChange,
  anchor,
  onPick,
  clearable = true,
  onBrowsePacks,
}: IconPickerPopoverProps) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<IconVendor>('lucide');
  const { studioBaseUrl } = useContext(CanvasStudioContext);
  // Recents are read at open time so a same-session push elsewhere becomes
  // visible the next time the picker opens. We deliberately do NOT subscribe
  // to storage events — the picker is short-lived and this keeps it simple.
  const recents = useMemo(() => (open ? getRecents() : []), [open]);

  // Reset the search field + tab on close so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveTab('lucide');
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="sf:w-[340px] sf:p-0"
        data-testid="icon-picker-popover"
      >
        <IconPickerBody
          query={query}
          onQueryChange={setQuery}
          recents={recents}
          onPick={onPick}
          clearable={clearable}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onBrowsePacks={onBrowsePacks}
          studioBaseUrl={studioBaseUrl}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface IconPickerBodyProps {
  query: string;
  onQueryChange: (q: string) => void;
  recents: string[];
  onPick: (name: string | null) => void;
  // See IconPickerPopoverProps.clearable. Defaults to `true`.
  clearable?: boolean;
  // Active vendor tab. Defaults to 'lucide' when omitted (back-compat for
  // tests that exercise the bundled-only path).
  activeTab?: IconVendor;
  onActiveTabChange?: (tab: IconVendor) => void;
  // Browse Packs CTA passthrough — see IconPickerPopoverProps.
  onBrowsePacks?: () => void;
  // Threaded by IconPickerPopover from CanvasStudioContext. Tests can omit
  // (default '') because vendor tiles only need it for the SVG URL.
  studioBaseUrl?: string;
}

// Body is exported so unit tests can render it without standing up the Radix
// Popover (which needs a real DOM + portal). The wrapper is a thin shell —
// all picker behavior lives here.
export function IconPickerBody({
  query,
  onQueryChange,
  recents,
  onPick,
  clearable = true,
  activeTab = 'lucide',
  onActiveTabChange,
  onBrowsePacks,
  studioBaseUrl = '',
}: IconPickerBodyProps) {
  const vendorNames = ICON_NAMES_BY_VENDOR[activeTab];
  const isPackVendor = (PACK_VENDORS as readonly string[]).includes(activeTab);
  const packInstalled = !isPackVendor || vendorNames.length > 0;

  const filtered = useMemo(() => filterIcons(vendorNames, query), [vendorNames, query]);
  const showRecents = activeTab === 'lucide' && query.trim() === '' && recents.length > 0;
  // The synthetic "No icon" tile sits above the virtualized grid and only
  // appears when (a) the picker is in a clearable context (editing an icon
  // field, not inserting a new node), (b) the user hasn't started searching,
  // AND (c) the active tab is `lucide` — vendor tabs never expose it (the
  // grid is the only authoritative source there).
  const showNoIconTile = clearable && query.trim() === '' && activeTab === 'lucide';

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
    <div className="sf:flex sf:w-full sf:flex-col">
      <div
        className="sf:flex sf:items-center sf:gap-1 sf:border-b sf:border-border sf:p-1"
        data-testid="icon-picker-tabs"
        role="tablist"
        aria-label="Icon source"
      >
        {TAB_DEFS.map((tab) =>
          renderTabButton({
            tab,
            active: tab.id === activeTab,
            installed:
              !(PACK_VENDORS as readonly string[]).includes(tab.id) ||
              ICON_NAMES_BY_VENDOR[tab.id].length > 0,
            onSelect: () => onActiveTabChange?.(tab.id),
            onInstall: onBrowsePacks,
          }),
        )}
      </div>

      <div className="sf:border-b sf:border-border sf:p-2">
        <input
          type="text"
          value={query}
          placeholder="Search icons…"
          aria-label="Search icons"
          data-testid="icon-picker-search"
          className={cn(
            'sf:flex sf:h-8 sf:w-full sf:rounded-md sf:border sf:border-input sf:bg-background sf:px-3 sf:text-sm',
            'placeholder:text-muted-foreground',
            'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
          )}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
        />
      </div>

      {showRecents ? (
        <div className="sf:border-b sf:border-border sf:p-2" data-testid="icon-picker-recents">
          <div className="sf:mb-1 sf:px-1 sf:text-[11px] sf:font-medium sf:uppercase sf:tracking-wide sf:text-muted-foreground">
            Recent
          </div>
          <div
            className="sf:grid sf:gap-1"
            style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
          >
            {recents.map((name) => renderTile(name, onPick, `icon-picker-recent-${name}`))}
          </div>
        </div>
      ) : null}

      <div className="sf:p-2">
        <div className="sf:mb-1 sf:px-1 sf:text-[11px] sf:font-medium sf:uppercase sf:tracking-wide sf:text-muted-foreground">
          All icons
        </div>
        {showNoIconTile ? (
          <div
            className="sf:mb-1 sf:grid sf:gap-1"
            style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
          >
            {renderNoIconTile(onPick)}
          </div>
        ) : null}
        {!packInstalled ? (
          renderInstallPrompt(activeTab, onBrowsePacks)
        ) : filtered.length === 0 ? (
          <div
            className="sf:flex sf:items-center sf:justify-center sf:text-xs sf:text-muted-foreground"
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
                  className="sf:grid sf:gap-1"
                  style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
                >
                  {visible.map((name) =>
                    renderVendorTile({
                      vendor: activeTab,
                      name,
                      studioBaseUrl,
                      onPick,
                    }),
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TabButtonArgs {
  tab: { id: IconVendor; label: string };
  active: boolean;
  installed: boolean;
  onSelect: () => void;
  onInstall: (() => void) | undefined;
}

// Plain `<button>` (not the Radix Tabs primitive) so the dispatcher-shim test
// pattern picks up the tabs alongside the icon tiles via the same
// `findAll(tree, el => el.type === 'button')` walk. The install affordance
// for uninstalled vendor packs is a SIBLING button (not nested) — nested
// interactive elements break HTML semantics and biome's a11y check.
function renderTabButton({
  tab,
  active,
  installed,
  onSelect,
  onInstall,
}: TabButtonArgs): ReactNode {
  const select = (
    <button
      key={`icon-picker-tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`icon-picker-tab-${tab.id}`}
      data-active={active ? 'true' : 'false'}
      data-installed={installed ? 'true' : 'false'}
      onClick={onSelect}
      className={cn(
        'sf:inline-flex sf:items-center sf:gap-1 sf:rounded-sm sf:px-2 sf:py-1 sf:text-xs sf:font-medium sf:transition-colors',
        'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
        active
          ? 'sf:bg-accent sf:text-accent-foreground'
          : 'sf:text-muted-foreground sf:hover:bg-accent/50 sf:hover:text-accent-foreground',
        !installed && 'sf:opacity-60',
      )}
    >
      {tab.label}
    </button>
  );
  if (installed) return select;
  const install = (
    <button
      key={`icon-picker-tab-install-${tab.id}`}
      type="button"
      aria-label={`Install ${tab.label} pack`}
      data-testid={`icon-picker-tab-install-${tab.id}`}
      onClick={() => onInstall?.()}
      className={cn(
        'sf:inline-flex sf:items-center sf:rounded-sm sf:px-1 sf:py-1 sf:text-primary sf:transition-colors',
        'sf:hover:bg-accent sf:hover:text-accent-foreground',
        'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
      )}
    >
      <Download className="sf:h-3 sf:w-3" aria-hidden="true" />
    </button>
  );
  return (
    <span key={`icon-picker-tab-wrap-${tab.id}`} className="sf:inline-flex sf:items-center">
      {select}
      {install}
    </span>
  );
}

function renderInstallPrompt(
  vendor: IconVendor,
  onBrowsePacks: (() => void) | undefined,
): ReactNode {
  return (
    <div
      data-testid="icon-picker-install-prompt"
      className="sf:flex sf:flex-col sf:items-center sf:justify-center sf:gap-2 sf:px-3 sf:text-center sf:text-xs sf:text-muted-foreground"
      style={{ height: LIST_HEIGHT }}
    >
      <Download className="sf:h-5 sf:w-5" aria-hidden="true" />
      <div>This pack isn't installed yet.</div>
      <button
        type="button"
        data-testid={`icon-picker-install-cta-${vendor}`}
        onClick={() => onBrowsePacks?.()}
        className={cn(
          'sf:inline-flex sf:items-center sf:gap-1 sf:rounded-md sf:bg-primary sf:px-3 sf:py-1 sf:text-xs sf:font-medium sf:text-primary-foreground',
          'sf:hover:bg-primary/90',
          'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
        )}
      >
        Browse packs
      </button>
    </div>
  );
}

interface VendorTileArgs {
  vendor: IconVendor;
  name: string;
  studioBaseUrl: string;
  onPick: (name: string | null) => void;
}

// Builds the wire-format iconId for a per-vendor name. `lucide` stays
// unprefixed (back-compat: existing flows store plain Lucide names). All
// other vendors use `formatIconId({vendor, name})` which prefixes with the
// vendor segment — `aws:lambda`, `iconify:logos:aws`, etc.
function toFullIconId(vendor: IconVendor, name: string): string {
  if (vendor === 'lucide') return name;
  return formatIconId({ vendor, name });
}

function renderVendorTile({ vendor, name, studioBaseUrl, onPick }: VendorTileArgs): ReactNode {
  if (vendor === 'lucide') {
    return renderTile(name, onPick, `icon-picker-tile-${name}`);
  }
  const fullId = toFullIconId(vendor, name);
  const testId = `icon-picker-tile-${vendor}-${name.replace(/:/g, '-')}`;
  return (
    <button
      key={testId}
      type="button"
      title={fullId}
      aria-label={fullId}
      data-testid={testId}
      data-icon-name={fullId}
      onClick={() => onPick(fullId)}
      className={cn(
        'sf:inline-flex sf:h-7 sf:w-7 sf:items-center sf:justify-center sf:rounded-md sf:text-muted-foreground sf:transition-colors',
        'sf:hover:bg-accent sf:hover:text-accent-foreground',
        'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
      )}
    >
      <IconRenderer
        iconId={fullId}
        studioBaseUrl={studioBaseUrl}
        className="sf:h-4 sf:w-4"
        ariaLabel={fullId}
      />
    </button>
  );
}

// Inline tile renderer (a function, not a component) so the rendered tree
// resolves to a plain <button> placeholder when IconPickerBody is called as
// a function in the apps/web hook-shim test pattern.
function renderTile(name: string, onPick: (name: string | null) => void, testId: string) {
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
        'sf:inline-flex sf:h-7 sf:w-7 sf:items-center sf:justify-center sf:rounded-md sf:text-muted-foreground sf:transition-colors',
        'sf:hover:bg-accent sf:hover:text-accent-foreground',
        'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
      )}
    >
      {Icon ? <Icon className="sf:h-4 sf:w-4" aria-hidden="true" /> : null}
    </button>
  );
}

// Synthetic "No icon" tile. Emits `null` so the picker can be used to clear
// the icon field as well as set it — replaces the old standalone Clear button.
function renderNoIconTile(onPick: (name: string | null) => void) {
  return (
    <button
      key="icon-picker-tile-none"
      type="button"
      title="No icon"
      aria-label="No icon"
      data-testid="icon-picker-tile-none"
      onClick={() => onPick(null)}
      className={cn(
        'sf:inline-flex sf:h-7 sf:w-7 sf:items-center sf:justify-center sf:rounded-md sf:text-muted-foreground sf:transition-colors',
        'sf:hover:bg-accent sf:hover:text-accent-foreground',
        'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
      )}
    >
      <Ban className="sf:h-4 sf:w-4" aria-hidden="true" />
    </button>
  );
}

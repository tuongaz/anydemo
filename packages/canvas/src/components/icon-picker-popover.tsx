import { Ban, Download, Plus } from 'lucide-react';
import {
  type ChangeEvent,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  CanvasIconsAdapter,
  IconPackVendor,
  InstallEvent,
  PackSummary,
} from '../adapter/types.ts';
import { CanvasStudioContext } from '../lib/canvas-studio-context.tsx';
import { cn } from '../lib/cn.ts';
import { type IconVendor, formatIconId, parseIconId } from '../lib/icon-id.ts';
import { getRecents } from '../lib/icon-recents.ts';
import { ICON_NAMES_BY_VENDOR, ICON_REGISTRY, applyPackSummaries } from '../lib/icon-registry.ts';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { BrowsePacksPanel } from './browse-packs-panel.tsx';
import { IconRenderer } from './icon-renderer.tsx';
import { InstallPackModal } from './install-pack-modal.tsx';
import { InstallProgressToast } from './install-progress-toast.tsx';

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
  // Caller-owned fallback. Fired only when `iconsAdapter` is not provided. The
  // host may use this to open its own Browse Packs UI. When `iconsAdapter` is
  // provided the popover manages the Browse / Install flow internally and
  // ignores this prop.
  onBrowsePacks?: () => void;
  /**
   * US-017: Icons-adapter handle for the Browse Packs flow. When provided
   * the picker:
   *   - shows a "Browse packs" footer button
   *   - swaps the popover content to <BrowsePacksPanel> when the user clicks
   *     either the footer button or an "Install" affordance on a disabled
   *     vendor tab
   *   - opens <InstallPackModal> on Install, then runs the install through
   *     adapter.icons.install + subscribeJob
   *   - on a `done` event, re-fetches listPacks() and feeds them into
   *     applyPackSummaries() so the picker's vendor tabs populate live
   * When omitted, no Browse Packs UI is shown and the only handle is the
   * existing `onBrowsePacks` fallback.
   */
  iconsAdapter?: CanvasIconsAdapter;
}

interface ModalState {
  vendor: IconPackVendor;
  licenseSummary: string;
  licenseUrl: string;
  requiresAcceptance: boolean;
}

interface JobState {
  vendor: IconPackVendor;
  event: InstallEvent | null;
  /** Tracks the `acceptTerms` value used to kick off this job, so Retry can resubmit. */
  acceptTerms: boolean;
}

// Append-only state slots (per packages/canvas/CLAUDE.md hook-shim rule):
//   1. query
//   2. activeTab
//   3. view              — picker | browse (US-017)
//   4. modalState        — InstallPackModal payload | null (US-017)
//   5. jobState          — install progress { vendor, event, acceptTerms } | null (US-017)
//   6. packs             — local PackSummary[] for the Browse panel (US-017)
//   7. busyVendor        — vendor with install/remove in flight (US-017)
export function IconPickerPopover({
  open,
  onOpenChange,
  anchor,
  onPick,
  clearable = true,
  onBrowsePacks,
  iconsAdapter,
}: IconPickerPopoverProps) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<IconVendor>('lucide');
  const [view, setView] = useState<'picker' | 'browse'>('picker');
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [packs, setPacks] = useState<ReadonlyArray<PackSummary>>([]);
  const [busyVendor, setBusyVendor] = useState<IconPackVendor | null>(null);
  const { studioBaseUrl } = useContext(CanvasStudioContext);
  // Recents are read at open time so a same-session push elsewhere becomes
  // visible the next time the picker opens. We deliberately do NOT subscribe
  // to storage events — the picker is short-lived and this keeps it simple.
  const recents = useMemo(() => (open ? getRecents() : []), [open]);

  // Holds the subscribeJob unsubscribe handle for the currently-tracked job.
  // Replaced on every new install; cleared when the toast is dismissed.
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Reset transient UI on close — but DON'T tear down the install job, so the
  // user can reopen the picker and still see the running toast.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveTab('lucide');
      setView('picker');
    }
  }, [open]);

  // Refresh pack summaries whenever the user enters the Browse view (or the
  // adapter swaps under us). Silent on adapter failures.
  useEffect(() => {
    if (view !== 'browse' || !iconsAdapter) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await iconsAdapter.listPacks();
        if (!cancelled) setPacks(next);
      } catch {
        // Silent — the panel renders the previous snapshot.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, iconsAdapter]);

  // Clean up the install subscription if the picker unmounts mid-install.
  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  const browseHandler = iconsAdapter ? () => setView('browse') : onBrowsePacks;

  async function startInstall(vendor: IconPackVendor): Promise<void> {
    if (!iconsAdapter) return;
    try {
      const license = await iconsAdapter.getLicense(vendor);
      setModalState({
        vendor,
        licenseSummary: license.summary,
        licenseUrl: license.url,
        requiresAcceptance: license.requiresAcceptance,
      });
    } catch {
      // Silent — without a license, surface a generic toast.
      setJobState({
        vendor,
        event: { type: 'error', vendor, message: 'Failed to load license details' },
        acceptTerms: false,
      });
    }
  }

  async function runInstall(vendor: IconPackVendor, acceptTerms: boolean): Promise<void> {
    if (!iconsAdapter) return;
    // Tear down any previous job's subscription before kicking off a new one.
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setBusyVendor(vendor);
    setJobState({ vendor, event: null, acceptTerms });
    try {
      const { jobId } = await iconsAdapter.install(vendor, { acceptTerms });
      const unsub = iconsAdapter.subscribeJob(jobId, (ev) => {
        setJobState({ vendor, event: ev, acceptTerms });
        if (ev.type === 'done') {
          setBusyVendor(null);
          // Refresh local + global pack summaries so the picker's vendor tabs
          // pick up the new icons immediately.
          void iconsAdapter
            .listPacks()
            .then((next) => {
              setPacks(next);
              applyPackSummaries(next);
            })
            .catch(() => undefined);
        } else if (ev.type === 'error') {
          setBusyVendor(null);
        }
      });
      unsubscribeRef.current = unsub;
    } catch (err) {
      setBusyVendor(null);
      const message = err instanceof Error ? err.message : 'Install failed';
      setJobState({
        vendor,
        event: { type: 'error', vendor, message },
        acceptTerms,
      });
    }
  }

  async function handleRemove(vendor: IconPackVendor): Promise<void> {
    if (!iconsAdapter) return;
    setBusyVendor(vendor);
    try {
      await iconsAdapter.remove(vendor);
      const next = await iconsAdapter.listPacks();
      setPacks(next);
      applyPackSummaries(next);
    } catch {
      // Silent — Browse panel will simply not update.
    } finally {
      setBusyVendor(null);
    }
  }

  function handleConfirm({ acceptTerms }: { acceptTerms: boolean }): void {
    const vendor = modalState?.vendor;
    setModalState(null);
    if (vendor) void runInstall(vendor, acceptTerms);
  }

  function handleRetry(): void {
    const job = jobState;
    if (!job) return;
    void runInstall(job.vendor, job.acceptTerms);
  }

  function handleToastClose(): void {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setJobState(null);
  }

  return (
    <Fragment>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{anchor}</PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="sf:w-[340px] sf:p-0"
          data-testid="icon-picker-popover"
        >
          {view === 'browse' && iconsAdapter ? (
            <div data-testid="icon-picker-browse" className="sf:flex sf:flex-col">
              <BrowsePacksPanel
                packs={packs}
                onInstall={(v) => void startInstall(v)}
                onRemove={(v) => void handleRemove(v)}
                busyVendor={busyVendor}
              />
              <div className="sf:flex sf:justify-end sf:border-t sf:border-border sf:p-2">
                <button
                  type="button"
                  data-testid="icon-picker-browse-back"
                  onClick={() => setView('picker')}
                  className={cn(
                    'sf:inline-flex sf:items-center sf:gap-1 sf:rounded-md sf:px-3 sf:py-1 sf:text-xs sf:font-medium sf:text-muted-foreground sf:transition-colors',
                    'sf:hover:bg-accent sf:hover:text-accent-foreground',
                    'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
                  )}
                >
                  Back to icons
                </button>
              </div>
            </div>
          ) : (
            <IconPickerBody
              query={query}
              onQueryChange={setQuery}
              recents={recents}
              onPick={onPick}
              clearable={clearable}
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
              onBrowsePacks={browseHandler}
              showBrowseTab={iconsAdapter !== undefined}
              studioBaseUrl={studioBaseUrl}
            />
          )}
        </PopoverContent>
      </Popover>
      {modalState ? (
        <InstallPackModal
          open={true}
          onOpenChange={(next) => {
            if (!next) setModalState(null);
          }}
          vendor={modalState.vendor}
          licenseSummary={modalState.licenseSummary}
          licenseUrl={modalState.licenseUrl}
          requiresAcceptance={modalState.requiresAcceptance}
          onConfirm={handleConfirm}
          onCancel={() => setModalState(null)}
        />
      ) : null}
      {jobState && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-testid="icon-picker-install-toast-host"
              className="sf:fixed sf:bottom-4 sf:right-4 sf:z-50 sf:w-[320px]"
            >
              <InstallProgressToast
                vendor={jobState.vendor}
                event={jobState.event}
                onRetry={handleRetry}
                onClose={handleToastClose}
              />
            </div>,
            document.body,
          )
        : null}
    </Fragment>
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
  /**
   * Render the `+` icon-only Browse-packs button at the end of the tab bar.
   * The popover toggles this on when an `iconsAdapter` is wired so the
   * picker itself drives the install flow. Defaults to `false` — callers
   * that exercise only the bundled icons see no Browse button.
   */
  showBrowseTab?: boolean;
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
  showBrowseTab = false,
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
        {TAB_DEFS.filter(
          (tab) =>
            !(PACK_VENDORS as readonly string[]).includes(tab.id) ||
            ICON_NAMES_BY_VENDOR[tab.id].length > 0,
        ).map((tab) =>
          renderTabButton({
            tab,
            active: tab.id === activeTab,
            onSelect: () => onActiveTabChange?.(tab.id),
          }),
        )}
        {showBrowseTab && onBrowsePacks ? (
          <button
            key="icon-picker-tab-browse"
            type="button"
            aria-label="Browse packs"
            data-testid="icon-picker-tab-browse"
            onClick={() => onBrowsePacks()}
            className={cn(
              'sf:inline-flex sf:items-center sf:gap-1 sf:rounded-sm sf:px-2 sf:py-1 sf:text-xs sf:font-medium sf:text-muted-foreground sf:transition-colors',
              'sf:hover:bg-accent/50 sf:hover:text-accent-foreground',
              'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
            )}
          >
            <Plus className="sf:h-3 sf:w-3" aria-hidden="true" />
          </button>
        ) : null}
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
            {recents.map((id) => {
              const parsed = parseIconId(id);
              if (!parsed) return null;
              return renderVendorTile({
                vendor: parsed.vendor,
                name: parsed.name,
                studioBaseUrl,
                onPick,
              });
            })}
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
  onSelect: () => void;
}

// Plain `<button>` (not the Radix Tabs primitive) so the dispatcher-shim test
// pattern picks up the tabs alongside the icon tiles via the same
// `findAll(tree, el => el.type === 'button')` walk. Pack-vendor tabs are
// filtered out at the call site when not installed, so this only ever
// renders the active "installed" branch.
function renderTabButton({ tab, active, onSelect }: TabButtonArgs): ReactNode {
  return (
    <button
      key={`icon-picker-tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`icon-picker-tab-${tab.id}`}
      data-active={active ? 'true' : 'false'}
      onClick={onSelect}
      className={cn(
        'sf:inline-flex sf:items-center sf:gap-1 sf:rounded-sm sf:px-2 sf:py-1 sf:text-xs sf:font-medium sf:transition-colors',
        'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
        active
          ? 'sf:bg-accent sf:text-accent-foreground'
          : 'sf:text-muted-foreground sf:hover:bg-accent/50 sf:hover:text-accent-foreground',
      )}
    >
      {tab.label}
    </button>
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

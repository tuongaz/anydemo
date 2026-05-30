import { FolderOpen, ImagePlus, PencilLine, X } from 'lucide-react';
import {
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CanvasAdapter } from '../adapter/types.ts';
import { cn } from '../lib/cn.ts';
import {
  getStoredDetailPanelWidth,
  setStoredDetailPanelWidth,
  startResizeGesture,
} from '../lib/detail-panel-width.ts';
import { StatusBadge } from '../nodes/status-badge.tsx';
import type { Connector, FlowNode, StatusReport } from '../types.ts';
import { Button } from '../ui/button.tsx';
import { Icon } from '../ui/icon.tsx';
import { IconPickerPopover } from './icon-picker-popover.tsx';
import { MermaidBlock } from './mermaid-block.tsx';

// Local alias to keep the title-row JSX tidy. The trigger always renders as a
// small popover anchor, regardless of whether the node has an icon set yet.
type IconChangeHandler = (nodeId: string, icon: string | null) => void;

export interface DetailPanelProps {
  flowId: string | null;
  node: FlowNode | null;
  connector: Connector | null;
  /**
   * Optional canvas adapter used for project-scoped file actions on type:'html'
   * details (Open in editor / Reveal in OS file manager). When omitted or when
   * a method (`openFile` / `revealFile`) is undefined, the corresponding
   * button is hidden so embedders without filesystem support don't render
   * dead affordances.
   */
  adapter?: CanvasAdapter | null;
  // Three-field consolidation: name (header), description (light-bold body),
  // detail (long-form body). All three share the same single-click → edit,
  // blur → save UX via EditableField. When a callback is omitted the field
  // renders read-only. Empty string clears the field on disk.
  onNameChange?: (nodeId: string, name: string) => void;
  onDescriptionChange?: (nodeId: string, value: string) => void;
  onDetailChange?: (nodeId: string, value: string) => void;
  /**
   * US-008: persist a new icon name (or clear it via `null`) from the
   * DetailPanel's Icon row. The row only renders for type:'rectangle'
   * selections (the one renderer that draws a header icon under the flat
   * schema's Renderer phasing); when this callback is undefined the row is
   * hidden (mirroring the read-only gate used by onNameChange /
   * onDescriptionChange).
   */
  onIconChange?: (nodeId: string, icon: string | null) => void;
  /**
   * US-007: latest StatusReport for the selected node, when one exists in the
   * hook's `statusByNode` map. Renders the Status section above the editable
   * fields. Undefined → section is hidden so a node with no statusAction looks
   * identical to before.
   */
  statusReport?: StatusReport & { ts: number };
  /**
   * Controlled visibility. Parent (SeeflowCanvas) keeps DetailPanel mounted
   * while the sidebar feature is enabled and toggles `open` to drive the
   * Radix Sheet's slide-in / slide-out animation. Mounting-and-unmounting
   * the component would cut the exit animation off because Radix needs to
   * stay in the tree long enough for `data-[state=closed]:animate-out` to
   * run before SheetContent unmounts. Defaults to `true` so the long tail
   * of existing component-level tests that don't care about visibility
   * keep working without ceremony.
   */
  open?: boolean;
  onClose: () => void;
}

export function DetailPanel({
  flowId,
  node,
  connector,
  adapter,
  onNameChange,
  onDescriptionChange,
  onDetailChange,
  onIconChange,
  statusReport,
  open = true,
  onClose,
}: DetailPanelProps) {
  // Text nodes are pure on-canvas labels — the sidebar would only duplicate
  // the inline-edited text and offer no extra fields, so the panel stays
  // closed for them. Clicking a text node still selects it on the canvas;
  // double-click still opens inline edit.
  const isTextNode = node?.type === 'text';
  // Ellipse + sticky nodes have no Name concept — their on-canvas label is
  // the `description` field, so the panel suppresses the Name row entirely.
  // The panel still opens to expose Description / Detail / style fields.
  const isDescriptionLabelShapeNode = node?.type === 'ellipse' || node?.type === 'sticky';
  const inspectableNode = isTextNode ? null : node;
  // `open` flows from the parent (sidebarOpen). The parent always renders
  // DetailPanel while the sidebar feature is enabled; this component handles
  // the slide-in / slide-out animation itself via a CSS width transition on
  // the outer aside (driven by `data-state=open|closed`). The inner content
  // div keeps its full intrinsic `width` so as the aside shrinks toward 0,
  // the canvas absorbs the freed space and the inner content gets clipped
  // by the aside's `overflow: hidden` — producing a clean wipe-from-right
  // effect without the layout jank you'd get from animating padding or
  // margin on a content-bearing element. Selection state only drives WHICH
  // inner branch renders (populated node, connector, or empty-state).
  const nodeName =
    inspectableNode && 'name' in inspectableNode.data ? (inspectableNode.data.name ?? '') : '';
  const description = inspectableNode?.data.description ?? '';
  const detail = inspectableNode?.data.detail ?? '';
  const showNameField = inspectableNode !== null && !isDescriptionLabelShapeNode;
  // Icon trigger sits inline with the title (left of the name). It's
  // meaningful for type:'rectangle' and type:'component' — the renderers
  // that draw a header icon next to the name under the flat schema's
  // Renderer phasing (other geometric variants parse + persist `icon`
  // but don't surface it).
  const supportsIconField =
    inspectableNode !== null &&
    (inspectableNode.type === 'rectangle' || inspectableNode.type === 'component');
  const showIconField = supportsIconField && typeof onIconChange === 'function';
  // currentIcon is decoupled from showIconField so the read-only fallback
  // below can render the same icon the node body shows when the canvas is in
  // view mode (no onIconChange callback wired).
  const currentIcon =
    supportsIconField && inspectableNode && 'icon' in inspectableNode.data
      ? ((inspectableNode.data as { icon?: string }).icon ?? null)
      : null;

  // Panel width is user-resizable above the sm breakpoint via a left-edge
  // handle; persisted across sessions in localStorage.
  const [width, setWidth] = useState<number>(() => getStoredDetailPanelWidth());
  const onResizeHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startResizeGesture(width, e.clientX, {
      onWidth: setWidth,
      onCommit: setStoredDetailPanelWidth,
    });
  };

  // Escape closes the panel — except while an editable field is in edit mode,
  // where Escape is reserved for the field's cancel-edit shortcut (its own
  // onKeyDown stops the keystroke from bubbling to window, so this listener
  // only sees Escape when no editor is focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute('data-testid')?.endsWith('-editor')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Outer aside: animates width 0 ↔ `width` and border-left 0 ↔ var to push
  // / yield canvas space smoothly. overflow-hidden clips the fixed-width
  // inner content as the aside shrinks during a close. Border + shadow are
  // themed via CSS vars on `.seeflow-canvas-root` so the panel reads
  // no-border + subtle shadow in light and a hairline + heavier shadow in
  // dark. Below the sm breakpoint the panel still falls back to full width
  // via the responsive style merge on the inner.
  const asideStyle = {
    width: open ? width : 0,
    borderLeftWidth: open ? 'var(--detail-panel-border-left)' : 0,
    transition: 'width 220ms ease-out, border-left-width 220ms ease-out',
  } as CSSProperties;
  // Inner content keeps its full intrinsic width so the layout inside the
  // aside doesn't reflow during the slide; only the aside's visible width
  // changes. boxShadow lives on the inner so it doesn't bleed across the
  // canvas while the aside is closed.
  const innerStyle = {
    width,
    boxShadow: 'var(--detail-panel-shadow)',
  } as CSSProperties;

  return (
    <aside
      aria-label="Inspector"
      data-testid="detail-panel"
      data-state={open ? 'open' : 'closed'}
      style={asideStyle}
      className="sf:relative sf:flex sf:h-full sf:flex-shrink-0 sf:flex-col sf:overflow-hidden sf:border-border"
    >
      <div
        style={innerStyle}
        className="sf:relative sf:flex sf:h-full sf:flex-shrink-0 sf:flex-col sf:overflow-y-auto sf:bg-card/94 sf:p-6 sf:backdrop-blur-[14px]"
      >
        <div
          aria-label="Resize detail panel"
          onPointerDown={onResizeHandlePointerDown}
          data-testid="detail-panel-resize-handle"
          className="sf:absolute sf:inset-y-0 sf:left-0 sf:z-10 sf:hidden sf:w-1.5 sf:cursor-col-resize sf:bg-transparent sf:transition-colors sf:hover:bg-border sf:sm:block"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          data-testid="detail-panel-close"
          className="sf:absolute sf:right-4 sf:top-4 sf:z-10 sf:inline-flex sf:h-7 sf:w-7 sf:items-center sf:justify-center sf:rounded-sm sf:text-foreground/70 sf:opacity-70 sf:transition-opacity sf:hover:opacity-100 sf:focus:outline-hidden sf:focus:ring-2 sf:focus:ring-ring sf:focus:ring-offset-2"
        >
          <X className="sf:h-4 sf:w-4" />
          <span className="sf:sr-only">Close</span>
        </button>
      {inspectableNode ? (
        <div className="sf:flex sf:flex-col sf:gap-4">
          <div className="sf:-mx-6 sf:-mt-6 sf:flex sf:flex-col sf:border-b sf:border-border/60 sf:bg-card/60 sf:px-6 sf:pb-2.5 sf:pt-3 sf:pr-12">
            {showNameField ? (
              <h2
                data-testid="detail-panel-title"
                className="sf:text-lg sf:font-semibold sf:text-foreground"
              >
                <div className="sf:flex sf:items-center sf:gap-2">
                  {showIconField && onIconChange ? (
                    <TitleIconTrigger
                      nodeId={inspectableNode.id}
                      icon={currentIcon}
                      onChange={onIconChange}
                    />
                  ) : supportsIconField && currentIcon ? (
                    <span
                      data-testid="detail-panel-icon-readonly"
                      aria-hidden
                      className="sf:inline-flex sf:h-7 sf:w-7 sf:shrink-0 sf:items-center sf:justify-center sf:text-foreground/90"
                    >
                      <Icon name={currentIcon} size={16} />
                    </span>
                  ) : null}
                  <div className="sf:min-w-0 sf:flex-1">
                    <EditableField
                      nodeId={inspectableNode.id}
                      value={nodeName}
                      placeholder="Name"
                      multiline={false}
                      ariaLabel="Name"
                      testIdBase="detail-panel-name"
                      onSave={onNameChange}
                      textClassName="sf:text-lg sf:font-semibold sf:tracking-tight sf:text-foreground/95"
                    />
                  </div>
                </div>
              </h2>
            ) : (
              // Keep an sr-only title so screen readers still announce the
              // entity even when the visual name row is suppressed (ellipse,
              // sticky — their on-canvas label is the description field).
              <h2 data-testid="detail-panel-title" className="sf:sr-only">
                {inspectableNode.id}
              </h2>
            )}
            {/* Sr-only description so assistive tech still announces what
                kind of entity the panel describes without visual clutter. */}
            <p className="sf:sr-only">
              {inspectableNode.id} · {inspectableNode.type}
            </p>
          </div>

          <div className="sf:mt-0 sf:flex sf:flex-col sf:gap-3">
            {statusReport ? <StatusSection report={statusReport} /> : null}
            <EditableField
              nodeId={inspectableNode.id}
              value={description}
              placeholder="Short description shown on the node body"
              multiline={true}
              ariaLabel="Description"
              testIdBase="detail-panel-description"
              onSave={onDescriptionChange}
              // Description is the visual "subtitle" — rendered in the muted
              // gray token so it sits clearly below the (white-ish) Detail
              // block in dark mode and below the near-black Detail in light.
              // The explicit `dark:` override pins a slightly more saturated
              // gray than `--muted-foreground` so the contrast against
              // Detail's `text-foreground` holds even under reduced-contrast
              // settings.
              textClassName="sf:text-[13px] sf:leading-relaxed sf:text-muted-foreground sf:dark:text-zinc-400"
            />
            <EditableField
              nodeId={inspectableNode.id}
              value={detail}
              placeholder="Long-form notes, context, anything…"
              multiline={true}
              ariaLabel="Detail"
              testIdBase="detail-panel-detail"
              onSave={onDetailChange}
              markdown={true}
              textClassName="sf:text-sm sf:leading-relaxed sf:text-foreground"
            />

            {inspectableNode.type === 'html' && flowId ? (
              <HtmlNodeSection adapter={adapter} nodeId={inspectableNode.id} htmlPath="view.html" />
            ) : null}
          </div>
        </div>
      ) : connector ? (
        <div className="sf:flex sf:flex-col sf:gap-4">
          <div className="sf:-mx-6 sf:-mt-6 sf:flex sf:flex-col sf:border-b sf:border-border/60 sf:bg-card/60 sf:px-6 sf:pb-2.5 sf:pt-3 sf:pr-12">
            <h2
              data-testid="detail-panel-title"
              className="sf:text-lg sf:font-semibold sf:tracking-tight sf:text-foreground/95"
            >
              {connector.label ?? 'Connector'}
            </h2>
            <p className="sf:sr-only">{connector.id}</p>
          </div>

          <div className="sf:mt-0 sf:flex sf:flex-col sf:gap-3">
            <ConnectorSummary connector={connector} />
          </div>
        </div>
      ) : (
        <div data-testid="detail-panel-empty" className="sf:text-muted-foreground sf:text-sm">
          Select a node to inspect.
        </div>
      )}
      </div>
    </aside>
  );
}

// Click-to-edit + blur-saves field. No pencil affordance; the rendered text
// itself is the click target (cursor: text on hover). Single click enters
// edit mode; blur commits; Escape cancels. Enter commits when multiline is
// false, inserts a literal '\n' when true (Firefox parity via execCommand
// since it doesn't honor contentEditable='plaintext-only').
//
// WHY contentEditable + plaintext-only over <input>/<textarea>: the editor
// inherits the panel's typography (no jarring font swap on enter-edit) and
// the rendered/edit DOM stays nearly identical so the layout doesn't shift.
// The element is uncontrolled: textContent is seeded once on enter-edit and
// the browser owns the DOM until commit/cancel — React must not write
// children every keystroke or caret positioning fights the IME.
export function EditableField({
  nodeId,
  value,
  placeholder,
  multiline,
  ariaLabel,
  testIdBase,
  onSave,
  textClassName,
  markdown = false,
}: {
  nodeId: string;
  value: string;
  placeholder: string;
  multiline: boolean;
  ariaLabel: string;
  testIdBase: string;
  onSave?: (nodeId: string, value: string) => void;
  textClassName?: string;
  markdown?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  // Escape sets this so the imminent blur is a no-op cancel instead of a save.
  const cancelOnBlurRef = useRef(false);

  // Seed textContent imperatively on enter-edit, focus, place caret at end.
  // We seed via DOM (not JSX children) because contentEditable + React
  // children fights React's reconciliation.
  useEffect(() => {
    if (!isEditing) return;
    const el = editorRef.current;
    if (!el) return;
    el.textContent = value;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [isEditing, value]);

  const isEmpty = value === '';

  // Read-only: plain rendered text (or muted placeholder). No edit affordance.
  if (!onSave) {
    return (
      <div
        data-testid={testIdBase}
        aria-label={ariaLabel}
        className={cn(
          'sf:w-full sf:rounded-md sf:px-2 sf:py-1.5 sf:text-sm',
          isEmpty ? 'sf:italic sf:text-muted-foreground/50' : 'text-foreground',
          !markdown && 'sf:whitespace-pre-wrap sf:wrap-break-word',
          textClassName,
        )}
      >
        {isEmpty ? placeholder : markdown ? <MarkdownContent value={value} /> : value}
      </div>
    );
  }

  const commit = () => {
    const el = editorRef.current;
    // innerText resolves <br> and block boundaries to '\n'; textContent
    // ignores them. Use innerText for multiline so Enter-inserted newlines
    // round-trip; textContent for single-line keeps things simple.
    const text = el ? (multiline ? el.innerText : (el.textContent ?? '')) : value;
    onSave(nodeId, text);
    setIsEditing(false);
  };

  const cancel = () => {
    setIsEditing(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Stop the keystroke from bubbling to the canvas — Backspace/Delete on
    // the canvas would otherwise trigger node deletion. Cover the native side
    // too: window-level shortcuts listen for native events.
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      // Flag the imminent blur as a cancel so onBlur doesn't save the stale
      // textContent (commit() would otherwise persist whatever the user typed).
      cancelOnBlurRef.current = true;
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Shift+Enter always commits, even in multiline fields — gives the user
      // a keyboard escape hatch that mirrors blur.
      if (e.shiftKey || !multiline) {
        commit();
        return;
      }
      document.execCommand('insertText', false, '\n');
    }
  };

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    // plaintext-only forces paste-as-text on Chromium/Safari; Firefox needs
    // explicit preventDefault + insertText to strip rich-text formatting.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  // onInput is intentionally a no-op — we read via textContent at commit time
  // and never need a controlled mirror. Keeping the handler attached avoids
  // a React warning about contentEditable without onChange.
  const onInput = (_e: ReactFormEvent<HTMLDivElement>) => {};

  const onBlur = () => {
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false;
      return;
    }
    commit();
  };

  const enterEdit = () => {
    if (isEditing) return;
    setIsEditing(true);
  };

  return (
    <div className="relative" data-testid={testIdBase} data-editing={isEditing ? 'true' : 'false'}>
      {isEditing ? (
        <div
          ref={editorRef}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onInput={onInput}
          onBlur={onBlur}
          data-testid={`${testIdBase}-editor`}
          className={cn(
            // No ring on focus and no leading override — the edit surface
            // visually matches the rendered button surface exactly so toggling
            // edit mode doesn't shift the row's height. Caret + IME are the
            // only edit affordance.
            'sf:block sf:w-full sf:whitespace-pre-wrap sf:wrap-break-word sf:rounded-md sf:px-2 sf:py-1.5 sf:text-sm sf:outline-hidden',
            textClassName,
          )}
          role="textbox"
          aria-multiline={multiline ? 'true' : 'false'}
          aria-label={ariaLabel}
        />
      ) : (
        <button
          type="button"
          onClick={enterEdit}
          aria-label={`Edit ${ariaLabel.toLowerCase()}`}
          className={cn(
            'sf:block sf:w-full sf:cursor-text sf:rounded-md sf:px-2 sf:py-1.5 sf:text-left sf:text-sm sf:transition-colors sf:hover:bg-muted/50',
            isEmpty ? 'sf:italic sf:text-muted-foreground/50' : 'text-foreground',
            !markdown && 'sf:whitespace-pre-wrap sf:wrap-break-word',
            textClassName,
          )}
        >
          {isEmpty ? placeholder : markdown ? <MarkdownContent value={value} /> : value}
        </button>
      )}
    </div>
  );
}

// Title-row icon trigger. Sits inline with the node name in the SheetTitle and
// opens the IconPickerPopover. When the node has an icon set the trigger shows
// it; when unset, a faint dashed placeholder with an ImagePlus glyph signals
// "click to add". The picker's first tile emits `null` to clear, so a separate
// Clear button is no longer needed — both pick and remove flow through onPick.
// Render gating happens at the parent (DetailPanel) — this component assumes
// it's only mounted when an `onChange` is wired.
export function TitleIconTrigger({
  nodeId,
  icon,
  onChange,
}: {
  nodeId: string;
  icon: string | null;
  onChange: IconChangeHandler;
}) {
  const [open, setOpen] = useState(false);
  return (
    <IconPickerPopover
      open={open}
      onOpenChange={setOpen}
      onPick={(name) => {
        onChange(nodeId, name);
        setOpen(false);
      }}
      anchor={
        <button
          type="button"
          data-testid="detail-panel-icon-trigger"
          aria-label={icon ? 'Change icon' : 'Add icon'}
          aria-pressed={open}
          className={cn(
            'sf:inline-flex sf:h-7 sf:w-7 sf:shrink-0 sf:items-center sf:justify-center sf:rounded-md sf:text-foreground sf:transition-colors',
            icon
              ? 'sf:hover:bg-muted'
              : 'sf:border sf:border-dashed sf:border-muted-foreground/40 sf:text-muted-foreground/60 sf:hover:border-muted-foreground sf:hover:text-foreground',
            'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
          )}
        >
          {icon ? (
            <Icon name={icon} size={16} aria-hidden />
          ) : (
            <ImagePlus className="sf:h-4 sf:w-4" aria-hidden />
          )}
        </button>
      }
    />
  );
}

// type:'html' detail section — displays the node-relative html path (e.g.
// `view.html`, matching the `file://view.html` ref in flow.json) and provides
// Open-in-editor + Reveal-in-file-manager shellout buttons. Both route through
// the host-supplied `adapter.openFile` / `adapter.revealFile`. The studio's
// file routes expect seeflow-root-relative paths, so the adapter calls reattach
// the `nodes/<id>/` prefix internally. When either adapter method is undefined
// the corresponding button is hidden so embedders without filesystem support
// don't render dead affordances.
export function HtmlNodeSection({
  adapter,
  nodeId,
  htmlPath,
}: {
  adapter: CanvasAdapter | null | undefined;
  nodeId: string;
  htmlPath: string;
}) {
  const [status, setStatus] = useState<{
    kind: 'idle' | 'pending' | 'error';
    message?: string;
  }>({ kind: 'idle' });

  const canOpen = typeof adapter?.openFile === 'function';
  const canReveal = typeof adapter?.revealFile === 'function';
  const adapterPath = `nodes/${nodeId}/${htmlPath}`;

  const dispatch = async (action: 'open' | 'reveal') => {
    setStatus({ kind: 'pending' });
    try {
      if (action === 'open') {
        await adapter?.openFile?.(adapterPath);
      } else {
        await adapter?.revealFile?.(adapterPath);
      }
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className="sf:flex sf:flex-col sf:gap-2 sf:rounded-md sf:border sf:bg-card sf:px-3 sf:py-2 sf:text-xs"
      data-testid="detail-panel-html-node"
    >
      <div className="sf:flex sf:flex-col sf:gap-1">
        <span className="sf:font-mono sf:text-[11px] sf:text-muted-foreground sf:uppercase sf:tracking-widest">
          Path
        </span>
        <code
          data-testid="detail-panel-html-path"
          className="sf:block sf:break-all sf:rounded sf:bg-muted/40 sf:px-2 sf:py-1 sf:font-mono sf:text-[11px]"
        >
          {htmlPath}
        </code>
      </div>
      {canOpen || canReveal ? (
        <div className="sf:flex sf:flex-wrap sf:items-center sf:gap-2">
          {canOpen ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="sf:h-7 sf:gap-1.5 sf:px-2"
              onClick={() => {
                void dispatch('open');
              }}
              disabled={status.kind === 'pending'}
              data-testid="detail-panel-html-open"
              aria-label="Open in editor"
            >
              <PencilLine className="sf:h-3.5 sf:w-3.5" />
              Open in editor
            </Button>
          ) : null}
          {canReveal ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="sf:h-7 sf:gap-1.5 sf:px-2"
              onClick={() => {
                void dispatch('reveal');
              }}
              disabled={status.kind === 'pending'}
              data-testid="detail-panel-html-reveal"
              aria-label="Reveal in Finder/Explorer"
            >
              <FolderOpen className="sf:h-3.5 sf:w-3.5" />
              Reveal
            </Button>
          ) : null}
        </div>
      ) : null}
      {status.kind === 'error' ? (
        <div
          data-testid="detail-panel-html-status"
          data-status={status.kind}
          className={cn('sf:text-[11px] sf:text-destructive')}
        >
          {status.message ?? ''}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Format `ts` (ms epoch) as a coarse "Ns ago" / "Nm ago" / "Nh ago" string
 * relative to `now`. We don't need second-level precision — the section is a
 * heartbeat indicator, not a clock — so we floor each unit and clamp the
 * "just now" window to ≤1s to avoid showing "0s ago".
 */
export function formatRelativeTime(ts: number, now: number): string {
  const diffMs = Math.max(0, now - ts);
  if (diffMs < 1000) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Stringify a `data` value for display in the key/value table. Strings are
 * rendered as-is; everything else (numbers, booleans, arrays, nested objects)
 * goes through JSON.stringify so the user sees the structural value. `null`
 * and `undefined` get an explicit textual stand-in.
 */
function formatStatusValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function StatusSection({
  report,
  // Test seam: callers in tests can pin `now` so the relative-time string is
  // deterministic. Production renders ignore this and read Date.now() at the
  // call site so a re-render after an SSE tick recomputes the "Ns ago" label.
  now = Date.now(),
}: {
  report: StatusReport & { ts: number };
  now?: number;
}) {
  const entries = report.data ? Object.entries(report.data) : [];
  return (
    <section
      className="sf:flex sf:flex-col sf:gap-2 sf:rounded-md sf:border sf:bg-card sf:px-3 sf:py-2 sf:text-xs"
      data-testid="detail-panel-status"
      data-state={report.state}
    >
      <div className="sf:flex sf:items-center sf:justify-between sf:gap-2">
        <StatusBadge
          state={report.state}
          summary={report.summary}
          data-testid="detail-panel-status-badge"
        />
        <span
          className="sf:shrink-0 sf:text-[10px] sf:text-muted-foreground"
          data-testid="detail-panel-status-relative-time"
        >
          {`Last updated: ${formatRelativeTime(report.ts, now)}`}
        </span>
      </div>
      {report.detail ? (
        <div
          data-testid="detail-panel-status-detail"
          className="sf:whitespace-pre-wrap sf:wrap-break-word sf:rounded sf:bg-muted/40 sf:px-2 sf:py-1 sf:text-[11px] sf:text-foreground"
        >
          {report.detail}
        </div>
      ) : null}
      {entries.length > 0 ? (
        <dl
          data-testid="detail-panel-status-data"
          className="sf:grid sf:grid-cols-[auto_1fr] sf:gap-x-3 sf:gap-y-1 sf:text-[11px]"
        >
          {entries.map(([key, value]) => (
            <div key={key} className="contents" data-testid="detail-panel-status-data-row">
              <dt className="sf:truncate sf:font-medium sf:text-muted-foreground">{key}</dt>
              <dd className="sf:break-all sf:font-mono sf:text-foreground">
                {formatStatusValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/**
 * Coerce a markdown code block's children into the raw mermaid source string.
 * react-markdown passes children as `string | ReactNode[]` depending on how
 * the source was tokenized; we tolerate both shapes and strip the trailing
 * newline that fenced blocks always carry.
 */
export function readMermaidSource(children: ReactNode): string {
  if (typeof children === 'string') return children.replace(/\n$/, '');
  if (Array.isArray(children)) {
    return children
      .map((c) => (typeof c === 'string' ? c : ''))
      .join('')
      .replace(/\n$/, '');
  }
  return String(children ?? '').replace(/\n$/, '');
}

/**
 * If `children` of a markdown `<pre>` node is a `<code class="language-mermaid">`
 * element, return its inner source. Otherwise return `null` so the caller
 * keeps the default `<pre>` behavior. Exported via the closure inside
 * MarkdownContent so the `pre` handler stays declarative.
 */
export function extractMermaidSource(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const props = (children as { props?: { className?: unknown; children?: ReactNode } }).props;
  if (!props || typeof props.className !== 'string') return null;
  if (!props.className.includes('language-mermaid')) return null;
  return readMermaidSource(props.children);
}

function MarkdownContent({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="sf:mb-1 sf:text-base sf:font-bold sf:leading-snug">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="sf:mb-1 sf:text-sm sf:font-semibold sf:leading-snug">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="sf:mb-0.5 sf:text-sm sf:font-medium sf:leading-snug">{children}</h3>
        ),
        p: ({ children }) => <p className="sf:mb-2 sf:last:mb-0 sf:leading-relaxed">{children}</p>,
        ul: ({ children }) => (
          <ul className="sf:mb-2 sf:list-disc sf:pl-4 sf:last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="sf:mb-2 sf:list-decimal sf:pl-4 sf:last:mb-0">{children}</ol>
        ),
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        code: ({ children, className }) => {
          // ```mermaid blocks are handled by the `pre` override below — the
          // code element is consumed there so the SVG can render outside a
          // <pre> wrapper. Reach this branch with `language-mermaid` only
          // when markdown produces an unwrapped inline-code variant, which
          // we still want to render as a Mermaid diagram for parity.
          if (typeof className === 'string' && className.includes('language-mermaid')) {
            return <MermaidBlock code={readMermaidSource(children)} />;
          }
          const isBlock = className?.includes('language-');
          return isBlock ? (
            <code className="sf:block sf:overflow-x-auto sf:rounded sf:bg-muted/60 sf:px-2 sf:py-1 sf:font-mono sf:text-xs">
              {children}
            </code>
          ) : (
            <code className="sf:rounded sf:bg-muted/60 sf:px-1 sf:py-0.5 sf:font-mono sf:text-xs">
              {children}
            </code>
          );
        },
        pre: ({ children }) => {
          // Upgrade `<pre><code class="language-mermaid">…</code></pre>` to a
          // `<MermaidBlock />` so fenced mermaid in the Detail field renders
          // as an SVG diagram. Returning the MermaidBlock directly (no `pre`
          // wrapper) keeps the SVG out of a `<pre>` block where it would pick
          // up the monospace-preformat box.
          const mermaidSource = extractMermaidSource(children);
          if (mermaidSource !== null) {
            return <MermaidBlock code={mermaidSource} />;
          }
          return <pre className="sf:mb-2 sf:last:mb-0">{children}</pre>;
        },
        blockquote: ({ children }) => (
          <blockquote className="sf:mb-2 sf:border-l-2 sf:border-muted-foreground/30 sf:pl-3 sf:italic sf:text-muted-foreground sf:last:mb-0">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="sf:text-primary sf:underline sf:underline-offset-2"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        hr: () => <hr className="sf:my-2 sf:border-border" />,
        table: ({ children }) => (
          <div className="sf:mb-2 sf:overflow-x-auto sf:last:mb-0">
            <table className="sf:w-full sf:border-collapse sf:text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="sf:border sf:border-border sf:bg-muted/40 sf:px-2 sf:py-1 sf:text-left sf:font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="sf:border sf:border-border sf:px-2 sf:py-1">{children}</td>
        ),
      }}
    >
      {value}
    </ReactMarkdown>
  );
}

function ConnectorSummary({ connector }: { connector: Connector }) {
  return (
    <div className="sf:rounded-md sf:border sf:bg-card sf:px-3 sf:py-2 sf:text-xs">
      <dl className="divide-y">
        <SummaryRow label="Source" value={connector.source} />
        <SummaryRow label="Target" value={connector.target} />
        {connector.label ? <SummaryRow label="Label" value={connector.label} /> : null}
        {connector.style ? <SummaryRow label="Style" value={connector.style} /> : null}
        {connector.color ? <SummaryRow label="Color" value={connector.color} /> : null}
        {connector.direction ? <SummaryRow label="Direction" value={connector.direction} /> : null}
        {connector.url ? (
          <SummaryRow label="URL" value={`${connector.method ?? 'GET'} ${connector.url}`} />
        ) : null}
        {connector.eventName ? <SummaryRow label="Event" value={connector.eventName} /> : null}
        {connector.queueName ? <SummaryRow label="Queue" value={connector.queueName} /> : null}
      </dl>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sf:flex sf:items-start sf:gap-3 sf:py-2 sf:first:pt-0 sf:last:pb-0">
      <dt className="sf:w-20 sf:shrink-0 sf:font-medium sf:text-muted-foreground">{label}</dt>
      <dd className="sf:flex-1 sf:break-all sf:font-mono">{value}</dd>
    </div>
  );
}

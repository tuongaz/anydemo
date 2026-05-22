import { FolderOpen, ImagePlus, PencilLine } from 'lucide-react';
import {
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet.tsx';
import { IconPickerPopover } from './icon-picker-popover.tsx';

// Local alias to keep the title-row JSX tidy. The trigger always renders as a
// small popover anchor, regardless of whether the node has an icon set yet.
type IconChangeHandler = (nodeId: string, icon: string | null) => void;

export interface DetailPanelProps {
  flowId: string | null;
  node: FlowNode | null;
  connector: Connector | null;
  /**
   * Optional canvas adapter used for project-scoped file actions on htmlNode
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
   * DetailPanel's Icon row. The row only renders for playNode / stateNode /
   * htmlNode selections; when this callback is undefined the row is hidden
   * (mirroring the read-only gate used by onNameChange / onDescriptionChange).
   */
  onIconChange?: (nodeId: string, icon: string | null) => void;
  /**
   * US-007: latest StatusReport for the selected node, when one exists in the
   * hook's `statusByNode` map. Renders the Status section above the editable
   * fields. Undefined → section is hidden so a node with no statusAction looks
   * identical to before.
   */
  statusReport?: StatusReport & { ts: number };
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
  onClose,
}: DetailPanelProps) {
  // Text shape nodes are pure on-canvas labels — the sidebar would only
  // duplicate the inline-edited text and offer no extra fields, so the panel
  // stays closed for them. Clicking a text node still selects it on the
  // canvas; double-click still opens inline edit.
  const isTextShapeNode =
    node?.type === 'shapeNode' && (node.data as { shape?: string }).shape === 'text';
  // Ellipse + sticky shape nodes have no Name concept — their on-canvas label
  // is the `description` field, so the panel suppresses the Name row entirely.
  // The panel still opens to expose Description / Detail / style fields.
  const shapeKind =
    node?.type === 'shapeNode' ? (node.data as { shape?: string }).shape : undefined;
  const isDescriptionLabelShapeNode = shapeKind === 'ellipse' || shapeKind === 'sticky';
  const inspectableNode = isTextShapeNode ? null : node;
  const open = inspectableNode !== null || connector !== null;
  const nodeName =
    inspectableNode && 'name' in inspectableNode.data ? (inspectableNode.data.name ?? '') : '';
  const description = inspectableNode?.data.description ?? '';
  const detail = inspectableNode?.data.detail ?? '';
  const showNameField = inspectableNode !== null && !isDescriptionLabelShapeNode;
  // Icon trigger sits inline with the title (left of the name). It's only
  // meaningful for playNode + stateNode — the node types whose header renders
  // an icon next to the name. htmlNode previously rendered an icon in its
  // bottom-center label; that affordance was removed alongside the standalone
  // sidebar Icon row, so the trigger no longer surfaces for htmlNode either.
  const supportsIconField =
    inspectableNode !== null &&
    (inspectableNode.type === 'playNode' || inspectableNode.type === 'stateNode');
  const showIconField = supportsIconField && typeof onIconChange === 'function';
  // currentIcon is decoupled from showIconField so the read-only fallback
  // below can render the same icon the node body shows when the canvas is in
  // view mode (no onIconChange callback wired).
  const currentIcon =
    supportsIconField && inspectableNode && 'icon' in inspectableNode.data
      ? ((inspectableNode.data as { icon?: string }).icon ?? null)
      : null;

  // Panel width is user-resizable above the sm breakpoint via a left-edge
  // handle; persisted across sessions in localStorage. The CSS variable feeds
  // the `sm:!w-[var(...)]` override below.
  const [width, setWidth] = useState<number>(() => getStoredDetailPanelWidth());
  const onResizeHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startResizeGesture(width, e.clientX, {
      onWidth: setWidth,
      onCommit: setStoredDetailPanelWidth,
    });
  };
  const widthStyle = { ['--detail-panel-w' as string]: `${width}px` } as CSSProperties;

  return (
    <Sheet
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="sf:w-full! sf:max-w-full! sf:overflow-y-auto sf:bg-card/94 sf:backdrop-blur-[14px] sf:border-border sf:shadow-[-12px_0_40px_-12px_rgba(0,0,0,0.6)] sf:sm:w-(--detail-panel-w)! sf:sm:max-w-(--detail-panel-w)!"
        style={widthStyle}
        data-testid="detail-panel"
        onEscapeKeyDown={(e) => {
          // While any of the three editable fields is in edit mode, Escape is
          // the cancel-edit shortcut — preventDefault stops Radix from also
          // closing the Sheet. Each field's own onKeyDown handles the cancel.
          const active = document.activeElement as HTMLElement | null;
          if (active?.getAttribute('data-testid')?.endsWith('-editor')) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          // Radix dismisses on `pointerdown` outside the Sheet, which unmounts
          // the EditableField before its contentEditable can fire `onBlur` →
          // `commit()`. Flush any in-flight edit synchronously here so the
          // typed text is saved even when the user clicks the canvas pane.
          const active = document.activeElement as HTMLElement | null;
          if (active?.getAttribute('data-testid')?.endsWith('-editor')) {
            active.blur();
          }
          // Resize gestures (US-031) start with a pointerdown on a
          // .react-flow__resize-control outside the Sheet. Radix's default is
          // to close on outside interaction, which would unmount the resize
          // controls mid-gesture. Suppress the close so the panel stays open.
          const target = e.target as HTMLElement | null;
          if (target?.closest('.react-flow__resize-control')) e.preventDefault();
          // Style-strip color popovers render in a portal outside the
          // SheetContent. A click inside the popover would otherwise close
          // the Sheet. Keep it open.
          if (target?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
          // Canvas style strip lives outside the Sheet — keep open while the
          // user adjusts styles for the selected entity.
          if (target?.closest('[data-testid="canvas-style-strip"]')) e.preventDefault();
          // Clicks inside a React Flow node are part of the inspector's UX —
          // selecting another node, hitting Play, etc. Don't close on those.
          if (target?.closest('.react-flow__node')) e.preventDefault();
          // Same for connectors: another-edge click swaps selection; endpoint
          // drag starts a reconnect — neither should close the panel.
          if (target?.closest('.react-flow__edge')) e.preventDefault();
        }}
      >
        <div
          aria-label="Resize detail panel"
          onPointerDown={onResizeHandlePointerDown}
          data-testid="detail-panel-resize-handle"
          className="sf:absolute sf:inset-y-0 sf:left-0 sf:z-10 sf:hidden sf:w-1.5 sf:cursor-col-resize sf:bg-transparent sf:transition-colors sf:hover:bg-border sf:sm:block"
        />
        {inspectableNode ? (
          <div className="sf:flex sf:flex-col sf:gap-4">
            <div className="sf:-mx-6 sf:-mt-6 sf:flex sf:flex-col sf:border-b sf:border-border/60 sf:bg-card/60 sf:px-6 sf:pb-2.5 sf:pt-3 sf:pr-12">
              {showNameField ? (
                <SheetTitle data-testid="detail-panel-title">
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
                </SheetTitle>
              ) : (
                // Radix requires a SheetTitle for a11y; keep it sr-only for
                // ellipse so the panel stops rendering a Name row visually but
                // still announces the entity to screen readers.
                <SheetTitle data-testid="detail-panel-title" className="sf:sr-only">
                  {inspectableNode.id}
                </SheetTitle>
              )}
              {/* Radix requires a Description for a11y; keep one as sr-only
                  so screen readers still announce what kind of entity the
                  panel describes without cluttering the visual header. */}
              <SheetDescription className="sf:sr-only">
                {inspectableNode.id} · {inspectableNode.type}
              </SheetDescription>
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
                textClassName="sf:text-[13px] sf:leading-relaxed sf:text-muted-foreground"
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
                textClassName="sf:text-sm sf:leading-relaxed sf:text-foreground/90"
              />

              {inspectableNode.type === 'htmlNode' && flowId ? (
                <HtmlNodeSection
                  adapter={adapter}
                  nodeId={inspectableNode.id}
                  htmlPath="view.html"
                />
              ) : null}
            </div>
          </div>
        ) : connector ? (
          <div className="sf:flex sf:flex-col sf:gap-4">
            <div className="sf:-mx-6 sf:-mt-6 sf:flex sf:flex-col sf:border-b sf:border-border/60 sf:bg-card/60 sf:px-6 sf:pb-2.5 sf:pt-3 sf:pr-12">
              <SheetTitle
                data-testid="detail-panel-title"
                className="sf:text-lg sf:font-semibold sf:tracking-tight sf:text-foreground/95"
              >
                {connector.label ?? 'Connector'}
              </SheetTitle>
              <SheetDescription className="sf:sr-only">{connector.id}</SheetDescription>
            </div>

            <div className="sf:mt-0 sf:flex sf:flex-col sf:gap-3">
              <ConnectorSummary connector={connector} />
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
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
    const text = editorRef.current?.textContent ?? value;
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

// htmlNode detail section — displays the node-relative html path (e.g.
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
        pre: ({ children }) => <pre className="sf:mb-2 sf:last:mb-0">{children}</pre>,
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

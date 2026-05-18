import { FolderOpen, PencilLine } from 'lucide-react';
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
import type { Connector, DemoNode, StatusReport } from '../types.ts';
import { Button } from '../ui/button.tsx';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet.tsx';

export interface DetailPanelProps {
  demoId: string | null;
  node: DemoNode | null;
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
   * US-007: latest StatusReport for the selected node, when one exists in the
   * hook's `statusByNode` map. Renders the Status section above the editable
   * fields. Undefined → section is hidden so a node with no statusAction looks
   * identical to before.
   */
  statusReport?: StatusReport & { ts: number };
  onClose: () => void;
}

export function DetailPanel({
  demoId,
  node,
  connector,
  adapter,
  onNameChange,
  onDescriptionChange,
  onDetailChange,
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
        className="overflow-y-auto bg-card/94 backdrop-blur-[14px] border-border sm:!w-[var(--detail-panel-w)] sm:!max-w-[var(--detail-panel-w)]"
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
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-border sm:block"
        />
        {inspectableNode ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              {showNameField ? (
                <SheetTitle data-testid="detail-panel-title">
                  <EditableField
                    nodeId={inspectableNode.id}
                    value={nodeName}
                    placeholder="Name"
                    multiline={false}
                    ariaLabel="Name"
                    testIdBase="detail-panel-name"
                    onSave={onNameChange}
                    textClassName="text-base font-semibold"
                  />
                </SheetTitle>
              ) : (
                // Radix requires a SheetTitle for a11y; keep it sr-only for
                // ellipse so the panel stops rendering a Name row visually but
                // still announces the entity to screen readers.
                <SheetTitle data-testid="detail-panel-title" className="sr-only">
                  {inspectableNode.id}
                </SheetTitle>
              )}
              {/* Radix requires a Description for a11y; keep one as sr-only
                  so screen readers still announce what kind of entity the
                  panel describes without cluttering the visual header. */}
              <SheetDescription className="sr-only">
                {inspectableNode.id} · {inspectableNode.type}
              </SheetDescription>
            </div>

            <div className="mt-0 flex flex-col gap-3">
              {statusReport ? <StatusSection report={statusReport} /> : null}
              <EditableField
                nodeId={inspectableNode.id}
                value={description}
                placeholder="Short description shown on the node body"
                multiline={true}
                ariaLabel="Description"
                testIdBase="detail-panel-description"
                onSave={onDescriptionChange}
                textClassName="font-medium text-muted-foreground"
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
              />

              {inspectableNode.type === 'htmlNode' && demoId ? (
                <HtmlNodeSection adapter={adapter} htmlPath={inspectableNode.data.htmlPath} />
              ) : null}
            </div>
          </div>
        ) : connector ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <SheetTitle data-testid="detail-panel-title">
                {connector.label ?? 'Connector'}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {connector.id} · {connector.kind}
              </SheetDescription>
            </div>

            <div className="mt-0 flex flex-col gap-3">
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
          'w-full rounded-md px-2 py-1.5 text-sm',
          isEmpty ? 'italic text-muted-foreground/50' : 'text-foreground',
          !markdown && 'whitespace-pre-wrap break-words',
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
            'block w-full whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-sm outline-none',
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
            'block w-full cursor-text rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50',
            isEmpty ? 'italic text-muted-foreground/50' : 'text-foreground',
            !markdown && 'whitespace-pre-wrap break-words',
            textClassName,
          )}
        >
          {isEmpty ? placeholder : markdown ? <MarkdownContent value={value} /> : value}
        </button>
      )}
    </div>
  );
}

// htmlNode detail section — surfaces the relative `data.htmlPath` and provides
// Open-in-editor + Reveal-in-file-manager shellout buttons. Both route through
// the host-supplied `adapter.openFile` / `adapter.revealFile`. When either
// adapter method is undefined the corresponding button is hidden so embedders
// without filesystem support don't render dead affordances.
export function HtmlNodeSection({
  adapter,
  htmlPath,
}: {
  adapter: CanvasAdapter | null | undefined;
  htmlPath: string;
}) {
  const [status, setStatus] = useState<{
    kind: 'idle' | 'pending' | 'error';
    message?: string;
  }>({ kind: 'idle' });

  const canOpen = typeof adapter?.openFile === 'function';
  const canReveal = typeof adapter?.revealFile === 'function';

  const dispatch = async (action: 'open' | 'reveal') => {
    setStatus({ kind: 'pending' });
    try {
      if (action === 'open') {
        await adapter?.openFile?.(htmlPath);
      } else {
        await adapter?.revealFile?.(htmlPath);
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
      className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-xs"
      data-testid="detail-panel-html-node"
    >
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-widest">
          Path
        </span>
        <code
          data-testid="detail-panel-html-path"
          className="block break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px]"
        >
          {htmlPath}
        </code>
      </div>
      {canOpen || canReveal ? (
        <div className="flex flex-wrap items-center gap-2">
          {canOpen ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2"
              onClick={() => {
                void dispatch('open');
              }}
              disabled={status.kind === 'pending'}
              data-testid="detail-panel-html-open"
              aria-label="Open in editor"
            >
              <PencilLine className="h-3.5 w-3.5" />
              Open in editor
            </Button>
          ) : null}
          {canReveal ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2"
              onClick={() => {
                void dispatch('reveal');
              }}
              disabled={status.kind === 'pending'}
              data-testid="detail-panel-html-reveal"
              aria-label="Reveal in Finder/Explorer"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Reveal
            </Button>
          ) : null}
        </div>
      ) : null}
      {status.kind === 'error' ? (
        <div
          data-testid="detail-panel-html-status"
          data-status={status.kind}
          className={cn('text-[11px] text-destructive')}
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
      className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-xs"
      data-testid="detail-panel-status"
      data-state={report.state}
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge
          state={report.state}
          summary={report.summary}
          data-testid="detail-panel-status-badge"
        />
        <span
          className="shrink-0 text-[10px] text-muted-foreground"
          data-testid="detail-panel-status-relative-time"
        >
          {`Last updated: ${formatRelativeTime(report.ts, now)}`}
        </span>
      </div>
      {report.detail ? (
        <div
          data-testid="detail-panel-status-detail"
          className="whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 text-[11px] text-foreground"
        >
          {report.detail}
        </div>
      ) : null}
      {entries.length > 0 ? (
        <dl
          data-testid="detail-panel-status-data"
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]"
        >
          {entries.map(([key, value]) => (
            <div key={key} className="contents" data-testid="detail-panel-status-data-row">
              <dt className="truncate font-medium text-muted-foreground">{key}</dt>
              <dd className="break-all font-mono text-foreground">{formatStatusValue(value)}</dd>
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
        h1: ({ children }) => <h1 className="mb-1 text-base font-bold leading-snug">{children}</h1>,
        h2: ({ children }) => (
          <h2 className="mb-1 text-sm font-semibold leading-snug">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-0.5 text-sm font-medium leading-snug">{children}</h3>
        ),
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-');
          return isBlock ? (
            <code className="block overflow-x-auto rounded bg-muted/60 px-2 py-1 font-mono text-xs">
              {children}
            </code>
          ) : (
            <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-xs">{children}</code>
          );
        },
        pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground last:mb-0">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        hr: () => <hr className="my-2 border-border" />,
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border bg-muted/40 px-2 py-1 text-left font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
      }}
    >
      {value}
    </ReactMarkdown>
  );
}

function ConnectorSummary({ connector }: { connector: Connector }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs">
      <dl className="divide-y">
        <SummaryRow label="Source" value={connector.source} />
        <SummaryRow label="Target" value={connector.target} />
        <SummaryRow label="Kind" value={connector.kind} />
        {connector.label ? <SummaryRow label="Label" value={connector.label} /> : null}
        {connector.style ? <SummaryRow label="Style" value={connector.style} /> : null}
        {connector.color ? <SummaryRow label="Color" value={connector.color} /> : null}
        {connector.direction ? <SummaryRow label="Direction" value={connector.direction} /> : null}
        {connector.kind === 'http' && connector.url ? (
          <SummaryRow label="URL" value={`${connector.method ?? 'GET'} ${connector.url}`} />
        ) : null}
        {connector.kind === 'event' ? (
          <SummaryRow label="Event" value={connector.eventName} />
        ) : null}
        {connector.kind === 'queue' ? (
          <SummaryRow label="Queue" value={connector.queueName} />
        ) : null}
      </dl>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="w-20 shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-all font-mono">{value}</dd>
    </div>
  );
}

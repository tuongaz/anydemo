import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { createDebouncer } from '../lib/debounce.ts';

export interface InlineEditProps {
  initialValue: string;
  /** Persist a value (debounced 400ms during typing, immediate on blur/Enter). */
  onCommit: (value: string) => void;
  /** Exit edit mode (called on blur/Enter/Escape after any commit/revert). */
  onExit: () => void;
  /** Allow newlines (Shift+Enter inserts one; plain Enter still finalizes). */
  multiline?: boolean;
  /**
   * 'enter-commits' (default): plain Enter finalizes; Shift+Enter inserts a
   * newline when `multiline` is true. Used for short fields (connector label,
   * detail-panel inputs).
   *
   * 'blur-only': bare Enter inserts a newline (same as Shift+Enter); the only
   * commit path is blur (click-outside) or Escape-cancel. Implies multiline
   * reading semantics (`innerText`), so callers don't need to also pass
   * `multiline`. Used for node labels (US-013) where Enter is a typing key,
   * not a submit key.
   */
  commitMode?: 'enter-commits' | 'blur-only';
  /**
   * Empty value is rejected: revert to the previous value with a shake animation
   * and exit without firing onCommit. Used for fields that the schema mandates.
   */
  required?: boolean;
  /** data-field attribute for tests; pairs with data-testid='inline-edit-input'. */
  field: string;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  /**
   * Select all seeded text on mount (default true) so a fresh edit overtypes.
   * Pass false to place the caret at the end instead — used when the editor is
   * re-mounted by a host remount mid-edit (e.g. an SSE echo rebuilding the edge
   * a connector label lives on) so resumed typing appends rather than wiping.
   */
  selectOnMount?: boolean;
}

/**
 * Local-state inline editor backed by a contenteditable `<div>` so the editor
 * blends visually with the surrounding text — no input/textarea chrome, no
 * form-field cursor change, no scrollbars on overflow. The component is
 * uncontrolled; `initialValue` seeds the editor on mount and the parent
 * receives changes via `onCommit`.
 *
 * Persistence cadence (per US-026):
 *   • 400ms debounced commit while the user is typing.
 *   • Immediate commit on blur / Enter (cancels any pending debounce).
 *   • Escape cancels both pending and exit-time commits.
 */
export function InlineEdit({
  initialValue,
  onCommit,
  onExit,
  multiline = false,
  commitMode = 'enter-commits',
  required = false,
  field,
  className,
  style,
  placeholder,
  selectOnMount = true,
}: InlineEditProps) {
  // 'blur-only' implies multiline reading (innerText) so newlines round-trip.
  const isMultiline = multiline || commitMode === 'blur-only';
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [shake, setShake] = useState(false);
  const [empty, setEmpty] = useState(initialValue.length === 0);
  const debouncerRef = useRef(createDebouncer(400));
  const lastCommittedRef = useRef(initialValue);
  const skipBlurRef = useRef(false);

  // Mount: seed the editor's text, focus, and (by default) select all so the
  // user can immediately overtype. We seed via DOM (not via JSX children)
  // because contenteditable + React children fights React's reconciliation: the
  // browser mutates the subtree on every keystroke, then React tries to
  // restore it on re-render and the caret jumps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialValue/selectOnMount are one-shot mount seeds.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.textContent = initialValue;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      // selectOnMount=false → collapse to the end so the caret sits after the
      // existing text instead of selecting it (remount-restore case).
      if (!selectOnMount) range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const debouncer = debouncerRef.current;
    return () => {
      // Flush (not cancel) so any in-flight debounced commit fires before the
      // editor unmounts. Without this, a parent re-render that swaps the
      // conditional branch hosting the InlineEdit (e.g. data.onDescriptionChange
      // briefly becomes undefined, the node renderer falls back to the static
      // label) would lose the user's last keystrokes before the 400 ms
      // commit timer elapses. Cancel paths (Escape) explicitly cancel above.
      debouncer.flush();
    };
    // initialValue is captured at mount on purpose — see component docstring.
  }, []);

  const readValue = (): string => {
    const el = editorRef.current;
    if (!el) return '';
    // innerText resolves <br> and block boundaries to '\n'; textContent
    // ignores them. Use innerText for multiline so Shift+Enter newlines
    // round-trip; textContent for single-line keeps things simple.
    return isMultiline ? el.innerText : (el.textContent ?? '');
  };

  const commitNow = (next: string) => {
    debouncerRef.current.cancel();
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    onCommit(next);
  };

  const handleInput = () => {
    const next = readValue();
    setEmpty(next.length === 0);
    // Skip the debounced commit when the value would be rejected — let the
    // user keep typing without round-tripping a 400-error to the server.
    if (required && next.trim().length === 0) {
      debouncerRef.current.cancel();
      return;
    }
    debouncerRef.current.schedule(() => commitNow(next));
  };

  const finalize = () => {
    debouncerRef.current.cancel();
    const next = readValue();
    if (required && next.trim().length === 0) {
      // Reject empty for required fields: revert local state, shake to signal,
      // and exit without firing onCommit. The previous server value is left
      // untouched (no PATCH was issued during the rejected edit thanks to
      // the early-return in handleInput).
      const el = editorRef.current;
      if (el) el.textContent = initialValue;
      setShake(true);
      setTimeout(() => setShake(false), 320);
      onExit();
      return;
    }
    commitNow(next);
    onExit();
  };

  const cancel = () => {
    debouncerRef.current.cancel();
    const el = editorRef.current;
    if (el) el.textContent = initialValue;
    onExit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Stop the keystroke from bubbling to the canvas — Backspace/Delete on the
    // canvas would otherwise trigger node deletion (US-027). React's
    // stopPropagation only halts React's synthetic event tree; window-level
    // listeners (e.g. flow-view.tsx's Delete/Backspace shortcut) listen for
    // the NATIVE event and need a separate stop. Without this, a Backspace
    // press whose default action emptied the editor could still bubble to
    // window and delete the focused connector (US-018 delete-on-empty bug).
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    if (e.key === 'Enter') {
      // 'blur-only' (US-013) treats Enter as a typing key — never commits.
      // For 'enter-commits', Shift+Enter inserts a newline when multiline.
      const insertNewline = commitMode === 'blur-only' || (multiline && e.shiftKey);
      if (insertNewline) {
        // Default contenteditable Enter inserts <br> or <div> depending on
        // browser; force a literal newline so innerText reads stay clean.
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
        return;
      }
      e.preventDefault();
      // Calling el.blur() also fires our onBlur handler — guard against the
      // double finalize so we don't issue two PATCHes for one Enter.
      skipBlurRef.current = true;
      finalize();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      skipBlurRef.current = true;
      cancel();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Strip formatting/HTML on paste — we only persist plain text, and
    // pasting rich text into a contenteditable would otherwise leak <span>
    // styling (font, color, size) into the node.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const onBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    // A blur fired because the editor element was detached from the DOM (the
    // host re-rendered and unmounted/remounted us — e.g. React Flow tearing
    // down the edge a connector label lives on during an SSE echo) must NOT
    // finalize/exit: that would clear the host's "currently editing" state and
    // collapse the editor for good, stealing focus mid-edit. The mount-cleanup
    // debouncer.flush() already persists any pending text, and the host
    // restores the edit on remount. Genuine click-away blurs leave the element
    // connected, so they still finalize.
    const el = editorRef.current;
    if (!el || !el.isConnected) return;
    finalize();
  };

  // `nodrag nopan nowheel` opts the editor out of React Flow's pointer/wheel
  // capture so typing isn't interpreted as a node drag, pane pan, or zoom.
  // Inherits font / color from the surrounding text so read↔edit looks
  // identical.
  return (
    <div
      ref={editorRef}
      data-testid="inline-edit-input"
      data-field={field}
      data-placeholder={placeholder}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onBlur={onBlur}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={style}
      className={cn(
        'nodrag nopan nowheel sf:block sf:w-full sf:bg-transparent sf:p-0 sf:text-inherit sf:outline-none',
        'sf:whitespace-pre-wrap sf:wrap-break-word',
        empty && placeholder ? 'inline-edit-empty' : '',
        shake ? 'inline-edit-shake' : '',
        className,
      )}
    />
  );
}

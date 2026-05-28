// Pure helpers for the canvas keyboard shortcuts (US-024). Kept ref-free so
// they can be unit-tested without DOM/React: each takes the bare event fields
// the dispatcher reads and returns the resolved action (or null for unrelated
// keys). Wiring lives in `demo-view.tsx`.

import type { GeometricNodeType } from '../types.ts';

export type ModifierEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'
>;

// US-002: cross-platform display helpers + COMMANDS registry. Detection runs
// once at module load — production wiring (and the COMMANDS array below) reads
// the resolved boolean. Tests pass an explicit `isMac` to `formatShortcut` so
// the rendering can be exercised on both platforms without monkey-patching
// `navigator`.
export const IS_MAC: boolean =
  typeof navigator !== 'undefined' &&
  typeof navigator.platform === 'string' &&
  navigator.platform.toLowerCase().includes('mac');

export type ShortcutParts = {
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
};

const formatKey = (key: string): string => {
  if (key.length === 1) return key.toUpperCase();
  if (key === 'Escape') return 'Esc';
  return key;
};

/**
 * Render a keyboard shortcut for display. On macOS: ⌘⇧⌥ glyphs are
 * concatenated with the key (e.g. `⌘⇧L`). On Windows/Linux: `Ctrl+Shift+Alt+`
 * tokens joined with `+` (e.g. `Ctrl+Shift+L`). The `meta` flag maps to ⌘ on
 * mac and `Ctrl` elsewhere — callers pass the same shape regardless of OS.
 *
 * The optional `isMac` override exists for tests; production callers omit it
 * and pick up the module-level `IS_MAC` detection.
 */
export const formatShortcut = (parts: ShortcutParts, isMac: boolean = IS_MAC): string => {
  const keyLabel = formatKey(parts.key);
  if (isMac) {
    let out = '';
    if (parts.meta) out += '⌘';
    if (parts.alt) out += '⌥';
    if (parts.shift) out += '⇧';
    return `${out}${keyLabel}`;
  }
  const tokens: string[] = [];
  if (parts.meta) tokens.push('Ctrl');
  if (parts.shift) tokens.push('Shift');
  if (parts.alt) tokens.push('Alt');
  tokens.push(keyLabel);
  return tokens.join('+');
};

export type CommandId =
  | 'tool.select'
  | 'tool.hand'
  | 'tool.rectangle'
  | 'tool.ellipse'
  | 'tool.text'
  | 'tool.sticky'
  | 'tool.database'
  | 'tool.server'
  | 'tool.user'
  | 'tool.queue'
  | 'tool.cloud'
  | 'tool.diamond'
  | 'tool.hexagon'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.duplicate'
  | 'edit.delete'
  | 'edit.selectAll'
  | 'view.fit'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.zoom100'
  | 'view.zoomToSelection'
  | 'layout.tidy'
  | 'selection.deselect'
  | 'help.commandPalette'
  | 'export.pdf'
  | 'export.png';

export type CommandCategory = 'Edit' | 'View' | 'Tools' | 'Layout' | 'Selection' | 'File' | 'Help';

export type CommandContext = {
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasClipboard: boolean;
  // True when there's an open demo backing the export commands. The palette
  // renders inside DemoView (so the demo is always set in practice), but the
  // dispatcher noops if the demo isn't ready yet — surface that here so the
  // palette greys the rows instead of letting Enter do nothing.
  canExportDemo: boolean;
};

export type CommandDef = {
  id: CommandId;
  label: string;
  description?: string;
  category: CommandCategory;
  shortcut?: string;
  enabled?: (ctx: CommandContext) => boolean;
};

// Single source of truth: dispatcher (`runCommand` in demo-view.tsx) and UI
// (command palette, toolbar tooltips) both read from this array so a label or
// shortcut change propagates everywhere without hunting through call sites.
export const COMMANDS: readonly CommandDef[] = [
  {
    id: 'tool.select',
    label: 'Select tool',
    description: 'Switch to the selection tool',
    category: 'Tools',
    shortcut: formatShortcut({ key: 'V' }),
  },
  {
    id: 'tool.hand',
    label: 'Hand tool',
    description: 'Pan the canvas; node interaction is suspended while armed',
    category: 'Tools',
    shortcut: formatShortcut({ key: 'H' }),
  },
  {
    id: 'tool.rectangle',
    label: 'Rectangle',
    description: 'Draw rectangle nodes',
    category: 'Tools',
    shortcut: formatShortcut({ key: 'R' }),
  },
  {
    id: 'tool.ellipse',
    label: 'Ellipse',
    description: 'Draw ellipse nodes',
    category: 'Tools',
    shortcut: formatShortcut({ key: 'O' }),
  },
  {
    id: 'tool.text',
    label: 'Text',
    description: 'Add a text node',
    category: 'Tools',
    shortcut: formatShortcut({ key: 'T' }),
  },
  {
    id: 'tool.sticky',
    label: 'Sticky note',
    description: 'Add a sticky note',
    category: 'Tools',
    shortcut: formatShortcut({ key: 'S' }),
  },
  {
    id: 'tool.database',
    label: 'Database',
    description: 'Add a database node',
    category: 'Tools',
    shortcut: formatShortcut({ key: 'D' }),
  },
  // US-022: illustrative shapes added after Database (server, user, queue,
  // cloud) live behind the toolbar's Shape picker and don't claim a bare-key
  // shortcut — the single-letter pool was already tight (V/R/O/T/S/D taken)
  // and shadowing useful chords would cost more than it saves.
  {
    id: 'tool.server',
    label: 'Server',
    description: 'Add a server node',
    category: 'Tools',
  },
  {
    id: 'tool.user',
    label: 'User',
    description: 'Add a user node',
    category: 'Tools',
  },
  {
    id: 'tool.queue',
    label: 'Queue',
    description: 'Add a queue node',
    category: 'Tools',
  },
  {
    id: 'tool.cloud',
    label: 'Cloud',
    description: 'Add a cloud node',
    category: 'Tools',
  },
  {
    id: 'tool.diamond',
    label: 'Diamond',
    description: 'Add a diamond node (decision / gateway)',
    category: 'Tools',
  },
  {
    id: 'tool.hexagon',
    label: 'Hexagon',
    description: 'Add a hexagon node (microservice)',
    category: 'Tools',
  },
  {
    id: 'edit.undo',
    label: 'Undo',
    category: 'Edit',
    shortcut: formatShortcut({ meta: true, key: 'Z' }),
    enabled: (ctx) => ctx.canUndo,
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    category: 'Edit',
    shortcut: formatShortcut({ meta: true, shift: true, key: 'Z' }),
    enabled: (ctx) => ctx.canRedo,
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    category: 'Edit',
    shortcut: formatShortcut({ meta: true, key: 'C' }),
    enabled: (ctx) => ctx.hasSelection,
  },
  {
    id: 'edit.paste',
    label: 'Paste',
    category: 'Edit',
    shortcut: formatShortcut({ meta: true, key: 'V' }),
    enabled: (ctx) => ctx.hasClipboard,
  },
  {
    id: 'edit.duplicate',
    label: 'Duplicate',
    category: 'Edit',
    shortcut: formatShortcut({ meta: true, key: 'D' }),
    enabled: (ctx) => ctx.hasSelection,
  },
  {
    id: 'edit.delete',
    label: 'Delete',
    category: 'Edit',
    shortcut: formatShortcut({ key: 'Delete' }),
    enabled: (ctx) => ctx.hasSelection,
  },
  {
    id: 'edit.selectAll',
    label: 'Select all',
    category: 'Edit',
    shortcut: formatShortcut({ meta: true, key: 'A' }),
  },
  {
    id: 'view.fit',
    label: 'Fit view',
    description: 'Fit everything in the viewport',
    category: 'View',
    shortcut: formatShortcut({ meta: true, key: '0' }),
  },
  {
    id: 'view.zoomIn',
    label: 'Zoom in',
    category: 'View',
    shortcut: formatShortcut({ meta: true, key: '=' }),
  },
  {
    id: 'view.zoomOut',
    label: 'Zoom out',
    category: 'View',
    shortcut: formatShortcut({ meta: true, key: '-' }),
  },
  {
    id: 'view.zoom100',
    label: 'Zoom to 100%',
    category: 'View',
    shortcut: formatShortcut({ key: '1' }),
  },
  {
    id: 'view.zoomToSelection',
    label: 'Zoom to selection',
    category: 'View',
    shortcut: formatShortcut({ key: 'F' }),
    enabled: (ctx) => ctx.hasSelection,
  },
  {
    id: 'layout.tidy',
    label: 'Tidy layout',
    description: 'Auto-layout the canvas or current selection',
    category: 'Layout',
    shortcut: formatShortcut({ meta: true, shift: true, key: 'L' }),
  },
  {
    id: 'selection.deselect',
    label: 'Deselect',
    description: 'Clear selection and exit draw mode',
    category: 'Selection',
    shortcut: formatShortcut({ key: 'Escape' }),
  },
  {
    id: 'help.commandPalette',
    label: 'Open command palette',
    category: 'Help',
    shortcut: formatShortcut({ meta: true, key: 'P' }),
  },
  // File / session commands — surfaced via the palette so the keyboard-first
  // user can reach them without going to the top-right menu chrome. No
  // shortcuts assigned: the single-letter pool is exhausted and these aren't
  // hot enough to claim a chord (use the palette).
  {
    id: 'export.pdf',
    label: 'Export to PDF',
    description: 'Download the current canvas as a PDF',
    category: 'File',
    enabled: (ctx) => ctx.canExportDemo,
  },
  {
    id: 'export.png',
    label: 'Export as image',
    description: 'Download the current canvas as a PNG',
    category: 'File',
    enabled: (ctx) => ctx.canExportDemo,
  },
];

/**
 * Tooltip text for a registered command — `"Label (Shortcut)"` when the
 * command defines a shortcut, just `Label` otherwise. Lets the toolbar drive
 * both `title` and `aria-label` from `COMMANDS` so a future label/shortcut
 * change in the registry propagates to every hover hint without re-edits.
 */
export const getCommandTooltip = (id: CommandId): string => {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) return '';
  return cmd.shortcut ? `${cmd.label} (${cmd.shortcut})` : cmd.label;
};

export type NudgeDelta = { dx: number; dy: number };

const NUDGE_STEP_DEFAULT = 1;
const NUDGE_STEP_SHIFT = 10;

/**
 * Resolve an arrow-key nudge from a KeyboardEvent. Returns null for any other
 * key, OR for arrows accompanied by a non-shift modifier (so Cmd+ArrowRight
 * etc. fall through to the browser's word-jump / line-jump behavior).
 *
 * Shift increases the step from 1px to 10px on the same axis. Up/Down map to
 * y±1 (canvas y grows downward); Left/Right map to x±1.
 */
export const getNudgeDelta = (e: ModifierEvent): NudgeDelta | null => {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const step = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP_DEFAULT;
  switch (e.key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
};

export type ZoomAction = 'fit' | 'in' | 'out';

/**
 * Resolve a Cmd/Ctrl-prefixed zoom chord. Cmd+0 → fit, Cmd+= or Cmd+Plus → in,
 * Cmd+- → out. Returns null for unrelated keys or chords without the
 * Cmd/Ctrl modifier. Alt as an extra modifier disqualifies the chord (avoids
 * shadowing the browser's Cmd+Alt+= and similar developer shortcuts).
 */
export const getZoomChord = (e: ModifierEvent): ZoomAction | null => {
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.altKey) return null;
  switch (e.key) {
    case '0':
      return 'fit';
    // '=' is the bare key, '+' is Shift+= on most layouts. Both should map to
    // zoom in so Cmd+= and Cmd+Shift+= behave the same.
    case '=':
    case '+':
      return 'in';
    // '-' is the bare key, '_' is Shift+- on most layouts. Pair them so
    // Cmd+- and Cmd+Shift+- both zoom out.
    case '-':
    case '_':
      return 'out';
    default:
      return null;
  }
};

/**
 * Compute the per-id position updates produced by an arrow-key nudge against
 * the current selection. Skips ids that aren't in `nodes` so a pure-connector
 * selection (no node ids supplied) collapses to a no-op the caller can detect
 * via `result.length === 0`.
 *
 * `nodes` carries the LIVE position the user sees (overrides merged) so a
 * burst of arrow taps within the undo coalesce window keeps stacking on the
 * already-shifted position rather than the stale server snapshot.
 */
export const applyNudge = (
  delta: NudgeDelta,
  selectedIds: readonly string[],
  nodes: readonly { id: string; position: { x: number; y: number } }[],
): { id: string; position: { x: number; y: number } }[] => {
  if (selectedIds.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: { id: string; position: { x: number; y: number } }[] = [];
  for (const id of selectedIds) {
    const n = byId.get(id);
    if (!n) continue;
    out.push({
      id,
      position: { x: n.position.x + delta.dx, y: n.position.y + delta.dy },
    });
  }
  return out;
};

// US-020: clipboard-chord resolver. Pure inputs → action so the wiring in
// demo-view.tsx is a thin dispatcher and the chord rules stay unit-testable.
// Modifier rule: requires Cmd OR Ctrl; rejects Shift/Alt so the chord doesn't
// shadow browser-native chords like Cmd+Shift+C (devtools) or Cmd+Alt+V.
// `isEditableActive` short-circuits to noop so native browser copy/paste keeps
// working inside InlineEdit / inputs / textareas / contentEditable surfaces.
export type ClipboardChord =
  | { type: 'noop' }
  | { type: 'selectAll' }
  | { type: 'copy'; ids: readonly string[] }
  | { type: 'duplicate'; ids: readonly string[] }
  | { type: 'paste' };

export type ClipboardChordInput = {
  event: ModifierEvent;
  isEditableActive: boolean;
  hasNodes: boolean;
  hasConnectors: boolean;
  selectedIds: readonly string[];
  hasClipboard: boolean;
};

export const resolveClipboardChord = ({
  event,
  isEditableActive,
  hasNodes,
  hasConnectors,
  selectedIds,
  hasClipboard,
}: ClipboardChordInput): ClipboardChord => {
  if (!(event.metaKey || event.ctrlKey)) return { type: 'noop' };
  if (event.shiftKey || event.altKey) return { type: 'noop' };
  const key = event.key.toLowerCase();
  if (key !== 'a' && key !== 'c' && key !== 'v' && key !== 'd') return { type: 'noop' };
  if (isEditableActive) return { type: 'noop' };
  if (key === 'a') {
    if (!hasNodes && !hasConnectors) return { type: 'noop' };
    return { type: 'selectAll' };
  }
  if (key === 'c') {
    if (selectedIds.length === 0) return { type: 'noop' };
    return { type: 'copy', ids: selectedIds };
  }
  if (key === 'd') {
    if (selectedIds.length === 0) return { type: 'noop' };
    return { type: 'duplicate', ids: selectedIds };
  }
  // 'v'
  if (!hasClipboard) return { type: 'noop' };
  return { type: 'paste' };
};

export type HistoryChord = 'undo' | 'redo' | null;

/**
 * Resolve a Cmd/Ctrl-prefixed history chord. Mirrors `resolveClipboardChord`'s
 * gating: requires Cmd OR Ctrl, rejects Alt, defers to the browser when an
 * editable surface is active (input/textarea/contentEditable) so native undo
 * keeps working inside text fields.
 *
 * Bindings:
 *   - Cmd/Ctrl+Z         → 'undo'
 *   - Cmd/Ctrl+Shift+Z   → 'redo'
 *   - Cmd/Ctrl+Y         → 'redo'  (no Shift; Windows-style redo for users who
 *                                    type it out of habit)
 *
 * All other keys / unrelated modifiers → null.
 */
export const resolveHistoryChord = (
  e: ModifierEvent,
  opts: { isEditableActive: boolean },
): HistoryChord => {
  if (opts.isEditableActive) return null;
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
};

// US-003: tool-switch bare-key resolver. Maps Figma/Miro-style single letters
// (V/R/O/T/S/D) to the toolbar's draw-mode value. Returns null for any chord —
// these bindings are intentionally bare-only so they don't collide with Cmd+V
// (paste), Cmd+D (duplicate), Shift+letter (inputs), etc. Uppercase variants
// resolve identically (key.toLowerCase normalization).
export type ToolShortcutResult = 'select' | 'hand' | GeometricNodeType | null;

export const resolveToolShortcut = (e: ModifierEvent): ToolShortcutResult => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case 'v':
      return 'select';
    case 'h':
      return 'hand';
    case 'r':
      return 'rectangle';
    case 'o':
      return 'ellipse';
    case 't':
      return 'text';
    case 's':
      return 'sticky';
    case 'd':
      return 'database';
    default:
      return null;
  }
};

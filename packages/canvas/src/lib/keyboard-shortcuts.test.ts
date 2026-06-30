import { describe, expect, it } from 'bun:test';
import {
  COMMANDS,
  type ClipboardChordInput,
  type CommandId,
  type ToolShortcutResult,
  applyNudge,
  formatShortcut,
  getNudgeDelta,
  getZoomChord,
  resolveClipboardChord,
  resolveGroupChord,
  resolveHistoryChord,
  resolveToolShortcut,
} from './keyboard-shortcuts';

const ev = (
  overrides: Partial<{
    key: string;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }> = {},
) => ({
  key: '',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
});

describe('getNudgeDelta', () => {
  it('returns 1px on bare arrow keys', () => {
    expect(getNudgeDelta(ev({ key: 'ArrowRight' }))).toEqual({ dx: 1, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowLeft' }))).toEqual({ dx: -1, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowDown' }))).toEqual({ dx: 0, dy: 1 });
    expect(getNudgeDelta(ev({ key: 'ArrowUp' }))).toEqual({ dx: 0, dy: -1 });
  });

  it('returns 10px when Shift is held', () => {
    expect(getNudgeDelta(ev({ key: 'ArrowRight', shiftKey: true }))).toEqual({ dx: 10, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowLeft', shiftKey: true }))).toEqual({ dx: -10, dy: 0 });
    expect(getNudgeDelta(ev({ key: 'ArrowDown', shiftKey: true }))).toEqual({ dx: 0, dy: 10 });
    expect(getNudgeDelta(ev({ key: 'ArrowUp', shiftKey: true }))).toEqual({ dx: 0, dy: -10 });
  });

  it('returns null when Cmd/Ctrl/Alt are held', () => {
    expect(getNudgeDelta(ev({ key: 'ArrowRight', metaKey: true }))).toBeNull();
    expect(getNudgeDelta(ev({ key: 'ArrowLeft', ctrlKey: true }))).toBeNull();
    expect(getNudgeDelta(ev({ key: 'ArrowUp', altKey: true }))).toBeNull();
  });

  it('returns null for non-arrow keys', () => {
    expect(getNudgeDelta(ev({ key: 'a' }))).toBeNull();
    expect(getNudgeDelta(ev({ key: 'Enter' }))).toBeNull();
    expect(getNudgeDelta(ev({ key: ' ' }))).toBeNull();
  });
});

describe('getZoomChord', () => {
  it('Cmd/Ctrl+0 → fit', () => {
    expect(getZoomChord(ev({ key: '0', metaKey: true }))).toBe('fit');
    expect(getZoomChord(ev({ key: '0', ctrlKey: true }))).toBe('fit');
  });

  it('Cmd+= and Cmd+Shift+= (Plus) → in', () => {
    expect(getZoomChord(ev({ key: '=', metaKey: true }))).toBe('in');
    expect(getZoomChord(ev({ key: '+', metaKey: true, shiftKey: true }))).toBe('in');
    expect(getZoomChord(ev({ key: '=', ctrlKey: true }))).toBe('in');
  });

  it('Cmd+- → out', () => {
    expect(getZoomChord(ev({ key: '-', metaKey: true }))).toBe('out');
    expect(getZoomChord(ev({ key: '-', ctrlKey: true }))).toBe('out');
    expect(getZoomChord(ev({ key: '_', metaKey: true, shiftKey: true }))).toBe('out');
  });

  it('returns null without Cmd/Ctrl', () => {
    expect(getZoomChord(ev({ key: '0' }))).toBeNull();
    expect(getZoomChord(ev({ key: '=', shiftKey: true }))).toBeNull();
  });

  it('returns null when Alt is held', () => {
    expect(getZoomChord(ev({ key: '0', metaKey: true, altKey: true }))).toBeNull();
  });

  it('returns null for unrelated keys (e.g. Cmd+L, Cmd+Shift+L)', () => {
    expect(getZoomChord(ev({ key: 'l', metaKey: true }))).toBeNull();
    expect(getZoomChord(ev({ key: 'L', metaKey: true, shiftKey: true }))).toBeNull();
    expect(getZoomChord(ev({ key: 'a', metaKey: true }))).toBeNull();
  });
});

describe('applyNudge', () => {
  const nodes = [
    { id: 'a', position: { x: 100, y: 100 } },
    { id: 'b', position: { x: 200, y: 50 } },
    { id: 'c', position: { x: 0, y: 0 } },
  ];

  it('shifts a single selected node by the delta', () => {
    expect(applyNudge({ dx: 1, dy: 0 }, ['a'], nodes)).toEqual([
      { id: 'a', position: { x: 101, y: 100 } },
    ]);
  });

  it('uses 10px on every selected id under Shift+arrow', () => {
    expect(applyNudge({ dx: 0, dy: 10 }, ['a', 'b'], nodes)).toEqual([
      { id: 'a', position: { x: 100, y: 110 } },
      { id: 'b', position: { x: 200, y: 60 } },
    ]);
  });

  it('moves every selected id by the same delta in one keystroke', () => {
    const result = applyNudge({ dx: -1, dy: 0 }, ['a', 'b', 'c'], nodes);
    expect(result.length).toBe(3);
    expect(result.find((u) => u.id === 'a')?.position).toEqual({ x: 99, y: 100 });
    expect(result.find((u) => u.id === 'b')?.position).toEqual({ x: 199, y: 50 });
    expect(result.find((u) => u.id === 'c')?.position).toEqual({ x: -1, y: 0 });
  });

  it('skips ids that are not present (pure-connector selection → no-op)', () => {
    expect(applyNudge({ dx: 1, dy: 0 }, ['conn-1', 'conn-2'], nodes)).toEqual([]);
  });

  it('returns [] when the selection is empty', () => {
    expect(applyNudge({ dx: 1, dy: 0 }, [], nodes)).toEqual([]);
  });
});

describe('resolveClipboardChord (US-020)', () => {
  // The handler in demo-view.tsx defers to this resolver for every Cmd/Ctrl
  // chord. These tests pin the contract so a future refactor of the chord
  // wiring (e.g. another marquee-perf change like US-010 deferring selection
  // propagation) can't silently break Cmd+C/V from a click selection.
  const input = (overrides: Partial<ClipboardChordInput> = {}): ClipboardChordInput => ({
    event: ev(),
    isEditableActive: false,
    hasNodes: true,
    hasConnectors: true,
    selectedIds: [],
    hasClipboard: false,
    ...overrides,
  });

  describe('Cmd/Ctrl+C', () => {
    it('returns copy with selected ids when at least one node is selected', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'c', metaKey: true }),
          selectedIds: ['n-1', 'n-2'],
        }),
      );
      expect(action).toEqual({ type: 'copy', ids: ['n-1', 'n-2'] });
    });

    it('Ctrl+C also resolves to copy (non-Mac)', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'c', ctrlKey: true }),
          selectedIds: ['n-1'],
        }),
      );
      expect(action).toEqual({ type: 'copy', ids: ['n-1'] });
    });

    it('noop when selection is empty', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'c', metaKey: true }),
          selectedIds: [],
        }),
      );
      expect(action).toEqual({ type: 'noop' });
    });

    it('noop when an editable element is focused (so native browser copy works)', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'c', metaKey: true }),
          selectedIds: ['n-1'],
          isEditableActive: true,
        }),
      );
      expect(action).toEqual({ type: 'noop' });
    });

    it('noop when Shift or Alt are also held (Cmd+Shift+C is devtools, etc.)', () => {
      const shift = resolveClipboardChord(
        input({
          event: ev({ key: 'c', metaKey: true, shiftKey: true }),
          selectedIds: ['n-1'],
        }),
      );
      const alt = resolveClipboardChord(
        input({
          event: ev({ key: 'c', metaKey: true, altKey: true }),
          selectedIds: ['n-1'],
        }),
      );
      expect(shift).toEqual({ type: 'noop' });
      expect(alt).toEqual({ type: 'noop' });
    });
  });

  describe('Cmd/Ctrl+V', () => {
    it('returns paste when the in-app clipboard is populated', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'v', metaKey: true }),
          hasClipboard: true,
        }),
      );
      expect(action).toEqual({ type: 'paste' });
    });

    it('noop when the clipboard is empty (no prior Cmd+C)', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'v', metaKey: true }),
          hasClipboard: false,
        }),
      );
      expect(action).toEqual({ type: 'noop' });
    });

    it('noop in an editable element (so native paste works inside textareas)', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'v', metaKey: true }),
          hasClipboard: true,
          isEditableActive: true,
        }),
      );
      expect(action).toEqual({ type: 'noop' });
    });
  });

  describe('Cmd/Ctrl+A', () => {
    it('returns selectAll when at least one node or connector exists', () => {
      const onlyNodes = resolveClipboardChord(
        input({
          event: ev({ key: 'a', metaKey: true }),
          hasNodes: true,
          hasConnectors: false,
        }),
      );
      const onlyConnectors = resolveClipboardChord(
        input({
          event: ev({ key: 'a', metaKey: true }),
          hasNodes: false,
          hasConnectors: true,
        }),
      );
      expect(onlyNodes).toEqual({ type: 'selectAll' });
      expect(onlyConnectors).toEqual({ type: 'selectAll' });
    });

    it('noop on an empty canvas (lets the browser do its default — no-op outside an input)', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'a', metaKey: true }),
          hasNodes: false,
          hasConnectors: false,
        }),
      );
      expect(action).toEqual({ type: 'noop' });
    });

    it('noop inside an editable element (so native text-select-all keeps working)', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'a', metaKey: true }),
          isEditableActive: true,
        }),
      );
      expect(action).toEqual({ type: 'noop' });
    });
  });

  describe('Cmd/Ctrl+D', () => {
    it('returns duplicate with selected ids', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'd', metaKey: true }),
          selectedIds: ['n-1'],
        }),
      );
      expect(action).toEqual({ type: 'duplicate', ids: ['n-1'] });
    });

    it('noop when selection is empty', () => {
      const action = resolveClipboardChord(
        input({
          event: ev({ key: 'd', metaKey: true }),
          selectedIds: [],
        }),
      );
      expect(action).toEqual({ type: 'noop' });
    });
  });

  it('noop without Cmd/Ctrl (bare letters are typing)', () => {
    expect(
      resolveClipboardChord(
        input({
          event: ev({ key: 'c' }),
          selectedIds: ['n-1'],
        }),
      ),
    ).toEqual({ type: 'noop' });
  });

  it('noop for unrelated chords (Cmd+B, Cmd+S, etc.)', () => {
    expect(
      resolveClipboardChord(
        input({
          event: ev({ key: 'b', metaKey: true }),
          selectedIds: ['n-1'],
        }),
      ),
    ).toEqual({ type: 'noop' });
  });
});

describe('formatShortcut (US-002)', () => {
  // Table-driven: rather than asserting one chord at a time, drive both
  // platforms through the same rows so a regression in either branch surfaces
  // immediately. The `isMac` override is the test seam — production callers
  // omit it and pick up the module-level IS_MAC detection.
  type Row = {
    name: string;
    parts: Parameters<typeof formatShortcut>[0];
    mac: string;
    nonMac: string;
  };

  const rows: Row[] = [
    { name: 'bare letter', parts: { key: 'l' }, mac: 'L', nonMac: 'L' },
    {
      name: 'meta + letter',
      parts: { meta: true, key: 'l' },
      mac: '⌘L',
      nonMac: 'Ctrl+L',
    },
    {
      name: 'meta + shift + letter',
      parts: { meta: true, shift: true, key: 'l' },
      mac: '⌘⇧L',
      nonMac: 'Ctrl+Shift+L',
    },
    {
      name: 'meta + alt + letter',
      parts: { meta: true, alt: true, key: 'l' },
      mac: '⌘⌥L',
      nonMac: 'Ctrl+Alt+L',
    },
    {
      name: 'shift + bare letter',
      parts: { shift: true, key: 'g' },
      mac: '⇧G',
      nonMac: 'Shift+G',
    },
    {
      name: 'meta + digit',
      parts: { meta: true, key: '0' },
      mac: '⌘0',
      nonMac: 'Ctrl+0',
    },
    {
      name: 'multi-char key passes through',
      parts: { key: 'Delete' },
      mac: 'Delete',
      nonMac: 'Delete',
    },
    {
      name: 'Escape collapses to Esc',
      parts: { key: 'Escape' },
      mac: 'Esc',
      nonMac: 'Esc',
    },
    {
      name: 'all three modifiers',
      parts: { meta: true, shift: true, alt: true, key: 'p' },
      mac: '⌘⌥⇧P',
      nonMac: 'Ctrl+Shift+Alt+P',
    },
  ];

  for (const row of rows) {
    it(`renders macOS glyphs (⌘/⇧/⌥) for ${row.name}`, () => {
      expect(formatShortcut(row.parts, true)).toBe(row.mac);
    });
    it(`renders Ctrl+/Shift+/Alt+ for ${row.name} on non-mac`, () => {
      expect(formatShortcut(row.parts, false)).toBe(row.nonMac);
    });
  }
});

describe('COMMANDS registry (US-002)', () => {
  // Every CommandId in the union MUST appear in COMMANDS exactly once.
  // Encoding the union as a runtime array (rather than re-deriving it) is the
  // only way to enforce "no duplicates, no missing" without losing type info.
  const expectedIds: readonly CommandId[] = [
    'tool.select',
    'tool.hand',
    'tool.pen',
    'tool.rectangle',
    'tool.ellipse',
    'tool.text',
    'tool.sticky',
    'tool.database',
    'tool.server',
    'tool.user',
    'tool.queue',
    'tool.cloud',
    'tool.diamond',
    'tool.hexagon',
    'tool.triangle',
    'tool.parallelogram',
    'tool.document',
    'tool.linkflow',
    'tool.line',
    'tool.table',
    'edit.undo',
    'edit.redo',
    'edit.copy',
    'edit.paste',
    'edit.duplicate',
    'edit.delete',
    'edit.selectAll',
    'edit.group',
    'edit.ungroup',
    'view.fit',
    'view.zoomIn',
    'view.zoomOut',
    'view.zoom100',
    'view.zoomToSelection',
    'layout.tidy',
    'selection.deselect',
    'help.commandPalette',
    'export.pdf',
    'export.png',
  ];

  it('contains exactly one entry per CommandId (no duplicates, no missing)', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(expectedIds));
    expect(ids.length).toBe(expectedIds.length);
  });

  it('assigns every command to a known category', () => {
    const validCategories = new Set([
      'Edit',
      'View',
      'Tools',
      'Layout',
      'Selection',
      'File',
      'Help',
    ]);
    for (const cmd of COMMANDS) {
      expect(validCategories.has(cmd.category)).toBe(true);
    }
  });

  it('renders shortcuts via formatShortcut (platform-correct at build time)', () => {
    // Sanity-check that the registry isn't hardcoding shortcut strings. Pick a
    // few commands whose shape we know and assert the shortcut starts with
    // the right modifier glyph/token for the runtime IS_MAC value.
    const tidy = COMMANDS.find((c) => c.id === 'layout.tidy');
    expect(tidy?.shortcut).toBeDefined();
    // Tidy is meta+shift+L; both renderings end in 'L'.
    expect(tidy?.shortcut?.endsWith('L')).toBe(true);

    const select = COMMANDS.find((c) => c.id === 'tool.select');
    // Bare 'V' renders the same on every platform.
    expect(select?.shortcut).toBe('V');

    const hand = COMMANDS.find((c) => c.id === 'tool.hand');
    // Bare 'H' renders the same on every platform.
    expect(hand?.shortcut).toBe('H');
  });
});

describe('resolveToolShortcut (US-003)', () => {
  // Single-letter Figma/Miro bindings: V/R/O/T/S/D map to the toolbar's draw
  // values when pressed BARE. Any modifier disqualifies the chord so the
  // bare-key family never shadows Cmd+V (paste), Cmd+D (duplicate), etc.
  const tools: ReadonlyArray<{ key: string; tool: NonNullable<ToolShortcutResult> }> = [
    { key: 'v', tool: 'select' },
    { key: 'h', tool: 'hand' },
    { key: 'p', tool: 'pen' },
    { key: 'r', tool: 'rectangle' },
    { key: 'o', tool: 'ellipse' },
    { key: 't', tool: 'text' },
    { key: 's', tool: 'sticky' },
    { key: 'd', tool: 'database' },
  ];

  for (const { key, tool } of tools) {
    it(`bare '${key}' resolves to ${tool}`, () => {
      expect(resolveToolShortcut(ev({ key }))).toBe(tool);
    });
    it(`uppercase '${key.toUpperCase()}' also resolves to ${tool}`, () => {
      expect(resolveToolShortcut(ev({ key: key.toUpperCase() }))).toBe(tool);
    });
    it(`'${key}' with metaKey returns null (so Cmd+letter chords pass through)`, () => {
      expect(resolveToolShortcut(ev({ key, metaKey: true }))).toBeNull();
    });
    it(`'${key}' with ctrlKey returns null (so Ctrl+letter chords pass through)`, () => {
      expect(resolveToolShortcut(ev({ key, ctrlKey: true }))).toBeNull();
    });
    it(`'${key}' with shiftKey returns null (Shift+letter is typing)`, () => {
      expect(resolveToolShortcut(ev({ key, shiftKey: true }))).toBeNull();
    });
    it(`'${key}' with altKey returns null`, () => {
      expect(resolveToolShortcut(ev({ key, altKey: true }))).toBeNull();
    });
  }

  it('unrelated keys return null', () => {
    expect(resolveToolShortcut(ev({ key: 'a' }))).toBeNull();
    expect(resolveToolShortcut(ev({ key: 'q' }))).toBeNull();
    expect(resolveToolShortcut(ev({ key: '1' }))).toBeNull();
    expect(resolveToolShortcut(ev({ key: 'Enter' }))).toBeNull();
    expect(resolveToolShortcut(ev({ key: 'Escape' }))).toBeNull();
    expect(resolveToolShortcut(ev({ key: ' ' }))).toBeNull();
  });
});

describe('resolveHistoryChord', () => {
  // Mirrors resolveClipboardChord's gating: Cmd/Ctrl required, Alt rejected,
  // editable-surface aware so native browser undo keeps working inside text
  // fields. Cmd+Y is the Windows-style redo alias for muscle-memory parity.
  it('Cmd+Z (mac) → undo', () => {
    expect(resolveHistoryChord(ev({ key: 'z', metaKey: true }), { isEditableActive: false })).toBe(
      'undo',
    );
  });

  it('Ctrl+Z (non-mac) → undo', () => {
    expect(resolveHistoryChord(ev({ key: 'z', ctrlKey: true }), { isEditableActive: false })).toBe(
      'undo',
    );
  });

  it('Cmd+Shift+Z → redo', () => {
    expect(
      resolveHistoryChord(ev({ key: 'z', metaKey: true, shiftKey: true }), {
        isEditableActive: false,
      }),
    ).toBe('redo');
  });

  it('Ctrl+Y → redo (Windows-style alias)', () => {
    expect(resolveHistoryChord(ev({ key: 'y', ctrlKey: true }), { isEditableActive: false })).toBe(
      'redo',
    );
  });

  it('Ctrl+Shift+Y → null (Shift+Y is unspecified; reject for predictability)', () => {
    expect(
      resolveHistoryChord(ev({ key: 'y', ctrlKey: true, shiftKey: true }), {
        isEditableActive: false,
      }),
    ).toBeNull();
  });

  it('Cmd+Alt+Z → null (Alt rejected)', () => {
    expect(
      resolveHistoryChord(ev({ key: 'z', metaKey: true, altKey: true }), {
        isEditableActive: false,
      }),
    ).toBeNull();
  });

  it('bare Z → null', () => {
    expect(resolveHistoryChord(ev({ key: 'z' }), { isEditableActive: false })).toBeNull();
  });

  it("Cmd+A → null (different key — proves we don't shadow other chords)", () => {
    expect(
      resolveHistoryChord(ev({ key: 'a', metaKey: true }), { isEditableActive: false }),
    ).toBeNull();
  });

  it('isEditableActive: true with Cmd+Z → null (defer to browser)', () => {
    expect(
      resolveHistoryChord(ev({ key: 'z', metaKey: true }), { isEditableActive: true }),
    ).toBeNull();
  });
});

describe('resolveGroupChord (canvas grouping M4)', () => {
  // ⌘G → 'group', ⌘⇧G → 'ungroup'. Same gating as the other chord resolvers:
  // Cmd/Ctrl required, Alt rejected, editable-surface aware. The chord is
  // selection-agnostic — whether the action is valid is decided downstream by
  // planGroupShortcutAction.
  it('Cmd+G (mac) → group', () => {
    expect(resolveGroupChord(ev({ key: 'g', metaKey: true }), { isEditableActive: false })).toBe(
      'group',
    );
  });

  it('Ctrl+G (non-mac) → group', () => {
    expect(resolveGroupChord(ev({ key: 'g', ctrlKey: true }), { isEditableActive: false })).toBe(
      'group',
    );
  });

  it('Cmd+Shift+G → ungroup', () => {
    expect(
      resolveGroupChord(ev({ key: 'g', metaKey: true, shiftKey: true }), {
        isEditableActive: false,
      }),
    ).toBe('ungroup');
  });

  it('uppercase G (Shift normalizes key casing) → still resolves', () => {
    // Some layouts report 'G' for Shift+g; toLowerCase keeps the match alive.
    expect(
      resolveGroupChord(ev({ key: 'G', metaKey: true, shiftKey: true }), {
        isEditableActive: false,
      }),
    ).toBe('ungroup');
  });

  it('Cmd+Alt+G → null (Alt rejected)', () => {
    expect(
      resolveGroupChord(ev({ key: 'g', metaKey: true, altKey: true }), { isEditableActive: false }),
    ).toBeNull();
  });

  it('bare G → null (no modifier; reserved for a future tool key, never bare)', () => {
    expect(resolveGroupChord(ev({ key: 'g' }), { isEditableActive: false })).toBeNull();
  });

  it('Cmd+D → null (Duplicate is a different chord; we never reuse it)', () => {
    expect(
      resolveGroupChord(ev({ key: 'd', metaKey: true }), { isEditableActive: false }),
    ).toBeNull();
  });

  it('isEditableActive: true with Cmd+G → null (defer to browser/typing)', () => {
    expect(
      resolveGroupChord(ev({ key: 'g', metaKey: true }), { isEditableActive: true }),
    ).toBeNull();
  });
});

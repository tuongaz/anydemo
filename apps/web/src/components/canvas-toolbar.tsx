import { IconPickerPopover } from '@/components/icon-picker-popover';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ShapeKind } from '@/lib/api';
import { cn } from '@/lib/utils';
import { type CommandId, getCommandTooltip } from '@seeflow/canvas';
import {
  Circle,
  Cloud,
  Columns3,
  Database,
  Server,
  Shapes,
  Square,
  Sticker,
  StickyNote,
  Type,
  User,
} from 'lucide-react';
import { useState } from 'react';

/**
 * dataTransfer MIME-like type recognised by the canvas drop handler as an
 * htmlNode-create gesture (vs. an OS image-file drop). The toolbar no longer
 * surfaces a draggable tile for it — html nodes are now created via the
 * programmatic createNode REST endpoint (API/LLM path). Kept so the existing
 * drop branch in demo-canvas continues to compile against a single source of
 * truth for the marker literal.
 */
export const HTML_BLOCK_DND_TYPE = 'application/x-seeflow-create-html-block';

export interface CanvasToolbarProps {
  /** Currently armed draw shape, or null when not in draw mode. */
  activeShape: ShapeKind | null;
  /** Toggles draw mode for the given shape; pass null to exit. */
  onSelectShape: (shape: ShapeKind | null) => void;
  /**
   * US-013 (icon picker): controlled-open state for the insert-icon popover.
   * The Insert icon button anchors the IconPickerPopover; the toolbar's parent
   * (demo-canvas) owns the open/close lifecycle so the same slice can serve
   * insert and replace modes from different call sites.
   */
  iconPickerOpen?: boolean;
  /** Open the picker in insert mode. Wired to the toolbar button's click. */
  onOpenIconPicker?: () => void;
  /** Close the picker (outside-click / ESC / programmatic). */
  onCloseIconPicker?: () => void;
  /**
   * Receive the picked icon name. When all four icon-picker props are omitted
   * the Insert icon button is hidden.
   */
  onPickIcon?: (name: string) => void;
}

export interface ToolbarShapeEntry {
  shape: ShapeKind;
  label: string;
  /**
   * US-008: registry CommandId for the matching tool-switch entry. Drives
   * `title` / `aria-label` tooltips through `getCommandTooltip` so a label or
   * shortcut change in COMMANDS propagates without re-editing this file.
   */
  commandId: CommandId;
  Icon: typeof Square;
}

// Top-group primary shapes — the geometric building blocks that sit alongside
// the Shape picker and Icons trigger in the toolbar's first cluster.
const TOP_PRIMARY_SHAPES: ToolbarShapeEntry[] = [
  { shape: 'rectangle', label: 'Rectangle', commandId: 'tool.rectangle', Icon: Square },
  { shape: 'ellipse', label: 'Ellipse', commandId: 'tool.ellipse', Icon: Circle },
];

// Secondary primary shapes — annotation tiles (Sticky, Text) that live in
// their own group below the shape/icon cluster.
const SECONDARY_PRIMARY_SHAPES: ToolbarShapeEntry[] = [
  { shape: 'sticky', label: 'Sticky note', commandId: 'tool.sticky', Icon: StickyNote },
  { shape: 'text', label: 'Text', commandId: 'tool.text', Icon: Type },
];

// Illustrative shapes live behind a single "Shape" toolbar trigger that
// opens a popover. Append-only as more illustrative shapes land.
const ILLUSTRATIVE_SHAPES: ToolbarShapeEntry[] = [
  // US-010: drag-create commits a shapeNode with `data.shape: 'database'`;
  // the ghost preview in demo-canvas.tsx renders <DatabaseShape> directly
  // (not the wrapper chrome) so the preview matches the committed visual.
  { shape: 'database', label: 'Database', commandId: 'tool.database', Icon: Database },
  // US-022: rack-chassis illustrative shape, same ghost-dispatch contract as
  // Database — both consult `ILLUSTRATIVE_SHAPE_RENDERERS` for the SVG to draw.
  { shape: 'server', label: 'Server', commandId: 'tool.server', Icon: Server },
  // US-023: person glyph for actors / end-users in architecture diagrams.
  { shape: 'user', label: 'User', commandId: 'tool.user', Icon: User },
  // US-024: queue glyph for message brokers / FIFO pipelines. The lucide
  // Columns3 icon (3 vertical cells in a frame) is the closest match to the
  // 4-cell capsule rendered on the canvas.
  { shape: 'queue', label: 'Queue', commandId: 'tool.queue', Icon: Columns3 },
  // US-025: cloud glyph for managed services / "the internet" / abstract
  // boundaries. lucide's Cloud icon mirrors the puffy SVG silhouette.
  { shape: 'cloud', label: 'Cloud', commandId: 'tool.cloud', Icon: Cloud },
];

// Combined list, exported so US-015's drop-on-pane popover can list the same
// set of creatable node types (matching icons + labels) without duplicating
// the registry.
export const TOOLBAR_SHAPES: ToolbarShapeEntry[] = [
  ...TOP_PRIMARY_SHAPES,
  ...SECONDARY_PRIMARY_SHAPES,
  ...ILLUSTRATIVE_SHAPES,
];

const INSERT_ICON_LABEL = 'Insert icon';
const SHAPE_PICKER_LABEL = 'Shape';

// US-020: the "Tidy layout" (Auto Align) button used to live here, between the
// shapes and the icon picker. It moved to the bottom-left Controls cluster in
// demo-canvas.tsx so all canvas-view actions (zoom, fit, auto align) live in
// one consistent place. The keyboard shortcut (⌘⇧L) is unchanged.
export function CanvasToolbar({
  activeShape,
  onSelectShape,
  iconPickerOpen,
  onOpenIconPicker,
  onCloseIconPicker,
  onPickIcon,
}: CanvasToolbarProps) {
  // The illustrative-shape picker is self-contained — open state lives in
  // the toolbar since there's no insert/replace mode duality like the icon
  // picker has.
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const illustrativeActive =
    activeShape !== null && ILLUSTRATIVE_SHAPES.some((s) => s.shape === activeShape);

  const renderShapeButton = ({ shape, commandId, Icon }: ToolbarShapeEntry) => {
    const active = activeShape === shape;
    const tooltip = getCommandTooltip(commandId);
    return (
      <button
        key={shape}
        type="button"
        data-testid={`toolbar-shape-${shape}`}
        data-active={active ? 'true' : 'false'}
        aria-pressed={active}
        aria-label={tooltip}
        title={tooltip}
        onClick={() => onSelectShape(active ? null : shape)}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
          active ? 'bg-primary/10 text-primary border border-primary/30' : 'hover:bg-muted',
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  };

  return (
    <div
      data-testid="canvas-toolbar"
      className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-md backdrop-blur"
    >
      {TOP_PRIMARY_SHAPES.map(renderShapeButton)}
      <Popover open={shapePickerOpen} onOpenChange={setShapePickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="toolbar-shape-picker"
            aria-label={SHAPE_PICKER_LABEL}
            aria-pressed={shapePickerOpen || illustrativeActive}
            title={SHAPE_PICKER_LABEL}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
              shapePickerOpen || illustrativeActive
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'hover:bg-muted',
            )}
          >
            <Shapes className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="right"
          sideOffset={6}
          className="w-auto p-1"
          data-testid="shape-picker-popover"
          onOpenAutoFocus={(e) => {
            // Keep keyboard focus on the canvas so the wrapper-level ESC
            // handler still works — mirrors the drop-popover convention.
            e.preventDefault();
          }}
        >
          <div role="menu" aria-label="More shapes" className="flex flex-col gap-0.5">
            {ILLUSTRATIVE_SHAPES.map(({ shape, label, commandId, Icon }) => {
              const active = activeShape === shape;
              const tooltip = getCommandTooltip(commandId);
              return (
                <button
                  key={shape}
                  type="button"
                  role="menuitem"
                  data-testid={`shape-picker-${shape}`}
                  data-active={active ? 'true' : 'false'}
                  aria-pressed={active}
                  aria-label={tooltip}
                  title={tooltip}
                  onClick={() => {
                    onSelectShape(active ? null : shape);
                    setShapePickerOpen(false);
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                    active
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'hover:bg-muted focus:bg-muted focus:outline-none',
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {onPickIcon ? (
        <IconPickerPopover
          open={iconPickerOpen ?? false}
          onOpenChange={(next) => {
            if (next) onOpenIconPicker?.();
            else onCloseIconPicker?.();
          }}
          anchor={
            <button
              type="button"
              data-testid="toolbar-insert-icon"
              aria-label={INSERT_ICON_LABEL}
              aria-pressed={iconPickerOpen ?? false}
              title={INSERT_ICON_LABEL}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
                iconPickerOpen
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'hover:bg-muted',
              )}
            >
              <Sticker className="h-4 w-4" aria-hidden="true" />
            </button>
          }
          onPick={onPickIcon}
        />
      ) : null}
      <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />
      {SECONDARY_PRIMARY_SHAPES.map(renderShapeButton)}
    </div>
  );
}

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useState,
} from 'react';
import { IconPickerPopover } from '../../components/icon-picker-popover.tsx';
import { IconRenderer } from '../../components/icon-renderer.tsx';
import { InlineEdit } from '../../components/inline-edit.tsx';
import { useCanvasStudio } from '../../lib/canvas-studio-context.tsx';
import { cn } from '../../lib/cn.ts';
import { colorTokenStyle } from '../../lib/color-tokens.ts';
import { resolveFontStack } from '../../lib/font-stacks.ts';
import type { ColorToken, FontFamilyToken } from '../../types.ts';

export interface NodeHeaderProps {
  nodeId: string;
  /** Pass '' for the empty/placeholder state. */
  name: string;
  icon?: string | null;
  selected?: boolean;
  fontSize?: number;
  /** Curated font-family token; resolved to a CSS stack via FONT_STACKS. */
  fontFamily?: FontFamilyToken;
  /**
   * Node body color. When set to a painted token (anything other than
   * `'default'` / `'none'` / undefined), the header paints itself at the
   * theme's saturated header HSL so it reads as a proper title bar over the
   * body's pastel fill, and the title text auto-adapts for contrast via
   * `'node-header-text'`.
   */
  backgroundColor?: ColorToken;
  /** When omitted, the title is read-only. */
  onNameChange?: (nodeId: string, name: string) => void;
  /** When omitted (or selected/icon falsy), the icon is read-only. */
  onIconChange?: (nodeId: string, name: string | null) => void;
  /** Rightmost slot; pushed to the right by the title's flex-1. */
  trailing?: ReactNode;
  testId?: string;
  titleTestId?: string;
}

export function NodeHeader({
  nodeId,
  name,
  icon,
  selected,
  fontSize,
  fontFamily,
  backgroundColor,
  onNameChange,
  onIconChange,
  trailing,
  testId = 'node-header',
  titleTestId = 'node-title',
}: NodeHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  // Vendor-prefixed icon ids (`aws:lambda`, `gcp:cloud-run`, `azure:functions`,
  // `iconify:…`) resolve through IconRenderer's svg-url / iconify branches,
  // which need the studio base URL. Bundled Lucide names ignore it.
  const { studioBaseUrl } = useCanvasStudio();

  const nameEditable = !!onNameChange;
  const iconEditable = !!onIconChange && !!selected && !!icon;

  // When the host node is painted with a color token, paint the header at
  // the theme's mid-saturated HSL and adapt the title text for contrast.
  // When unset (or `'default'` / `'none'`), the Tailwind `sf:bg-muted`
  // fallback paints the header.
  const headerColored =
    backgroundColor !== undefined && backgroundColor !== 'default' && backgroundColor !== 'none';
  const headerBackgroundStyle = headerColored
    ? colorTokenStyle(backgroundColor, 'node-header')
    : undefined;
  const adaptedTextStyle = headerColored
    ? colorTokenStyle(backgroundColor, 'node-header-text')
    : undefined;

  // Resolve the curated font token once; unset → undefined → property omitted
  // so the title inherits the canvas default font.
  const fontStack = resolveFontStack(fontFamily);
  const labelFontStyle: CSSProperties = {
    ...(fontSize !== undefined ? { fontSize: `${fontSize}px` } : {}),
    ...(fontStack ? { fontFamily: fontStack } : {}),
    ...adaptedTextStyle,
  };

  const handleDoubleClick = nameEditable
    ? (e: ReactMouseEvent<HTMLDivElement>) => {
        if (editing) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('.react-flow__handle')) return;
        if (target?.closest('.react-flow__resize-control')) return;
        if (target?.closest('[data-testid="node-header-icon-trigger"]')) return;
        e.stopPropagation();
        setEditing(true);
      }
    : undefined;

  return (
    <div
      data-testid={testId}
      className={cn(
        'sf:flex sf:shrink-0 sf:items-center sf:gap-2 sf:px-1.5 sf:py-1.5',
        headerColored ? '' : 'sf:bg-muted',
      )}
      style={headerBackgroundStyle}
      onDoubleClick={handleDoubleClick}
    >
      {icon ? (
        iconEditable && onIconChange ? (
          <IconPickerPopover
            open={iconPickerOpen}
            onOpenChange={setIconPickerOpen}
            onPick={(picked) => {
              onIconChange(nodeId, picked);
              setIconPickerOpen(false);
            }}
            anchor={
              <button
                type="button"
                data-testid="node-header-icon-trigger"
                aria-label="Change icon"
                aria-pressed={iconPickerOpen}
                className={cn(
                  'sf:inline-flex sf:shrink-0 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded-sm sf:bg-transparent sf:p-0 sf:transition-shadow',
                  'sf:hover:ring-2 sf:hover:ring-ring/40 sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring',
                )}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <IconRenderer
                  iconId={icon}
                  studioBaseUrl={studioBaseUrl}
                  className="sf:h-4 sf:w-4"
                  color={adaptedTextStyle?.color}
                />
              </button>
            }
          />
        ) : (
          <IconRenderer
            iconId={icon}
            studioBaseUrl={studioBaseUrl}
            className="sf:h-4 sf:w-4 sf:shrink-0"
            color={adaptedTextStyle?.color}
          />
        )
      ) : null}
      <div
        data-testid={titleTestId}
        className={cn(
          'sf:min-w-0 sf:flex-1 sf:wrap-break-word sf:whitespace-pre-wrap sf:text-[18px] sf:font-semibold sf:leading-tight sf:text-foreground/90',
          nameEditable && !editing ? 'sf:hover:opacity-80' : '',
          !name && !editing ? 'sf:italic sf:text-muted-foreground/40' : '',
        )}
        style={labelFontStyle}
      >
        {editing && onNameChange ? (
          <InlineEdit
            initialValue={name}
            field="node-name"
            commitMode="blur-only"
            onCommit={(v) => onNameChange(nodeId, v)}
            onExit={() => setEditing(false)}
            className="sf:text-[18px] sf:font-semibold sf:text-foreground/90"
            style={labelFontStyle}
            placeholder="Name"
          />
        ) : (
          name
        )}
      </div>
      {trailing}
    </div>
  );
}

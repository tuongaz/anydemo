import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, memo } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import type { ColorToken, GroupNodeData } from '../types.ts';

/**
 * Runtime data attached to a group node by the canvas host.
 *
 * A group is a near-CHROME-LESS container (Miro-style): it paints NO background
 * and NO title header. It DOES paint a thin, user-stylable BORDER (default gray)
 * so an unselected group reads as a visible container instead of vanishing —
 * width + color are editable via the StyleStrip and `borderSize: 0` removes it
 * (`backgroundColor`/`cornerRadius`/`shadow` are still intentionally not read).
 * Beyond the border its on-canvas presence is a hit-area — clicking the group's
 * empty band selects it as a unit (M5 group-move) — plus the four connection
 * handles that make a group a connector endpoint (M8). The selection treatment
 * (a padded dashed marquee with 4 corner resize handles) is drawn ENTIRELY by
 * `<SelectionResizeOverlay>` when the group is selected, so a selected group's
 * selection chrome looks IDENTICAL to a transient multi-select.
 */
export type GroupNodeRuntimeData = GroupNodeData & {
  /**
   * Canvas grouping M6: true when this group is ENTERED (isolation). The host's
   * `buildNode` sets it for the single active group. When true the hit-area
   * becomes click-through (`pointer-events:none`) so members underneath — and
   * the empty pane in the band around them — are reachable (→ select a member /
   * exit), and a faint dashed outline marks the entered bounds. Absent/false →
   * the area captures clicks and selects the group as a unit.
   */
  active?: boolean;
} & Record<string, unknown>;

export type GroupNodeType = Node<GroupNodeRuntimeData, 'group'>;

/** Fallback box size for a group with no persisted width/height. */
export const GROUP_DEFAULT_SIZE = { width: 320, height: 220 } as const;

/**
 * Default border for a group when `data.borderSize` is unset: a thin, clearly
 * visible neutral-gray outline so an UNSELECTED group reads as a container
 * (fully chrome-less left it invisible). Both are user-overridable via the
 * StyleStrip — `borderSize: 0` removes the border entirely. The color is the
 * `'gray'` palette token (a mid-gray accent) rather than the near-invisible
 * theme `--border`, so the "default gray" actually shows on a white canvas.
 * Exported so the StyleStrip's group branch seeds its sliders from the same
 * source of truth.
 */
export const GROUP_DEFAULT_BORDER_SIZE = 1;
export const GROUP_DEFAULT_BORDER_COLOR: ColorToken = 'gray';

/**
 * Z-INDEX CONTRACT (design §9.6, §12.4): a group MUST paint BEHIND its members
 * (and behind the connector edges that sit at zIndex 0). The host's `buildNode`
 * assigns this value to `node.zIndex` for `type:'group'` so the stack is:
 *
 *   group (-1)  <  edges (0) = members (undefined → 0)  <  selected chrome
 *
 * A NEGATIVE value (not just "lower than members") is required because every
 * other node leaves `zIndex` undefined, which xyflow treats as 0; an equal 0
 * would let DOM order decide and a group authored last would paint ON TOP of
 * its members. `elevateNodesOnSelect={false}` (already set on <ReactFlow>) plus
 * the `.react-flow__node-group` carve-out in index.css keep this value stable
 * even while the group is selected. Exported so `buildNode` and the M1 z-order
 * test share one source of truth.
 */
export const GROUP_NODE_Z_INDEX = -1;

function GroupNodeImpl({ data, selected, isConnectable }: NodeProps<GroupNodeType>) {
  const title = data.name ?? '';
  const sized = data.width !== undefined || data.height !== undefined;
  // Canvas grouping M6: this group is ENTERED (isolation). Drives the
  // click-through hit-area + the faint "entered" outline below.
  const active = data.active === true;

  // Group border (user-stylable via the StyleStrip). Defaults to a thin gray
  // outline so an unselected group is a visible container; `borderSize: 0`
  // removes it. Drawn on THIS inner div (not the `.react-flow__node-group`
  // wrapper, which index.css force-resets to `border:none`), with `box-border`
  // so the stroke sits inside the group's footprint and stays flush with the
  // member band. `backgroundColor`/`cornerRadius`/`shadow` remain unread.
  const borderSize = data.borderSize ?? GROUP_DEFAULT_BORDER_SIZE;
  const borderColorToken = data.borderColor ?? GROUP_DEFAULT_BORDER_COLOR;
  // `'none'` is the explicit "no border color" pick from the StyleStrip swatch —
  // it removes the border entirely (NOT the neutral-gray outline colorTokenStyle
  // hands a normal node's `'none'`). A width of 0 removes it too.
  const showBorder = borderSize > 0 && borderColorToken !== 'none';
  const groupBorder: CSSProperties = showBorder
    ? {
        borderWidth: borderSize,
        borderStyle: data.borderStyle ?? 'solid',
        borderColor: colorTokenStyle(borderColorToken, 'node').borderColor,
      }
    : {};

  const containerStyle: CSSProperties = {
    // The group draws no fill/header — it is a (bordered) hit-area + connector
    // anchor. When unsized, fall back to a default box so the wrapper has a
    // footprint to hit-test and anchor handles against.
    ...groupBorder,
    ...(sized ? {} : { width: GROUP_DEFAULT_SIZE.width, height: GROUP_DEFAULT_SIZE.height }),
    // M6 isolation: the hit-area becomes CLICK-THROUGH so a click in the band
    // around members falls to the empty pane (→ exit) and members underneath
    // are reachable. A subtle dashed outline marks the entered bounds — drawn
    // with `outline` (CSS-light: no layout impact, no extra element, no z-index
    // churn). The `data-active` attribute is the stable test/app hook.
    ...(active
      ? {
          pointerEvents: 'none' as const,
          outline: '1px dashed hsl(var(--primary) / 0.5)',
          outlineOffset: '0px',
        }
      : {}),
  };

  return (
    <div
      className={cn('sf:box-border', sized ? 'sf:h-full sf:w-full' : '')}
      style={containerStyle}
      data-testid="group-node"
      data-node-type="group"
      // M6: stable hook for tests + the live app to detect isolation entry. Only
      // present (="true") while this group is the active/entered one.
      data-active={active ? 'true' : undefined}
      // The group's accessible name comes from its (optional) title so screen
      // readers can still announce it, even though no visible header is drawn.
      // No explicit ARIA role — a `role` on a generic <div> trips biome's
      // useSemanticElements and the group carries no interactive semantics of
      // its own (selection/drag come from the React Flow node wrapper).
      aria-label={title || 'Group'}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
    </div>
  );
}

function arePropsEqual(prev: NodeProps<GroupNodeType>, next: NodeProps<GroupNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const GroupNode = memo(GroupNodeImpl, arePropsEqual);

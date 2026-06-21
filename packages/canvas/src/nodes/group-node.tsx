import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, memo } from 'react';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import type { GroupNodeData } from '../types.ts';
import { NodeHeader } from './lib/node-header.tsx';

/**
 * Runtime data attached to a group node by the canvas host. Extends the
 * persisted GroupNodeData with the field-edit callbacks the canvas injects via
 * `buildNode`. M7 wires inline title editing (`onNameChange`) + the optional
 * title glyph (`onIconChange`); both are present in edit mode and absent in
 * view/mini (→ the title renders read-only there).
 */
export type GroupNodeRuntimeData = GroupNodeData & {
  /**
   * Persist a new title (PATCH /nodes/:id { name }). Wired in M7 via `buildNode`
   * (edit mode only). When present, NodeHeader's dblclick-to-edit path is active
   * AND it `stopPropagation()`s the dblclick so it never bubbles to the
   * ReactFlow `onNodeDoubleClick` group-ENTER handler (M6) — i.e. dblclick on the
   * TITLE edits, dblclick on the BODY enters isolation (design §7 guardrail).
   */
  onNameChange?: (nodeId: string, name: string) => void;
  /** Change the optional title glyph (PATCH /nodes/:id { icon }). Wired in M7 (edit mode only). */
  onIconChange?: (nodeId: string, icon: string | null) => void;
  /**
   * Canvas grouping M6: true when this group is ENTERED (isolation). The host's
   * `buildNode` sets it for the single active group. When true the container's
   * fill becomes click-through (`pointer-events:none`) so members underneath the
   * chrome — and the empty pane in the padding band — are reachable; only the
   * title band stays interactive (the exit affordance). Absent/false → the box
   * captures clicks and selects the group as a unit (M5 group-move).
   */
  active?: boolean;
} & Record<string, unknown>;

export type GroupNodeType = Node<GroupNodeRuntimeData, 'group'>;

/** Fallback box size for a group with no persisted width/height. */
export const GROUP_DEFAULT_SIZE = { width: 320, height: 220 } as const;

/**
 * Default corner radius for the group container when `data.cornerRadius` is
 * unset. A group reads as a soft container rather than a hard-edged card, so it
 * carries a gentler default than the geometric nodes (which fall back to the
 * renderer's CSS radius).
 */
const GROUP_DEFAULT_CORNER_RADIUS = 12;

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
 * even while the group is selected — v1's worst z-index landmine is structurally
 * absent here. Exported so `buildNode` and the M1 z-order test share one source
 * of truth.
 */
export const GROUP_NODE_Z_INDEX = -1;

function GroupNodeImpl({ id, data, selected, isConnectable }: NodeProps<GroupNodeType>) {
  const title = data.name ?? '';
  const sized = data.width !== undefined || data.height !== undefined;
  // Canvas grouping M6: this group is ENTERED (isolation). Drives the
  // click-through fill + the "entered" affordance below.
  const active = data.active === true;

  // When data.shadow is set, paint `var(--node-shadow-N)` inline and drop the
  // baseline class so the two don't compose (mirrors rectangle-node).
  const shadowClass = data.shadow !== undefined ? '' : 'sf:shadow-sm';
  const cornerRadius =
    data.cornerRadius !== undefined ? data.cornerRadius : GROUP_DEFAULT_CORNER_RADIUS;

  const containerStyle: CSSProperties = {
    // Border + background derived from the shared color tokens, exactly like
    // rectangle-node / geometric-node so a group styles identically to a card.
    borderColor: colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
    borderWidth: data.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data.borderStyle,
    borderRadius: cornerRadius,
    ...(data.shadow !== undefined ? { boxShadow: `var(--node-shadow-${data.shadow})` } : {}),
    ...(sized ? {} : { width: GROUP_DEFAULT_SIZE.width, height: GROUP_DEFAULT_SIZE.height }),
    // M6 isolation: the fill becomes CLICK-THROUGH so a click on the padding
    // band falls to the empty pane (→ exit) and members underneath the chrome
    // are reachable. The title band re-enables pointer-events on its own wrapper
    // below (the exit affordance). Members are separate top-level DOM nodes (the
    // group is z = -1), so they are unaffected by this. No z-index gymnastics.
    ...(active ? { pointerEvents: 'none' as const } : {}),
    // "Entered" affordance: a subtle primary-tinted ring drawn with `outline`
    // (CSS-light — outline doesn't affect layout and needs no extra element or
    // z-index). The `data-active` attribute below is the stable test hook.
    ...(active ? { outline: '2px solid hsl(var(--primary) / 0.55)', outlineOffset: '2px' } : {}),
  };

  return (
    <div
      className={cn(
        'sf:group sf:flex sf:flex-col sf:overflow-hidden sf:border-[3px] sf:transition-shadow',
        shadowClass,
        sized ? 'sf:h-full sf:w-full' : '',
      )}
      style={containerStyle}
      data-testid="group-node"
      data-node-type="group"
      // M6: stable hook for tests + the live app to detect isolation entry. Only
      // present (="true") while this group is the active/entered one.
      data-active={active ? 'true' : undefined}
      // The container's accessible name comes from its title so screen readers
      // announce the group (mirrors the a11y convention in design §12.11). We
      // give the box an aria-label but no explicit ARIA role — a plain `role`
      // on a generic <div> trips biome's useSemanticElements, and the visible
      // title (NodeHeader) already carries the readable name.
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
      {/* Title band — sits in the group's top padding band (GROUP_TITLE_BAND_PX,
          reserved above the topmost member by computeGroupBox) so it never
          overlaps members, which render as sibling nodes ON TOP of this box (the
          group sits at zIndex -1). NodeHeader renders the title + optional icon
          and, with `onNameChange`/`onIconChange` wired by buildNode (M7, edit
          mode), supports inline title rename + icon edit. NodeHeader's
          dblclick-to-edit handler `stopPropagation()`s so a dblclick on the title
          edits and never bubbles to the M6 group-ENTER handler (title=edit,
          body=enter). M6: when the container fill is click-through (active),
          re-enable pointer-events on JUST the title band so it stays the
          interactive exit affordance (and the rename target). `display:contents`
          keeps the wrapper layout-neutral when inactive. */}
      <div
        style={active ? { pointerEvents: 'auto' } : { display: 'contents' }}
        data-testid="group-node-titlebar"
      >
        <NodeHeader
          nodeId={id}
          name={title}
          icon={data.icon}
          selected={selected}
          fontSize={data.fontSize}
          backgroundColor={data.backgroundColor}
          onNameChange={data.onNameChange}
          onIconChange={data.onIconChange}
          testId="group-node-header"
          titleTestId="group-node-title"
        />
      </div>
      {/* The padded gap below the title band IS the group's chrome — members
          render as ordinary sibling nodes ON TOP of this box (the group sits at
          a negative zIndex). This milestone draws no body content. */}
      <div className="sf:min-h-0 sf:flex-1" data-testid="group-node-body" />
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

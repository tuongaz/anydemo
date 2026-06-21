import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, memo } from 'react';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import type { GroupNodeData } from '../types.ts';
import { NodeHeader } from './lib/node-header.tsx';

/**
 * Runtime data attached to a group node by the canvas host. Extends the
 * persisted GroupNodeData with the name-edit callback the canvas injects in
 * later milestones. M1 renders the group READ-ONLY (no `onNameChange` wired),
 * so the title is display-only here; M7 wires inline title editing + styling.
 */
export type GroupNodeRuntimeData = GroupNodeData & {
  /** Persist a new title (PATCH /nodes/:id { name }). Wired in M7; absent in M1 → title is read-only. */
  onNameChange?: (nodeId: string, name: string) => void;
  /** Change the optional title glyph. Wired in M7. */
  onIconChange?: (nodeId: string, icon: string | null) => void;
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
      {/* Title band — read-only this milestone (no onNameChange/onIconChange
          wired by the host yet). NodeHeader renders the title + optional icon
          and inherits the editable-field a11y once M7 wires the callbacks. */}
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

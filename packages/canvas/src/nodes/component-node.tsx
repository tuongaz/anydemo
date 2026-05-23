import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, memo } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import type { ComponentNodeData } from '../types.ts';
import { Icon } from '../ui/icon.tsx';
import { ComponentRuntime } from './component-runtime.tsx';
import { ResizeControls } from './resize-controls.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';

export type ComponentNodeRuntimeData = ComponentNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  onResizeEnd?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  /** Threaded from the host so script-kind actions know which flow to POST against. */
  flowId?: string;
  /** Override for the action-dispatch base URL. Defaults to '/api' in ComponentRuntime. */
  apiBaseUrl?: string;
} & Record<string, unknown>;
export type ComponentNodeType = Node<ComponentNodeRuntimeData, 'component'>;

export const COMPONENT_DEFAULT_SIZE = { width: 320, height: 240 } as const;

const MIN_W = 80;
const MIN_H = 40;

const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

function ComponentNodeImpl({ id, data, selected, isConnectable }: NodeProps<ComponentNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
  });
  const autoSize = data.autoSize ?? false;
  const userSized = isResizing || !autoSize;

  // Chrome lives on the inner wrapper so its `overflow:hidden` clips body
  // content to the rounded corners without clipping connector handles + resize
  // corners on the outer wrapper (same split as HtmlNode).
  const chromeStyle: CSSProperties = {
    ...(data.backgroundColor !== undefined
      ? { backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor }
      : {}),
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderSize !== undefined ? { borderWidth: data.borderSize } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...colorTokenStyle(data.textColor, 'text'),
  };

  const outerStyle: CSSProperties = userSized
    ? {
        width: data.width ?? COMPONENT_DEFAULT_SIZE.width,
        height: data.height ?? COMPONENT_DEFAULT_SIZE.height,
      }
    : {};

  return (
    <div
      className={cn('sf:group sf:relative', userSized ? 'sf:h-full sf:w-full' : '')}
      style={outerStyle}
      data-testid="component-node"
      data-node-type="component"
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      <div
        data-testid="component-node-chrome"
        className="sf:h-full sf:w-full sf:overflow-hidden"
        style={chromeStyle}
      >
        <div data-testid="component-node-body" className="sf:h-full sf:w-full sf:overflow-auto">
          <ComponentRuntime
            spec={data.spec}
            nodeId={id}
            flowId={data.flowId}
            apiBaseUrl={data.apiBaseUrl}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      {data.name !== undefined && data.name !== '' ? (
        <div
          data-testid="component-node-label"
          className="sf:-bottom-5 sf:absolute sf:right-0 sf:left-0 sf:truncate sf:text-center sf:text-[11px] sf:text-muted-foreground"
        >
          {data.icon ? (
            <div className="sf:flex sf:items-center sf:justify-center sf:gap-1">
              <Icon name={data.icon} size={12} aria-hidden />
              <span className="truncate">{data.name}</span>
            </div>
          ) : (
            data.name
          )}
        </div>
      ) : null}
    </div>
  );
}

function arePropsEqual(
  prev: NodeProps<ComponentNodeType>,
  next: NodeProps<ComponentNodeType>,
): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const ComponentNode = memo(ComponentNodeImpl, arePropsEqual);

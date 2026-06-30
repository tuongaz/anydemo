import {
  type ControlPosition,
  Handle,
  type Node,
  type NodeProps,
  NodeResizeControl,
  type OnResizeStart,
  Position,
  ResizeControlVariant,
} from '@xyflow/react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useRef,
  useState,
} from 'react';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import { resolveFontStack } from '../lib/font-stacks.ts';
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  TABLE_DEFAULT_COLS,
  TABLE_DEFAULT_ROWS,
  addColumn,
  addRow,
  cellKey,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  resizeColumn,
  resizeRow,
  scaleTableTo,
  setCell,
  toggleHeaderRow,
} from '../lib/table-ops.ts';
import type { TableColumn, TableNodeData, TableRow } from '../types.ts';
import { useResizeGesture } from './use-resize-gesture.ts';

/** Derived footprint of the default 3×3 table — handed to the create callback. */
export const TABLE_DEFAULT_SIZE = {
  width: TABLE_DEFAULT_COLS * DEFAULT_COL_WIDTH,
  height: TABLE_DEFAULT_ROWS * DEFAULT_ROW_HEIGHT,
};

/** The structural slice the host persists on every table edit (one updateNode). */
export interface TablePatch {
  columns: TableColumn[];
  rows: TableRow[];
  cells: Record<string, string>;
  headerRow?: boolean;
}

/**
 * Runtime data attached to a table node by the canvas host. Extends the
 * persisted TableNodeData with the single commit callback the canvas injects in
 * edit mode (wired to `adapter.updateNode`) plus the shared `setResizing` gate.
 * When `onTableDataChange` is absent (view / mini) the table renders fully
 * static — no edit, resize, or add/remove affordances.
 */
export type TableNodeRuntimeData = TableNodeData & {
  onTableDataChange?: (nodeId: string, patch: TablePatch) => void;
  /** Shared resize gate injected by the canvas; freezes rfNodes during a drag. */
  setResizing?: (on: boolean) => void;
} & Record<string, unknown>;
export type TableNodeType = Node<TableNodeRuntimeData, 'table'>;

const structural = (d: TableNodeData): TablePatch => ({
  columns: d.columns,
  rows: d.rows,
  cells: d.cells,
  ...(d.headerRow !== undefined ? { headerRow: d.headerRow } : {}),
});

// Column/row ids only need to be unique within the table; `crypto.randomUUID`
// is available in every browser + Bun the canvas targets.
const newColId = (): string => `c${crypto.randomUUID().slice(0, 8)}`;
const newRowId = (): string => `r${crypto.randomUUID().slice(0, 8)}`;

const cumulative = (sizes: number[]): number[] => {
  const out: number[] = [];
  let acc = 0;
  for (const s of sizes) {
    acc += s;
    out.push(acc);
  }
  return out;
};

interface DividerState {
  axis: 'col' | 'row';
  id: string;
  start: number;
  startSize: number;
}

// Whole-table resize affordances — only the origin-preserving edges/corner so a
// drag never shifts the node's x/y (the table footprint is derived from its
// columns/rows; there is no persisted position to move). Mirrors the visible
// selection-rect handle styling from `resize-controls.tsx`.
const RESIZE_RIGHT_STYLE: CSSProperties = { width: 8, borderColor: 'transparent' };
const RESIZE_BOTTOM_STYLE: CSSProperties = { height: 8, borderColor: 'transparent' };
const RESIZE_CORNER_STYLE: CSSProperties = {
  width: 'calc(10px / var(--rf-zoom, 1))',
  height: 'calc(10px / var(--rf-zoom, 1))',
  background: 'hsl(var(--background))',
  border: 'calc(1px / var(--rf-zoom, 1)) solid hsl(var(--primary) / 0.6)',
  borderRadius: 'calc(2px / var(--rf-zoom, 1))',
  zIndex: 1,
};
const TABLE_RESIZE_HANDLES: Array<{
  position: ControlPosition;
  variant: ResizeControlVariant;
  style: CSSProperties;
}> = [
  { position: 'right', variant: ResizeControlVariant.Line, style: RESIZE_RIGHT_STYLE },
  { position: 'bottom', variant: ResizeControlVariant.Line, style: RESIZE_BOTTOM_STYLE },
  { position: 'bottom-right', variant: ResizeControlVariant.Handle, style: RESIZE_CORNER_STYLE },
];

// Add-button geometry. The four "+" buttons sit just OUTSIDE each edge, pushed
// off the edge midpoint by ADD_CLEAR so they never hide behind the centred
// connection handle (the "marquee circle"). ADD_SIZE matches the rendered
// h-6/w-6 button so the left/top buttons clear the table by ADD_GAP too.
const ADD_SIZE = 24;
const ADD_GAP = 6;
const ADD_CLEAR = 18;

function TableNodeImpl({ id, data, selected, isConnectable }: NodeProps<TableNodeType>) {
  const editable = !!data.onTableDataChange;
  // Live draft while dragging a column/row border OR scaling the whole table;
  // committed on pointer-up.
  const [draft, setDraft] = useState<TableNodeData | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null);
  const dividerRef = useRef<DividerState | null>(null);
  // Always-current data for the reference-stable resize-start handler below.
  const dataRef = useRef(data);
  dataRef.current = data;
  // Columns/rows frozen at whole-table-resize start so each tick scales from the
  // original geometry (never from the previous tick's output — avoids compounding).
  const startTableRef = useRef<{ columns: TableColumn[]; rows: TableRow[] } | null>(null);

  const view = draft ?? data;
  const { columns, rows, cells } = view;
  const headerRow = view.headerRow === true;

  const colOffsets = cumulative(columns.map((c) => c.width));
  const rowOffsets = cumulative(rows.map((r) => r.height));
  const totalW = columns.reduce((sum, c) => sum + c.width, 0);
  const totalH = rows.reduce((sum, r) => sum + r.height, 0);

  const commit = (next: TableNodeData) => data.onTableDataChange?.(id, structural(next));

  // --- Whole-table resize (drag the right / bottom edge or the corner) -------
  const {
    isResizing,
    onResizeStart: gestureResizeStart,
    onResizeEvent,
    onResizeEnd: gestureResizeEnd,
  } = useResizeGesture({
    onResize: (dims) => {
      const start = startTableRef.current;
      if (!start) return;
      setDraft(
        scaleTableTo(
          { ...dataRef.current, columns: start.columns, rows: start.rows },
          dims.width,
          dims.height,
        ),
      );
    },
    onResizeEnd: () => {
      startTableRef.current = null;
      setDraft((d) => {
        if (d) commit(d);
        return null;
      });
    },
    setResizing: data.setResizing,
    nodeId: id,
  });
  const onTableResizeStart = useCallback<OnResizeStart>(
    (e, params) => {
      const d = dataRef.current;
      startTableRef.current = { columns: d.columns, rows: d.rows };
      gestureResizeStart(e, params);
    },
    [gestureResizeStart],
  );

  const fontStack = resolveFontStack(data.fontFamily);
  const align = data.textAlign ?? 'center';
  const justifyClass =
    align === 'left'
      ? 'sf:justify-start'
      : align === 'right'
        ? 'sf:justify-end'
        : 'sf:justify-center';
  const baseTextStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...(fontStack ? { fontFamily: fontStack } : {}),
    textAlign: align,
  };

  const borderColorValue = colorTokenStyle(data.borderColor, 'node').borderColor ?? 'var(--border)';
  const wrapperStyle: CSSProperties = {
    width: totalW,
    height: totalH,
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
    borderColor: borderColorValue,
    borderWidth: data.borderSize !== undefined ? data.borderSize : 1,
    borderStyle: data.borderStyle ?? 'solid',
    borderRadius: data.cornerRadius !== undefined ? data.cornerRadius : 6,
    ...(data.shadow !== undefined ? { boxShadow: `var(--node-shadow-${data.shadow})` } : {}),
    gridTemplateColumns: columns.map((c) => `${c.width}px`).join(' '),
    gridTemplateRows: rows.map((r) => `${r.height}px`).join(' '),
  };

  // --- Column/row border-drag (resizes a single column/row) ------------------
  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>, st: DividerState) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    dividerRef.current = st;
    data.setResizing?.(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDividerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dividerRef.current;
    if (!st) return;
    e.stopPropagation();
    if (st.axis === 'col') {
      setDraft(resizeColumn(data, st.id, st.startSize + (e.clientX - st.start)));
    } else {
      setDraft(resizeRow(data, st.id, st.startSize + (e.clientY - st.start)));
    }
  };
  const onDividerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dividerRef.current;
    if (!st) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    dividerRef.current = null;
    data.setResizing?.(false);
    setDraft((d) => {
      if (d) commit(d);
      return null;
    });
  };

  const handleClass = cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!');
  // Add/remove chrome surfaces only while the table node is selected (edit mode).
  const showChrome = editable && selected;
  const ctlBtn =
    'nodrag sf:absolute sf:z-20 sf:flex sf:h-4 sf:w-4 sf:items-center sf:justify-center sf:rounded sf:bg-muted sf:text-[11px] sf:leading-none sf:text-muted-foreground sf:shadow-sm';

  return (
    <div
      className="sf:relative"
      style={{ width: totalW, height: totalH }}
      data-testid="table-node"
      data-node-type="table"
      data-resizing={isResizing ? 'true' : undefined}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={handleClass}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={handleClass}
      />

      <div className="sf:grid sf:overflow-hidden" style={wrapperStyle}>
        {rows.map((row, rIdx) =>
          columns.map((col) => {
            const key = cellKey(row.id, col.id);
            const text = cells[key] ?? '';
            const isHeader = headerRow && rIdx === 0;
            const isEditingCell = editing?.rowId === row.id && editing?.colId === col.id;
            return (
              <div
                key={key}
                className={cn(
                  'sf:flex sf:min-w-0 sf:items-center sf:overflow-hidden sf:border-r sf:border-b sf:px-2 sf:py-1 sf:text-[13px]',
                  justifyClass,
                  isHeader ? 'sf:bg-muted sf:font-bold' : '',
                )}
                style={{ ...baseTextStyle, borderColor: borderColorValue }}
                data-testid="table-cell"
                data-cell={key}
                onDoubleClick={
                  editable
                    ? (ev) => {
                        ev.stopPropagation();
                        setEditing({ rowId: row.id, colId: col.id });
                      }
                    : undefined
                }
              >
                {isEditingCell && editable ? (
                  <InlineEdit
                    initialValue={text}
                    field="table-cell"
                    onCommit={(v) => commit(setCell(data, row.id, col.id, v))}
                    onExit={() => setEditing(null)}
                    className="sf:w-full"
                    style={baseTextStyle}
                  />
                ) : (
                  <span className="sf:block sf:truncate">{text}</span>
                )}
              </div>
            );
          }),
        )}
      </div>

      {/* Internal column dividers (n-1). Dragging boundary i resizes column i.
          The outer right edge is reserved for the whole-table resize handle. */}
      {editable
        ? columns.slice(0, -1).map((col, i) => (
            <div
              key={`colh-${col.id}`}
              data-testid="table-col-resize"
              data-col={col.id}
              className="nodrag sf:absolute sf:top-0 sf:z-10 sf:h-full sf:w-[7px] sf:cursor-col-resize"
              style={{ left: (colOffsets[i] ?? 0) - 3 }}
              onPointerDown={(e) =>
                onDividerDown(e, {
                  axis: 'col',
                  id: col.id,
                  start: e.clientX,
                  startSize: col.width,
                })
              }
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
            />
          ))
        : null}

      {/* Internal row dividers (n-1). */}
      {editable
        ? rows.slice(0, -1).map((row, i) => (
            <div
              key={`rowh-${row.id}`}
              data-testid="table-row-resize"
              data-row={row.id}
              className="nodrag sf:absolute sf:left-0 sf:z-10 sf:h-[7px] sf:w-full sf:cursor-row-resize"
              style={{ top: (rowOffsets[i] ?? 0) - 3 }}
              onPointerDown={(e) =>
                onDividerDown(e, {
                  axis: 'row',
                  id: row.id,
                  start: e.clientY,
                  startSize: row.height,
                })
              }
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
            />
          ))
        : null}

      {/* Whole-table resize — origin-preserving edges + corner, shown on select. */}
      {editable && selected
        ? TABLE_RESIZE_HANDLES.map(({ position, variant, style }) => (
            <NodeResizeControl
              key={position}
              position={position}
              variant={variant}
              minWidth={columns.length * MIN_COL_WIDTH}
              minHeight={rows.length * MIN_ROW_HEIGHT}
              style={style}
              autoScale={variant === ResizeControlVariant.Line}
              onResizeStart={onTableResizeStart}
              onResize={onResizeEvent}
              onResizeEnd={gestureResizeEnd}
            >
              <span data-testid="table-resize" data-position={position} />
            </NodeResizeControl>
          ))
        : null}

      {/* Add / remove chrome — hover- or selection-gated (edit mode only). */}
      {showChrome ? (
        <>
          {/* A "+" on every side — prepend/append a row or column. Each is
              offset from the edge midpoint (ADD_CLEAR) so the centred connection
              handle never sits over it. */}
          {[
            {
              testid: 'table-add-column',
              title: 'Add column right',
              op: () => addColumn(data, newColId()),
              style: { left: totalW + ADD_GAP, top: totalH / 2 + ADD_CLEAR },
            },
            {
              testid: 'table-add-column-before',
              title: 'Add column left',
              op: () => insertColumn(data, 0, newColId()),
              style: { left: -ADD_GAP - ADD_SIZE, top: totalH / 2 + ADD_CLEAR },
            },
            {
              testid: 'table-add-row',
              title: 'Add row below',
              op: () => addRow(data, newRowId()),
              style: { left: totalW / 2 + ADD_CLEAR, top: totalH + ADD_GAP },
            },
            {
              testid: 'table-add-row-before',
              title: 'Add row above',
              op: () => insertRow(data, 0, newRowId()),
              style: { left: totalW / 2 + ADD_CLEAR, top: -ADD_GAP - ADD_SIZE },
            },
          ].map(({ testid, title, op, style }) => (
            <button
              key={testid}
              type="button"
              data-testid={testid}
              title={title}
              className="nodrag sf:absolute sf:z-20 sf:flex sf:h-6 sf:w-6 sf:items-center sf:justify-center sf:rounded-full sf:bg-accent sf:text-accent-foreground sf:shadow-sm sf:hover:opacity-90"
              style={style}
              onClick={(e) => {
                e.stopPropagation();
                commit(op());
              }}
            >
              +
            </button>
          ))}

          {/* Per-column delete — a single × centred above each column (>1 col). */}
          {columns.length > 1
            ? columns.map((col, i) => (
                <button
                  key={`coldel-${col.id}`}
                  type="button"
                  data-testid="table-delete-column"
                  data-col={col.id}
                  title="Delete column"
                  className={cn(
                    ctlBtn,
                    'sf:hover:bg-destructive sf:hover:text-destructive-foreground',
                  )}
                  style={{ left: (colOffsets[i] ?? 0) - col.width / 2 - 8, top: -22 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    commit(deleteColumn(data, col.id));
                  }}
                >
                  ×
                </button>
              ))
            : null}

          {/* Per-row delete — a single × centred left of each row (>1 row). */}
          {rows.length > 1
            ? rows.map((row, i) => (
                <button
                  key={`rowdel-${row.id}`}
                  type="button"
                  data-testid="table-delete-row"
                  data-row={row.id}
                  title="Delete row"
                  className={cn(
                    ctlBtn,
                    'sf:hover:bg-destructive sf:hover:text-destructive-foreground',
                  )}
                  style={{ top: (rowOffsets[i] ?? 0) - row.height / 2 - 8, left: -22 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    commit(deleteRow(data, row.id));
                  }}
                >
                  ×
                </button>
              ))
            : null}

          {/* Header-row toggle — a small pill on the right of the first row.
              Active state styles bold + filled so it reads as a real toggle. */}
          <button
            type="button"
            data-testid="table-toggle-header"
            data-active={headerRow ? 'true' : 'false'}
            title={headerRow ? 'Header row: on' : 'Header row: off'}
            className={cn(
              'nodrag sf:absolute sf:z-20 sf:flex sf:h-5 sf:items-center sf:gap-1 sf:rounded-full sf:px-1.5 sf:text-[10px] sf:font-semibold sf:leading-none sf:shadow-sm sf:transition-colors',
              headerRow
                ? 'sf:bg-accent sf:text-accent-foreground'
                : 'sf:bg-muted sf:text-muted-foreground sf:hover:bg-accent/40',
            )}
            style={{ left: totalW + ADD_GAP, top: (rows[0]?.height ?? 0) / 2 - 10 }}
            onClick={(e) => {
              e.stopPropagation();
              commit(toggleHeaderRow(data));
            }}
          >
            H
          </button>
        </>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={handleClass}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={handleClass}
      />
    </div>
  );
}

function arePropsEqual(prev: NodeProps<TableNodeType>, next: NodeProps<TableNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const TableNode = memo(TableNodeImpl, arePropsEqual);

// Re-export the floors so the host's create defaults clamp to the same values.
export { MIN_COL_WIDTH, MIN_ROW_HEIGHT };

import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  memo,
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
  cellKey,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  resizeColumn,
  resizeRow,
  setCell,
  toggleHeaderRow,
} from '../lib/table-ops.ts';
import type { TableColumn, TableNodeData, TableRow } from '../types.ts';

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
 * edit mode (wired to `adapter.updateNode`). When `onTableDataChange` is absent
 * (view / mini) the table renders fully static — no edit, resize, or add/remove
 * affordances.
 */
export type TableNodeRuntimeData = TableNodeData & {
  onTableDataChange?: (nodeId: string, patch: TablePatch) => void;
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

interface ResizeState {
  axis: 'col' | 'row';
  id: string;
  start: number;
  startSize: number;
}

function TableNodeImpl({ id, data, selected, isConnectable }: NodeProps<TableNodeType>) {
  const editable = !!data.onTableDataChange;
  // Live draft while dragging a column/row border; committed on pointer-up.
  const [draft, setDraft] = useState<TableNodeData | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; colId: string } | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  const view = draft ?? data;
  const { columns, rows, cells } = view;
  const headerRow = view.headerRow === true;

  const colOffsets = cumulative(columns.map((c) => c.width));
  const rowOffsets = cumulative(rows.map((r) => r.height));
  const totalW = columns.reduce((sum, c) => sum + c.width, 0);
  const totalH = rows.reduce((sum, r) => sum + r.height, 0);

  const commit = (next: TableNodeData) => data.onTableDataChange?.(id, structural(next));

  const fontStack = resolveFontStack(data.fontFamily);
  const baseTextStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...(fontStack ? { fontFamily: fontStack } : {}),
    textAlign: data.textAlign ?? 'left',
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

  // --- Border-drag resize (pointer-captured on the divider) ------------------
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>, st: ResizeState) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = st;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = resizeRef.current;
    if (!st) return;
    e.stopPropagation();
    if (st.axis === 'col') {
      const w = st.startSize + (e.clientX - st.start);
      setDraft(resizeColumn(data, st.id, w));
    } else {
      const h = st.startSize + (e.clientY - st.start);
      setDraft(resizeRow(data, st.id, h));
    }
  };
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = resizeRef.current;
    if (!st) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    resizeRef.current = null;
    setDraft((d) => {
      if (d) commit(d);
      return null;
    });
  };

  const handleClass = cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!');

  return (
    <div
      className="sf:relative"
      style={{ width: totalW, height: totalH }}
      data-testid="table-node"
      data-node-type="table"
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
                  'sf:min-w-0 sf:overflow-hidden sf:border-r sf:border-b sf:px-2 sf:py-1 sf:text-[13px]',
                  isHeader ? 'sf:bg-muted sf:font-semibold' : '',
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

      {/* Column border-drag handles (one per column; the last grows the table). */}
      {editable
        ? columns.map((col, i) => (
            <div
              key={`colh-${col.id}`}
              data-testid="table-col-resize"
              data-col={col.id}
              className="sf:nodrag sf:absolute sf:top-0 sf:z-10 sf:h-full sf:w-[6px] sf:cursor-col-resize"
              style={{ left: (colOffsets[i] ?? 0) - 3 }}
              onPointerDown={(e) =>
                onResizeDown(e, { axis: 'col', id: col.id, start: e.clientX, startSize: col.width })
              }
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
            />
          ))
        : null}

      {/* Row border-drag handles. */}
      {editable
        ? rows.map((row, i) => (
            <div
              key={`rowh-${row.id}`}
              data-testid="table-row-resize"
              data-row={row.id}
              className="sf:nodrag sf:absolute sf:left-0 sf:z-10 sf:h-[6px] sf:w-full sf:cursor-row-resize"
              style={{ top: (rowOffsets[i] ?? 0) - 3 }}
              onPointerDown={(e) =>
                onResizeDown(e, {
                  axis: 'row',
                  id: row.id,
                  start: e.clientY,
                  startSize: row.height,
                })
              }
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
            />
          ))
        : null}

      {/* Add/remove affordances — edit mode only, surfaced on hover/selection. */}
      {editable ? (
        <>
          {/* Append-column rail on the right edge. */}
          <button
            type="button"
            data-testid="table-add-column"
            title="Add column"
            className={cn(
              'sf:nodrag sf:absolute sf:top-0 sf:flex sf:h-full sf:w-[18px] sf:items-center sf:justify-center',
              'sf:rounded-r sf:bg-muted sf:text-muted-foreground sf:opacity-0 sf:transition-opacity',
              'sf:hover:bg-accent sf:hover:text-accent-foreground',
              selected ? 'sf:opacity-60 sf:hover:opacity-100' : '',
            )}
            style={{ left: totalW }}
            onClick={(e) => {
              e.stopPropagation();
              commit(insertColumn(data, data.columns.length, newColId()));
            }}
          >
            +
          </button>
          {/* Append-row rail on the bottom edge. */}
          <button
            type="button"
            data-testid="table-add-row"
            title="Add row"
            className={cn(
              'sf:nodrag sf:absolute sf:left-0 sf:flex sf:h-[18px] sf:w-full sf:items-center sf:justify-center',
              'sf:rounded-b sf:bg-muted sf:text-muted-foreground sf:opacity-0 sf:transition-opacity',
              'sf:hover:bg-accent sf:hover:text-accent-foreground',
              selected ? 'sf:opacity-60 sf:hover:opacity-100' : '',
            )}
            style={{ top: totalH }}
            onClick={(e) => {
              e.stopPropagation();
              commit(insertRow(data, data.rows.length, newRowId()));
            }}
          >
            +
          </button>

          {/* Per-column controls (insert-left / delete) shown above each column. */}
          {selected
            ? columns.map((col, i) => (
                <div
                  key={`colctl-${col.id}`}
                  className="sf:absolute sf:flex sf:gap-0.5"
                  style={{ left: (colOffsets[i] ?? 0) - col.width / 2 - 14, top: -20 }}
                >
                  <button
                    type="button"
                    data-testid="table-insert-column-before"
                    data-col={col.id}
                    title="Insert column before"
                    className="sf:nodrag sf:h-4 sf:w-4 sf:rounded sf:bg-muted sf:text-[10px] sf:leading-none sf:text-muted-foreground sf:hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(insertColumn(data, i, newColId()));
                    }}
                  >
                    +
                  </button>
                  {columns.length > 1 ? (
                    <button
                      type="button"
                      data-testid="table-delete-column"
                      data-col={col.id}
                      title="Delete column"
                      className="sf:nodrag sf:h-4 sf:w-4 sf:rounded sf:bg-muted sf:text-[10px] sf:leading-none sf:text-muted-foreground sf:hover:bg-destructive sf:hover:text-destructive-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        commit(deleteColumn(data, col.id));
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))
            : null}

          {/* Per-row controls (insert-above / delete) shown left of each row. */}
          {selected
            ? rows.map((row, i) => (
                <div
                  key={`rowctl-${row.id}`}
                  className="sf:absolute sf:flex sf:flex-col sf:gap-0.5"
                  style={{ top: (rowOffsets[i] ?? 0) - row.height / 2 - 14, left: -20 }}
                >
                  <button
                    type="button"
                    data-testid="table-insert-row-before"
                    data-row={row.id}
                    title="Insert row above"
                    className="sf:nodrag sf:h-4 sf:w-4 sf:rounded sf:bg-muted sf:text-[10px] sf:leading-none sf:text-muted-foreground sf:hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(insertRow(data, i, newRowId()));
                    }}
                  >
                    +
                  </button>
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      data-testid="table-delete-row"
                      data-row={row.id}
                      title="Delete row"
                      className="sf:nodrag sf:h-4 sf:w-4 sf:rounded sf:bg-muted sf:text-[10px] sf:leading-none sf:text-muted-foreground sf:hover:bg-destructive sf:hover:text-destructive-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        commit(deleteRow(data, row.id));
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))
            : null}

          {/* Header-row toggle — top-left corner control. */}
          {selected ? (
            <button
              type="button"
              data-testid="table-toggle-header"
              title="Toggle header row"
              className={cn(
                'sf:nodrag sf:absolute sf:h-4 sf:rounded sf:px-1 sf:text-[10px] sf:leading-none',
                headerRow
                  ? 'sf:bg-accent sf:text-accent-foreground'
                  : 'sf:bg-muted sf:text-muted-foreground',
              )}
              style={{ left: -20, top: -20 }}
              onClick={(e) => {
                e.stopPropagation();
                commit(toggleHeaderRow(data));
              }}
            >
              H
            </button>
          ) : null}
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

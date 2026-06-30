import type { TableColumn, TableNodeData, TableRow } from '../types.ts';

/**
 * Pure structural transforms for `type:'table'` node data — the testable
 * oracles behind every add/insert/delete/resize/edit the TableNode renderer
 * fires. Mirrors the `group-ops.ts` convention: ref-free, immutable (every
 * function returns a fresh `TableNodeData` and never mutates its input), and
 * deterministic (callers pass in any new column/row id so id generation stays
 * outside the pure layer). The renderer maps each user gesture to exactly one
 * of these → a single `adapter.updateNode` whole-`data` write.
 */

/** Default column width (px) for new columns and freshly-created tables. */
export const DEFAULT_COL_WIDTH = 140;
/** Default row height (px) for new rows and freshly-created tables. */
export const DEFAULT_ROW_HEIGHT = 40;
/** Floor a column may be dragged to, so borders stay grabbable. */
export const MIN_COL_WIDTH = 48;
/** Floor a row may be dragged to, so the header stays legible. */
export const MIN_ROW_HEIGHT = 28;
/** A freshly-dropped table starts as a 3×3 grid. */
export const TABLE_DEFAULT_COLS = 3;
export const TABLE_DEFAULT_ROWS = 3;

/** Key under which a cell's text lives in `data.cells`. Ids never contain ':'. */
export function cellKey(rowId: string, colId: string): string {
  return `${rowId}:${colId}`;
}

function parseCellKey(key: string): { rowId: string; colId: string } {
  const idx = key.indexOf(':');
  return { rowId: key.slice(0, idx), colId: key.slice(idx + 1) };
}

/**
 * Drop every cell whose row or column no longer exists. Called after a
 * delete so the sparse `cells` map never carries orphans.
 */
function pruneCells(
  cells: Record<string, string>,
  colIds: ReadonlySet<string>,
  rowIds: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(cells)) {
    const { rowId, colId } = parseCellKey(key);
    if (colIds.has(colId) && rowIds.has(rowId)) out[key] = text;
  }
  return out;
}

const clampIndex = (index: number, len: number): number =>
  Math.max(0, Math.min(Math.trunc(index), len));

/** Build fresh table data from explicit column/row ids (sizes default). */
export function createTableData(
  colIds: string[],
  rowIds: string[],
  opts?: { headerRow?: boolean },
): TableNodeData {
  const data: TableNodeData = {
    columns: colIds.map((id) => ({ id, width: DEFAULT_COL_WIDTH })),
    rows: rowIds.map((id) => ({ id, height: DEFAULT_ROW_HEIGHT })),
    cells: {},
  };
  if (opts?.headerRow) data.headerRow = true;
  return data;
}

/** Derived node footprint: Σ column widths × Σ row heights. Never stored. */
export function deriveTableSize(data: TableNodeData): { width: number; height: number } {
  return {
    width: data.columns.reduce((sum, c) => sum + c.width, 0),
    height: data.rows.reduce((sum, r) => sum + r.height, 0),
  };
}

export function insertColumn(
  data: TableNodeData,
  index: number,
  newColId: string,
  width: number = DEFAULT_COL_WIDTH,
): TableNodeData {
  const columns = [...data.columns];
  columns.splice(clampIndex(index, columns.length), 0, { id: newColId, width });
  return { ...data, columns };
}

export function addColumn(
  data: TableNodeData,
  newColId: string,
  width: number = DEFAULT_COL_WIDTH,
): TableNodeData {
  return insertColumn(data, data.columns.length, newColId, width);
}

export function deleteColumn(data: TableNodeData, colId: string): TableNodeData {
  if (data.columns.length <= 1) return data; // never leave a table with 0 columns
  const columns = data.columns.filter((c) => c.id !== colId);
  if (columns.length === data.columns.length) return data; // unknown id → no-op
  const colIds = new Set(columns.map((c) => c.id));
  const rowIds = new Set(data.rows.map((r) => r.id));
  return { ...data, columns, cells: pruneCells(data.cells, colIds, rowIds) };
}

export function insertRow(
  data: TableNodeData,
  index: number,
  newRowId: string,
  height: number = DEFAULT_ROW_HEIGHT,
): TableNodeData {
  const rows = [...data.rows];
  rows.splice(clampIndex(index, rows.length), 0, { id: newRowId, height });
  return { ...data, rows };
}

export function addRow(
  data: TableNodeData,
  newRowId: string,
  height: number = DEFAULT_ROW_HEIGHT,
): TableNodeData {
  return insertRow(data, data.rows.length, newRowId, height);
}

export function deleteRow(data: TableNodeData, rowId: string): TableNodeData {
  if (data.rows.length <= 1) return data; // never leave a table with 0 rows
  const rows = data.rows.filter((r) => r.id !== rowId);
  if (rows.length === data.rows.length) return data; // unknown id → no-op
  const colIds = new Set(data.columns.map((c) => c.id));
  const rowIds = new Set(rows.map((r) => r.id));
  return { ...data, rows, cells: pruneCells(data.cells, colIds, rowIds) };
}

export function resizeColumn(data: TableNodeData, colId: string, width: number): TableNodeData {
  let changed = false;
  const columns: TableColumn[] = data.columns.map((c) => {
    if (c.id !== colId) return c;
    changed = true;
    return { ...c, width: Math.max(MIN_COL_WIDTH, Math.round(width)) };
  });
  return changed ? { ...data, columns } : data;
}

export function resizeRow(data: TableNodeData, rowId: string, height: number): TableNodeData {
  let changed = false;
  const rows: TableRow[] = data.rows.map((r) => {
    if (r.id !== rowId) return r;
    changed = true;
    return { ...r, height: Math.max(MIN_ROW_HEIGHT, Math.round(height)) };
  });
  return changed ? { ...data, rows } : data;
}

/**
 * Scale the whole table to a new bounding box — the "resize the entire table"
 * gesture (drag the table's edge/corner). Every column width and row height is
 * multiplied by the box's scale factor on its axis, then floored at the per-cell
 * minimum so borders stay grabbable. Ids, cells and the header flag are
 * untouched. A non-positive target (or a degenerate zero-size source) is a no-op
 * — there's no meaningful factor to apply.
 */
export function scaleTableTo(data: TableNodeData, width: number, height: number): TableNodeData {
  if (width <= 0 || height <= 0) return data;
  const startW = data.columns.reduce((sum, c) => sum + c.width, 0);
  const startH = data.rows.reduce((sum, r) => sum + r.height, 0);
  if (startW <= 0 || startH <= 0) return data;
  const sx = width / startW;
  const sy = height / startH;
  const columns: TableColumn[] = data.columns.map((c) => ({
    ...c,
    width: Math.max(MIN_COL_WIDTH, Math.round(c.width * sx)),
  }));
  const rows: TableRow[] = data.rows.map((r) => ({
    ...r,
    height: Math.max(MIN_ROW_HEIGHT, Math.round(r.height * sy)),
  }));
  return { ...data, columns, rows };
}

/**
 * Write `text` into the (rowId, colId) cell. Empty text removes the key so the
 * map stays sparse. Writes to a non-existent row/column are ignored.
 */
export function setCell(
  data: TableNodeData,
  rowId: string,
  colId: string,
  text: string,
): TableNodeData {
  const rowExists = data.rows.some((r) => r.id === rowId);
  const colExists = data.columns.some((c) => c.id === colId);
  if (!rowExists || !colExists) return data;

  const key = cellKey(rowId, colId);
  const cells = { ...data.cells };
  if (text === '') {
    delete cells[key];
  } else {
    cells[key] = text;
  }
  return { ...data, cells };
}

/** Flip the header-row flag (unset is treated as off, so unset → on). */
export function toggleHeaderRow(data: TableNodeData): TableNodeData {
  return { ...data, headerRow: !data.headerRow };
}

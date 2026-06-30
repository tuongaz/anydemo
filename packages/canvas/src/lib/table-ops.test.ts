import { describe, expect, test } from 'bun:test';
import type { TableNodeData } from '../types.ts';
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  addColumn,
  addRow,
  cellKey,
  createTableData,
  deleteColumn,
  deleteRow,
  deriveTableSize,
  insertColumn,
  insertRow,
  resizeColumn,
  resizeRow,
  scaleTableTo,
  setCell,
  toggleHeaderRow,
} from './table-ops.ts';

// A small fixture: 2 columns (c1,c2) x 2 rows (r1,r2), with text only in the
// r1:c1 and r2:c2 cells so deletions have something to prune.
const fixture = (): TableNodeData => ({
  columns: [
    { id: 'c1', width: 100 },
    { id: 'c2', width: 200 },
  ],
  rows: [
    { id: 'r1', height: 30 },
    { id: 'r2', height: 50 },
  ],
  cells: {
    'r1:c1': 'top-left',
    'r2:c2': 'bottom-right',
  },
  headerRow: true,
});

describe('cellKey', () => {
  test('joins row and column ids with a colon', () => {
    expect(cellKey('r1', 'c2')).toBe('r1:c2');
  });
});

describe('createTableData', () => {
  test('builds columns and rows with default sizes and no cells', () => {
    const data = createTableData(['a', 'b', 'c'], ['x', 'y']);
    expect(data.columns).toEqual([
      { id: 'a', width: DEFAULT_COL_WIDTH },
      { id: 'b', width: DEFAULT_COL_WIDTH },
      { id: 'c', width: DEFAULT_COL_WIDTH },
    ]);
    expect(data.rows).toEqual([
      { id: 'x', height: DEFAULT_ROW_HEIGHT },
      { id: 'y', height: DEFAULT_ROW_HEIGHT },
    ]);
    expect(data.cells).toEqual({});
  });

  test('sets headerRow when requested', () => {
    expect(createTableData(['a'], ['x'], { headerRow: true }).headerRow).toBe(true);
    expect(createTableData(['a'], ['x']).headerRow).toBeUndefined();
  });
});

describe('deriveTableSize', () => {
  test('sums column widths and row heights', () => {
    expect(deriveTableSize(fixture())).toEqual({ width: 300, height: 80 });
  });
});

describe('addColumn', () => {
  test('appends a column with the default width and leaves cells untouched', () => {
    const next = addColumn(fixture(), 'c3');
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(next.columns[2]).toEqual({ id: 'c3', width: DEFAULT_COL_WIDTH });
    expect(next.cells).toEqual(fixture().cells);
  });

  test('does not mutate the input', () => {
    const input = fixture();
    addColumn(input, 'c3');
    expect(input.columns.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('insertColumn', () => {
  test('inserts at the given index', () => {
    const next = insertColumn(fixture(), 1, 'cX');
    expect(next.columns.map((c) => c.id)).toEqual(['c1', 'cX', 'c2']);
  });

  test('clamps an out-of-range index to the ends', () => {
    expect(insertColumn(fixture(), -5, 'cX').columns.map((c) => c.id)).toEqual(['cX', 'c1', 'c2']);
    expect(insertColumn(fixture(), 99, 'cX').columns.map((c) => c.id)).toEqual(['c1', 'c2', 'cX']);
  });
});

describe('deleteColumn', () => {
  test('removes the column and prunes its cells', () => {
    const next = deleteColumn(fixture(), 'c1');
    expect(next.columns.map((c) => c.id)).toEqual(['c2']);
    expect(next.cells).toEqual({ 'r2:c2': 'bottom-right' }); // r1:c1 dropped
  });

  test('refuses to delete the last remaining column', () => {
    const oneCol: TableNodeData = {
      columns: [{ id: 'only', width: 100 }],
      rows: [{ id: 'r1', height: 30 }],
      cells: { 'r1:only': 'keep' },
    };
    expect(deleteColumn(oneCol, 'only')).toEqual(oneCol);
  });
});

describe('addRow / insertRow', () => {
  test('appends a row with the default height', () => {
    const next = addRow(fixture(), 'r3');
    expect(next.rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(next.rows[2]).toEqual({ id: 'r3', height: DEFAULT_ROW_HEIGHT });
  });

  test('inserts a row at the given index', () => {
    const next = insertRow(fixture(), 1, 'rX');
    expect(next.rows.map((r) => r.id)).toEqual(['r1', 'rX', 'r2']);
  });
});

describe('deleteRow', () => {
  test('removes the row and prunes its cells', () => {
    const next = deleteRow(fixture(), 'r2');
    expect(next.rows.map((r) => r.id)).toEqual(['r1']);
    expect(next.cells).toEqual({ 'r1:c1': 'top-left' }); // r2:c2 dropped
  });

  test('refuses to delete the last remaining row', () => {
    const oneRow: TableNodeData = {
      columns: [{ id: 'c1', width: 100 }],
      rows: [{ id: 'only', height: 30 }],
      cells: {},
    };
    expect(deleteRow(oneRow, 'only')).toEqual(oneRow);
  });
});

describe('resizeColumn', () => {
  test('sets a new width on the matching column', () => {
    expect(resizeColumn(fixture(), 'c2', 250).columns[1]).toEqual({ id: 'c2', width: 250 });
  });

  test('clamps below the minimum width', () => {
    expect(resizeColumn(fixture(), 'c1', 5).columns[0]).toEqual({ id: 'c1', width: MIN_COL_WIDTH });
  });

  test('ignores an unknown column id', () => {
    expect(resizeColumn(fixture(), 'nope', 250)).toEqual(fixture());
  });
});

describe('resizeRow', () => {
  test('sets a new height clamped to the minimum', () => {
    expect(resizeRow(fixture(), 'r1', 1).rows[0]).toEqual({ id: 'r1', height: MIN_ROW_HEIGHT });
  });
});

describe('setCell', () => {
  test('writes text into a cell', () => {
    expect(setCell(fixture(), 'r1', 'c2', 'hello').cells['r1:c2']).toBe('hello');
  });

  test('removes the key when text is empty (keeps the map sparse)', () => {
    const next = setCell(fixture(), 'r1', 'c1', '');
    expect('r1:c1' in next.cells).toBe(false);
  });

  test('ignores writes to non-existent rows or columns', () => {
    expect(setCell(fixture(), 'rZ', 'c1', 'x')).toEqual(fixture());
    expect(setCell(fixture(), 'r1', 'cZ', 'x')).toEqual(fixture());
  });
});

describe('scaleTableTo', () => {
  test('scales every column width and row height proportionally to the new box', () => {
    // fixture: width 300 (100+200), height 80 (30+50). Double both.
    const next = scaleTableTo(fixture(), 600, 160);
    expect(next.columns).toEqual([
      { id: 'c1', width: 200 },
      { id: 'c2', width: 400 },
    ]);
    expect(next.rows).toEqual([
      { id: 'r1', height: 60 },
      { id: 'r2', height: 100 },
    ]);
  });

  test('preserves cells, ids and headerRow', () => {
    const next = scaleTableTo(fixture(), 600, 160);
    expect(next.cells).toEqual(fixture().cells);
    expect(next.headerRow).toBe(true);
  });

  test('clamps each column/row to its minimum when shrinking hard', () => {
    const next = scaleTableTo(fixture(), 10, 10);
    expect(next.columns.every((c) => c.width === MIN_COL_WIDTH)).toBe(true);
    expect(next.rows.every((r) => r.height === MIN_ROW_HEIGHT)).toBe(true);
  });

  test('is a no-op (same sizes) when the box already matches the derived size', () => {
    expect(scaleTableTo(fixture(), 300, 80)).toEqual(fixture());
  });

  test('returns the input unchanged for a non-positive target box', () => {
    expect(scaleTableTo(fixture(), 0, 80)).toEqual(fixture());
    expect(scaleTableTo(fixture(), 300, -5)).toEqual(fixture());
  });

  test('does not mutate the input', () => {
    const input = fixture();
    scaleTableTo(input, 600, 160);
    expect(input.columns).toEqual([
      { id: 'c1', width: 100 },
      { id: 'c2', width: 200 },
    ]);
  });
});

describe('toggleHeaderRow', () => {
  test('flips an explicit true to false', () => {
    expect(toggleHeaderRow(fixture()).headerRow).toBe(false);
  });

  test('turns an unset header on', () => {
    const noHeader: TableNodeData = {
      columns: [{ id: 'c1', width: 100 }],
      rows: [{ id: 'r1', height: 30 }],
      cells: {},
    };
    expect(toggleHeaderRow(noHeader).headerRow).toBe(true);
  });
});

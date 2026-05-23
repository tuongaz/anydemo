interface TableColumn {
  key: string;
  label: string;
}

interface TableProps {
  columns?: TableColumn[];
  rows?: Array<Record<string, unknown>>;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

export function Table({ columns = [], rows = [] }: TableProps) {
  return (
    <div className="sf:w-full sf:overflow-x-auto">
      <table className="sf:w-full sf:text-left sf:text-sm">
        <thead className="sf:border-b sf:bg-muted/50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="sf:px-3 sf:py-2 sf:font-medium sf:text-muted-foreground"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: row data has no stable id field
            <tr key={idx} className="sf:border-b last:sf:border-0">
              {columns.map((col) => (
                <td key={col.key} className="sf:px-3 sf:py-2">
                  {renderCell(row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

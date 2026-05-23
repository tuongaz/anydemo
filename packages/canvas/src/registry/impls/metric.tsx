import type { ReactNode } from 'react';

interface MetricProps {
  label?: ReactNode;
  value?: ReactNode;
}

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function Metric({ label, value }: MetricProps) {
  return (
    <div className="sf:flex sf:flex-col sf:gap-1">
      <span className="sf:text-muted-foreground sf:text-xs sf:uppercase sf:tracking-wide">
        {label}
      </span>
      <span className="sf:font-semibold sf:text-2xl sf:tabular-nums">{renderValue(value)}</span>
    </div>
  );
}

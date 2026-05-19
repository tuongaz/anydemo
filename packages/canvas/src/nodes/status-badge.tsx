import { cn } from '../lib/cn.ts';
import type { StatusReportState } from '../types.ts';

const DOT_STYLES: Record<StatusReportState, string> = {
  ok: 'sf:bg-emerald-400',
  warn: 'sf:bg-amber-400',
  error: 'sf:bg-rose-400',
  pending: 'sf:bg-slate-400',
};

export interface StatusBadgeProps {
  state: StatusReportState;
  summary?: string;
  /** Optional test id forwarded to the wrapper. */
  'data-testid'?: string;
}

/**
 * 8px colored dot + ellipsized one-line summary. Renders inline so the parent
 * can drop it into a flex row without extra layout. When `summary` is empty
 * the badge degrades to just the dot.
 */
export function StatusBadge({ state, summary, 'data-testid': testId }: StatusBadgeProps) {
  return (
    <span
      data-testid={testId}
      data-state={state}
      className="sf:inline-flex sf:max-w-full sf:items-center sf:gap-1.5 sf:text-[11px] sf:leading-tight sf:text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn('sf:h-2 sf:w-2 sf:shrink-0 sf:rounded-full', DOT_STYLES[state])}
      />
      {summary ? (
        <span className="sf:min-w-0 sf:flex-1 sf:truncate" title={summary}>
          {summary}
        </span>
      ) : null}
    </span>
  );
}

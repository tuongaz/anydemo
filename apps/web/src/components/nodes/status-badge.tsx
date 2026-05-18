import type { StatusReportState } from '@/lib/api';
import { cn } from '@seeflow/canvas';

const DOT_STYLES: Record<StatusReportState, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-rose-400',
  pending: 'bg-slate-400',
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
      className="inline-flex max-w-full items-center gap-1.5 text-[11px] leading-tight text-muted-foreground"
    >
      <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', DOT_STYLES[state])} />
      {summary ? (
        <span className="min-w-0 flex-1 truncate" title={summary}>
          {summary}
        </span>
      ) : null}
    </span>
  );
}

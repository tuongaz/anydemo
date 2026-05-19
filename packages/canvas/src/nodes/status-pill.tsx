import { cn } from '../lib/cn.ts';

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

const STYLES: Record<Exclude<NodeStatus, 'idle'>, string> = {
  running: 'sf:bg-amber-950/50 sf:text-amber-300 sf:animate-pulse',
  done: 'sf:bg-emerald-950/50 sf:text-emerald-300',
  error: 'sf:bg-rose-950/50 sf:text-rose-300',
};

// Idle is intentionally invisible — the pill is meaningful state, not chrome.
// Once a node has run, the pill becomes visible (running/done/error).
export function StatusPill({
  status,
  'data-testid': dataTestId,
}: {
  status: NodeStatus;
  'data-testid'?: string;
}) {
  if (status === 'idle') return null;
  return (
    <span
      data-status={status}
      data-testid={dataTestId}
      className={cn(
        'sf:inline-flex sf:h-4 sf:items-center sf:rounded-full sf:px-1.5 sf:py-0 sf:font-normal sf:text-[9px] sf:uppercase sf:tracking-wide',
        STYLES[status],
      )}
    >
      {status}
    </span>
  );
}
